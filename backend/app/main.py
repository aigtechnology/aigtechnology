import hashlib
import hmac
import logging
import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis import Redis
from redis.exceptions import RedisError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from .auth import SESSION_COOKIE, _now, _token_hash, create_session, csrf_token, get_current_user, require_admin, set_session_cookie, verify_password
from . import business_models  # noqa: F401 - registers business tables before create_all
from .config import settings
from .checkout import (
    calculate_cart,
    capture_reservations,
    create_website_order,
    get_order_for_customer,
    release_reservations,
)
from .database import Base, engine, get_db
from .firebase_auth import require_firebase_admin
from .models import AdminSession, AdminUser
from .business_models import (
    FlipkartOrder,
    Inventory,
    PaymentAttempt,
    PaymentWebhookEvent,
    Product,
    ReturnRecord,
    WebsiteOrder,
    WebsitePayment,
    WebsiteRefund,
)
from .payment_providers import (
    create_razorpay_order,
    create_razorpay_refund,
    fetch_razorpay_payment,
    parse_webhook_body,
    verify_razorpay_payment_signature,
    verify_razorpay_webhook_signature,
)
from .sync import check_flipkart_connection
from .schemas import (
    CatalogSyncRequest,
    CheckoutValidateRequest,
    CreateOrderRequest,
    FulfillmentUpdate,
    LoginRequest,
    PaymentOrderRequest,
    RefundRequest,
    SessionResponse,
    UserResponse,
    VerifyPaymentRequest,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("aig.api")
limiter = Limiter(key_func=get_remote_address, storage_uri=settings.rate_limit_storage_uri or "memory://")
app = FastAPI(title="AIG Technology Admin API", version="0.2.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token", "X-Order-Access-Token", "X-Razorpay-Signature", "X-Razorpay-Event-Id"],
)


@app.on_event("startup")
def validate_database() -> None:
    if settings.app_env == "production":
        if engine.dialect.name != "postgresql":
            raise RuntimeError("Production requires PostgreSQL.")
        if len(settings.session_secret) < 32:
            raise RuntimeError("SESSION_SECRET must contain at least 32 characters in production.")
        if any(not origin.startswith("https://") or "*" in origin for origin in settings.allowed_origins):
            raise RuntimeError("Production CORS origins must be explicit HTTPS origins.")
        if not settings.rate_limit_storage_uri:
            raise RuntimeError("RATE_LIMIT_STORAGE_URI must be configured for production rate limiting.")
        if settings.payment_provider == "mock":
            raise RuntimeError("Mock payments are not permitted in production.")
        if settings.payment_provider == "razorpay" and (
            not settings.razorpay_key_id.startswith("rzp_test_")
            or not settings.razorpay_key_secret
            or not settings.razorpay_webhook_secret
        ):
            raise RuntimeError("Production validation requires Razorpay test credentials and a webhook secret.")
        with engine.connect() as connection:
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
        if revision != "20261107_01":
            raise RuntimeError("Database migrations are not at the expected Alembic revision.")
        return
    with engine.connect():
        Base.metadata.create_all(engine)


def _apply_security_headers(response: Response) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def apply_security_headers(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in settings.allowed_origins:
        return _apply_security_headers(Response(status_code=403, content="Origin not allowed"))
    response = await call_next(request)
    if response.status_code >= 500:
        route = request.scope.get("route")
        logger.error(
            "API request failed: method=%s route=%s status=%s",
            request.method,
            getattr(route, "path", "unmatched"),
            response.status_code,
        )
    return _apply_security_headers(response)


@app.get("/api/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "aig-admin-api"}


@app.get("/health/live", tags=["system"])
@app.get("/api/health/live", tags=["system"])
def health_live() -> dict[str, str]:
    return {"status": "ok", "service": "aig-admin-api"}


@app.get("/health/ready", tags=["system"])
@app.get("/api/health/ready", tags=["system"])
def health_ready() -> JSONResponse:
    checks = {"database": "ok", "redis": "not_configured"}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        checks["database"] = "unavailable"
        logger.exception("Readiness database check failed")

    if settings.rate_limit_storage_uri:
        client = Redis.from_url(
            settings.rate_limit_storage_uri,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        try:
            client.ping()
            checks["redis"] = "ok"
        except RedisError:
            checks["redis"] = "unavailable"
            logger.exception("Readiness rate-limit store check failed")
        finally:
            client.close()
    elif settings.app_env == "production":
        checks["redis"] = "not_configured"

    ready = checks["database"] == "ok" and (
        checks["redis"] == "ok" or (checks["redis"] == "not_configured" and settings.app_env != "production")
    )
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ok" if ready else "not_ready", "checks": checks},
    )


def _serialize_website_order(order: WebsiteOrder) -> dict[str, object]:
    customer = order.customer
    payment = order.payments[0] if order.payments else None
    return {
        "order_id": order.order_id,
        "source": "website",
        "order_date": order.created_at,
        "customer": customer.full_name,
        "customer_email": customer.email,
        "customer_phone": customer.phone,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": payment.provider if payment else None,
        "payment_id": payment.payment_id if payment else None,
        "payment_reference": payment.provider_payment_id if payment else None,
        "refunds": [
            {"amount": str(refund.amount), "status": refund.status}
            for refund in payment.refunds
        ] if payment else [],
        "total_amount": str(order.total_amount),
        "items": [
            {"name": item.name, "sku": item.sku, "quantity": item.quantity,
             "unit_price": str(item.unit_price), "subtotal": str(item.subtotal)}
            for item in order.items
        ],
        "shipping_address": order.shipping_address,
    }

def _serialize_website_order_admin_detail(order: WebsiteOrder) -> dict[str, object]:
    payment = order.payments[0] if order.payments else None
    return {
        "order_id": order.order_id,
        "source": "website",
        "order_date": order.created_at,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": payment.provider if payment else None,
        "payment_id": payment.payment_id if payment else None,
        "total_amount": str(order.total_amount),
        "items": [
            {"name": item.name, "sku": item.sku, "quantity": item.quantity,
             "unit_price": str(item.unit_price), "subtotal": str(item.subtotal)}
            for item in order.items
        ],
    }


def _webhook_summary(event_type: str, payload: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {"event": event_type}
    key = "refund" if event_type.startswith("refund.") else "payment"
    wrapper = payload.get("payload")
    group = wrapper.get(key) if isinstance(wrapper, dict) else None
    entity = group.get("entity") if isinstance(group, dict) else None
    if isinstance(entity, dict):
        result[key] = {
            field: entity.get(field)
            for field in ("id", "order_id", "payment_id", "status", "amount", "currency")
            if isinstance(entity.get(field), (str, int, float, bool)) or entity.get(field) is None
        }
    return result


@app.post("/api/catalog/sync", tags=["catalog"])
def sync_catalog_product(
    payload: CatalogSyncRequest,
    claims: dict[str, object] = Depends(require_firebase_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if payload.sku and not all(character.isalnum() or character in "._-" for character in payload.sku):
        raise HTTPException(status_code=422, detail="SKU may contain only letters, numbers, dot, underscore, or hyphen")
    if payload.image_url and not payload.image_url.startswith("https://"):
        raise HTTPException(status_code=422, detail="Product image URLs must use HTTPS")

    product = database.scalar(select(Product).where(Product.catalog_id == payload.catalog_id).with_for_update())
    if product is None and payload.sku:
        product = database.scalar(select(Product).where(Product.sku == payload.sku).with_for_update())
    if payload.sku:
        conflicting_product = database.scalar(select(Product).where(Product.sku == payload.sku))
        if conflicting_product and conflicting_product.id != (product.id if product else None):
            raise HTTPException(status_code=409, detail="This SKU is already assigned to another catalog product")
    synced_price = (payload.price or Decimal("0")).quantize(Decimal("0.01"))
    payable = bool(payload.published and payload.sku and synced_price > 0)
    if product is None and not payload.sku:
        return {"synced": False, "checkout_enabled": False, "reason": "A unique SKU is required for checkout"}
    if product is None:
        product = Product(
            sku=payload.sku,
            catalog_id=payload.catalog_id,
            name=payload.name,
            selling_price=synced_price,
            is_active=payable,
            image_url=payload.image_url,
            catalog_stock_quantity=payload.stock_quantity,
        )
        database.add(product)
        database.flush()
        quantity = payload.stock_quantity or 0
        database.add(Inventory(product_id=product.id, available_quantity=quantity))
    else:
        if product.sku != payload.sku and payload.sku:
            product.sku = payload.sku
        product.catalog_id = payload.catalog_id
        product.name = payload.name
        product.selling_price = synced_price
        product.is_active = payable
        product.image_url = payload.image_url
        inventory = database.scalar(select(Inventory).where(Inventory.product_id == product.id).with_for_update())
        if inventory is None:
            inventory = Inventory(product_id=product.id, available_quantity=payload.stock_quantity or 0)
            database.add(inventory)
        elif payload.stock_quantity != product.catalog_stock_quantity:
            inventory.available_quantity = max(0, (payload.stock_quantity or 0) - inventory.reserved_quantity)
        product.catalog_stock_quantity = payload.stock_quantity
    database.commit()
    return {"synced": True, "checkout_enabled": payable, "catalog_id": payload.catalog_id}


@app.delete("/api/catalog/{catalog_id}", tags=["catalog"])
def archive_catalog_product(
    catalog_id: str,
    claims: dict[str, object] = Depends(require_firebase_admin),
    database: Session = Depends(get_db),
) -> dict[str, bool]:
    product = database.scalar(select(Product).where(Product.catalog_id == catalog_id).with_for_update())
    if product:
        product.is_active = False
        database.commit()
    return {"archived": True}


@app.post("/api/checkout/validate", tags=["checkout"])
@limiter.limit("30/minute")
def validate_checkout(
    request: Request,
    payload: CheckoutValidateRequest,
    database: Session = Depends(get_db),
) -> dict[str, object]:
    return calculate_cart(database, payload.items)


@app.post("/api/orders/create", tags=["orders"])
@limiter.limit("10/minute")
def create_order(
    request: Request,
    payload: CreateOrderRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if settings.app_env == "production" and settings.payment_provider == "mock":
        raise HTTPException(status_code=503, detail="Mock payments are disabled in production")
    return create_website_order(database, payload, idempotency_key or "")


def _accessible_order(
    order_id: str,
    lookup_token: str | None,
    session_token: str | None,
    database: Session,
) -> WebsiteOrder:
    if lookup_token:
        return get_order_for_customer(database, order_id, lookup_token)
    get_current_user(session_token, database)
    order = database.scalar(
        select(WebsiteOrder)
        .options(joinedload(WebsiteOrder.customer), joinedload(WebsiteOrder.items), joinedload(WebsiteOrder.payments))
        .where(WebsiteOrder.order_id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/api/orders/{order_id}", tags=["orders"])
def get_order(
    order_id: str,
    lookup_token: str | None = Header(default=None, alias="X-Order-Access-Token"),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    order = _accessible_order(order_id, lookup_token, session_token, database)
    return _serialize_website_order(order) if lookup_token else _serialize_website_order_admin_detail(order)


@app.post("/api/payments/create-order", tags=["payments"])
@limiter.limit("10/minute")
async def create_payment_order(
    request: Request,
    payload: PaymentOrderRequest,
    lookup_token: str | None = Header(default=None, alias="X-Order-Access-Token"),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if not lookup_token:
        raise HTTPException(status_code=401, detail="Order access token required")
    order = get_order_for_customer(database, payload.order_id, lookup_token)
    if order.status != "Pending Payment":
        raise HTTPException(status_code=409, detail="This order is no longer awaiting payment")
    payment = database.scalar(select(WebsitePayment).where(WebsitePayment.order_id == order.id).with_for_update())
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment attempt not found")
    if payment.provider == "mock":
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Mock payments are disabled in production")
        payment.status = "Pending"
        order.payment_status = "Pending"
        for attempt in payment.attempts:
            if attempt.status == "Created":
                attempt.status = "Pending"
        database.commit()
        return {
            "provider": "mock",
            "test_mode": True,
            "notice": "TEST MODE — simulated outcomes are not bank transactions.",
            "payment_id": payment.payment_id,
            "amount": str(payment.amount),
            "currency": payment.currency,
            "outcomes": ["success", "failure"],
        }
    if payment.provider != "razorpay":
        raise HTTPException(status_code=503, detail="Unsupported payment provider")
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=503, detail="Razorpay webhook verification is not configured")
    if payment.provider_order_id:
        return {
            "provider": "razorpay", "test_mode": settings.razorpay_key_id.startswith("rzp_test_"), "key_id": settings.razorpay_key_id,
            "provider_order_id": payment.provider_order_id, "payment_id": payment.payment_id,
            "amount": str(payment.amount), "currency": payment.currency,
        }
    provider_order = await create_razorpay_order(
        payment.payment_id,
        str(payment.amount),
        payment.currency,
        order.order_id,
    )
    payment.provider_order_id = str(provider_order["id"])
    payment.status = "Pending"
    order.payment_status = "Pending"
    for attempt in payment.attempts:
        if attempt.status == "Created":
            attempt.status = "Pending"
    database.commit()
    return {
        "provider": "razorpay", "test_mode": settings.razorpay_key_id.startswith("rzp_test_"), "key_id": settings.razorpay_key_id,
        "provider_order_id": payment.provider_order_id, "payment_id": payment.payment_id,
        "amount": str(payment.amount), "currency": payment.currency,
    }


@app.post("/api/payments/verify", tags=["payments"])
@limiter.limit("10/minute")
async def verify_payment(
    request: Request,
    payload: VerifyPaymentRequest,
    lookup_token: str | None = Header(default=None, alias="X-Order-Access-Token"),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if not lookup_token:
        raise HTTPException(status_code=401, detail="Order access token required")
    order = get_order_for_customer(database, payload.order_id, lookup_token)
    payment = database.scalar(select(WebsitePayment).where(WebsitePayment.payment_id == payload.payment_id).with_for_update())
    if payment is None or payment.order_id != order.id:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status == "Captured":
        return {"order_id": order.order_id, "payment_status": payment.status, "order_status": order.status}
    if payment.status in {"Failed", "Refunded", "Partially Refunded"}:
        raise HTTPException(status_code=409, detail="Payment attempt is already in a terminal state")
    if payment.status not in {"Pending", "Authorized"}:
        raise HTTPException(status_code=409, detail="Start the payment provider flow before verification")

    if payment.provider == "mock":
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Mock payment verification is disabled in production")
        if payload.outcome not in {"success", "failure"}:
            raise HTTPException(status_code=422, detail="Choose a test outcome")
        success = payload.outcome == "success"
        payment.provider_payment_id = payment.provider_payment_id or f"test_{uuid.uuid4().hex}"
    elif payment.provider == "razorpay":
        if not payload.razorpay_order_id or not payload.razorpay_payment_id or not payload.razorpay_signature:
            raise HTTPException(status_code=422, detail="Razorpay payment verification fields are required")
        if payload.razorpay_order_id != payment.provider_order_id or not verify_razorpay_payment_signature(
            payload.razorpay_order_id,
            payload.razorpay_payment_id,
            payload.razorpay_signature,
        ):
            raise HTTPException(status_code=400, detail="Invalid payment signature")
        provider_payment = await fetch_razorpay_payment(payload.razorpay_payment_id)
        if provider_payment.get("order_id") != payment.provider_order_id:
            raise HTTPException(status_code=400, detail="Payment does not belong to this order")
        if (
            provider_payment.get("amount") != int(Decimal(payment.amount) * 100)
            or provider_payment.get("currency") != payment.currency
        ):
            raise HTTPException(status_code=400, detail="Razorpay payment amount or currency does not match the order")
        conflicting_payment = database.scalar(
            select(WebsitePayment.id).where(
                WebsitePayment.provider_payment_id == payload.razorpay_payment_id,
                WebsitePayment.id != payment.id,
            )
        )
        if conflicting_payment:
            raise HTTPException(status_code=409, detail="Razorpay payment is already assigned to another order")
        payment.provider_payment_id = payload.razorpay_payment_id
        return await _reconcile_razorpay_payment(database, payment, provider_payment)
    else:
        raise HTTPException(status_code=503, detail="Unsupported payment provider")

    payment.status = "Captured" if success else "Failed"
    order.payment_status = payment.status
    order.status = "Confirmed" if success else "Cancelled"
    for attempt in payment.attempts:
        attempt.status = payment.status
        attempt.provider_reference = payment.provider_payment_id
    if success:
        capture_reservations(database, order)
    else:
        release_reservations(database, order)
    database.commit()
    return {"order_id": order.order_id, "payment_status": payment.status, "order_status": order.status}


async def _reconcile_razorpay_payment(
    database: Session,
    payment: WebsitePayment,
    provider_payment: dict[str, object] | None = None,
) -> dict[str, object]:
    if payment.provider != "razorpay" or not payment.provider_payment_id:
        raise HTTPException(status_code=409, detail="A Razorpay payment reference is required for reconciliation")
    if provider_payment is None:
        provider_payment = await fetch_razorpay_payment(payment.provider_payment_id)
    if (
        provider_payment.get("order_id") != payment.provider_order_id
        or provider_payment.get("amount") != int(Decimal(payment.amount) * 100)
        or provider_payment.get("currency") != payment.currency
    ):
        raise HTTPException(status_code=409, detail="Provider payment details do not match the recorded order")
    order = database.scalar(select(WebsiteOrder).where(WebsiteOrder.id == payment.order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    provider_status = provider_payment.get("status")
    if provider_status == "captured" and payment.status not in {"Captured", "Refunded", "Partially Refunded"}:
        if order.status == "Cancelled":
            refund_key = f"late-capture:{hashlib.sha256(payment.provider_payment_id.encode()).hexdigest()}"
            refund = database.scalar(select(WebsiteRefund).where(WebsiteRefund.idempotency_key == refund_key))
            if refund is None:
                provider_refund = await create_razorpay_refund(payment.provider_payment_id, str(payment.amount))
                refund = WebsiteRefund(
                    refund_id=str(uuid.uuid4()),
                    idempotency_key=refund_key,
                    provider_refund_id=str(provider_refund["id"]),
                    payment_id=payment.id,
                    amount=payment.amount,
                    status="Pending" if provider_refund.get("status") != "processed" else "Processed",
                )
                database.add(refund)
            payment.status = "Refunded" if refund.status == "Processed" else "Captured"
            order.payment_status = payment.status
        else:
            payment.status = "Captured"
            order.payment_status = "Captured"
            order.status = "Confirmed"
            capture_reservations(database, order)
        for attempt in payment.attempts:
            attempt.status = payment.status
            attempt.provider_reference = payment.provider_payment_id
    elif provider_status == "authorized" and order.status == "Pending Payment":
        payment.status = "Authorized"
        order.payment_status = "Authorized"
    elif provider_status == "failed" and order.status == "Pending Payment":
        payment.status = "Failed"
        order.payment_status = "Failed"
        order.status = "Cancelled"
        release_reservations(database, order)
        for attempt in payment.attempts:
            attempt.status = "Failed"
    database.commit()
    return {"payment_status": payment.status, "order_status": order.status}


@app.get("/api/payments/{payment_id}/status", tags=["payments"])
async def payment_status(
    payment_id: str,
    lookup_token: str | None = Header(default=None, alias="X-Order-Access-Token"),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if not lookup_token:
        raise HTTPException(status_code=401, detail="Order access token required")
    payment = database.scalar(select(WebsitePayment).where(WebsitePayment.payment_id == payment_id))
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    order = get_order_for_customer(database, payment.order.order_id, lookup_token)
    if order.id != payment.order_id:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.provider == "razorpay" and payment.status in {"Pending", "Authorized", "Failed"} and payment.provider_payment_id:
        await _reconcile_razorpay_payment(database, payment)
    return {
        "payment_id": payment.payment_id,
        "payment_status": payment.status,
        "order_status": order.status,
        "provider_reference": payment.provider_payment_id,
    }


@app.post("/api/admin/payments/{payment_id}/reconcile", tags=["payments"])
@limiter.limit("30/minute")
async def reconcile_payment(
    request: Request,
    payment_id: str,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    payment = database.scalar(select(WebsitePayment).where(WebsitePayment.payment_id == payment_id).with_for_update())
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    result = await _reconcile_razorpay_payment(database, payment)
    return {"payment_id": payment.payment_id, **result}


@app.post("/api/webhooks/razorpay", tags=["payments"])
async def razorpay_webhook(
    request: Request,
    signature: str | None = Header(default=None, alias="X-Razorpay-Signature"),
    event_id: str | None = Header(default=None, alias="X-Razorpay-Event-Id"),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    raw_body = await request.body()
    if not signature or not verify_razorpay_webhook_signature(raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    if not event_id or len(event_id) > 160:
        raise HTTPException(status_code=400, detail="Missing or invalid webhook event ID")
    duplicate = database.scalar(select(PaymentWebhookEvent.id).where(PaymentWebhookEvent.provider_event_id == event_id))
    if duplicate:
        return {"received": True, "duplicate": True}
    payload = parse_webhook_body(raw_body)
    event_type = payload.get("event")
    if not isinstance(event_type, str):
        raise HTTPException(status_code=400, detail="Webhook event type is missing")
    database.add(PaymentWebhookEvent(
        provider_event_id=event_id,
        event_type=event_type,
        payload=_webhook_summary(event_type, payload),
    ))
    entity: dict[str, object] = {}
    if event_type in {"payment.authorized", "payment.captured", "payment.failed"}:
        payment_payload = payload.get("payload")
        payment_entity = payment_payload.get("payment") if isinstance(payment_payload, dict) else None
        entity_value = payment_entity.get("entity") if isinstance(payment_entity, dict) else None
        if isinstance(entity_value, dict):
            entity = entity_value
        provider_order_id = entity.get("order_id")
        if not isinstance(provider_order_id, str) or not isinstance(entity.get("id"), str):
            raise HTTPException(status_code=400, detail="Webhook payment reference is missing")
        payment = database.scalar(
            select(WebsitePayment).where(WebsitePayment.provider_order_id == provider_order_id).with_for_update()
        )
        if payment:
            order = database.scalar(select(WebsiteOrder).where(WebsiteOrder.id == payment.order_id).with_for_update())
            expected_amount = int(Decimal(payment.amount) * 100)
            if entity.get("amount") != expected_amount or entity.get("currency") != payment.currency:
                raise HTTPException(status_code=400, detail="Webhook payment amount or currency does not match the order")
            webhook_payment_id = str(entity.get("id") or payment.provider_payment_id or "") or None
            if webhook_payment_id:
                conflicting_payment = database.scalar(
                    select(WebsitePayment.id).where(
                        WebsitePayment.provider_payment_id == webhook_payment_id,
                        WebsitePayment.id != payment.id,
                    )
                )
                if conflicting_payment:
                    raise HTTPException(status_code=400, detail="Webhook payment reference is already assigned to another order")
            payment.provider_payment_id = webhook_payment_id
            success = event_type == "payment.captured"
            authorized = event_type == "payment.authorized"
            is_terminal_payment = payment.status in {"Captured", "Refunded", "Partially Refunded"}
            if not is_terminal_payment:
                if authorized:
                    payment.status = "Authorized"
                    if order:
                        order.payment_status = "Authorized"
                    for attempt in payment.attempts:
                        if attempt.status not in {"Captured", "Failed"}:
                            attempt.status = "Authorized"
                else:
                    late_capture = bool(success and order and order.status == "Cancelled")
                    payment.status = "Captured" if success else "Failed"
                    if order:
                        order.payment_status = payment.status
                        if late_capture:
                            order.status = "Cancelled"
                            if payment.provider == "razorpay" and payment.provider_payment_id:
                                refund_key = f"late-capture:{hashlib.sha256(payment.provider_payment_id.encode()).hexdigest()}"
                                refund = database.scalar(select(WebsiteRefund).where(WebsiteRefund.idempotency_key == refund_key))
                                if refund is None:
                                    refund_result = await create_razorpay_refund(
                                        payment.provider_payment_id,
                                        str(payment.amount),
                                    )
                                    refund = WebsiteRefund(
                                        refund_id=str(uuid.uuid4()),
                                        idempotency_key=refund_key,
                                        provider_refund_id=str(refund_result["id"]),
                                        payment_id=payment.id,
                                        amount=payment.amount,
                                        status="Pending" if refund_result.get("status") != "processed" else "Processed",
                                    )
                                    database.add(refund)
                                if refund.status == "Processed":
                                    payment.status = "Refunded"
                                    order.payment_status = "Refunded"
                        elif success:
                            order.status = "Confirmed"
                            capture_reservations(database, order)
                        else:
                            order.status = "Cancelled"
                            release_reservations(database, order)
                    for attempt in payment.attempts:
                        attempt.status = payment.status
                        attempt.provider_reference = payment.provider_payment_id
    elif event_type in {"refund.processed", "refund.failed"}:
        refund_payload = payload.get("payload")
        refund_entity = refund_payload.get("refund") if isinstance(refund_payload, dict) else None
        entity_value = refund_entity.get("entity") if isinstance(refund_entity, dict) else None
        if isinstance(entity_value, dict):
            provider_payment_id = entity_value.get("payment_id")
            payment = database.scalar(
                select(WebsitePayment).where(WebsitePayment.provider_payment_id == provider_payment_id).with_for_update()
            )
            if payment:
                refund = database.scalar(
                    select(WebsiteRefund).where(WebsiteRefund.provider_refund_id == entity_value.get("id"))
                )
                if refund:
                    if refund.payment_id != payment.id or int(Decimal(refund.amount) * 100) != entity_value.get("amount"):
                        raise HTTPException(status_code=400, detail="Webhook refund does not match the recorded refund")
                    refund.status = "Processed" if event_type == "refund.processed" else "Failed"
                    processed_refunds = sum(
                        (item.amount for item in payment.refunds if item.status == "Processed"),
                        start=Decimal("0.00"),
                    )
                    if processed_refunds:
                        payment.status = "Refunded" if processed_refunds >= payment.amount else "Partially Refunded"
                    elif payment.status in {"Refunded", "Partially Refunded"}:
                        payment.status = "Captured"
                    payment.order.payment_status = payment.status
                    if payment.status == "Refunded" and payment.order.status in {"Confirmed", "Processing"}:
                        payment.order.status = "Cancelled"
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        if database.scalar(select(PaymentWebhookEvent.id).where(PaymentWebhookEvent.provider_event_id == event_id)):
            return {"received": True, "duplicate": True}
        raise
    return {"received": True, "duplicate": False}


@app.post("/api/payments/{payment_id}/refund", tags=["payments"])
@limiter.limit("10/minute")
async def refund_payment(
    request: Request,
    payment_id: str,
    payload: RefundRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    if not idempotency_key or len(idempotency_key) > 80:
        raise HTTPException(status_code=400, detail="A valid Idempotency-Key header is required")
    existing_refund = database.scalar(select(WebsiteRefund).where(WebsiteRefund.idempotency_key == idempotency_key))
    if existing_refund:
        if existing_refund.payment.payment_id != payment_id or existing_refund.amount != Decimal(str(payload.amount)).quantize(Decimal("0.01")):
            raise HTTPException(status_code=409, detail="Idempotency key was already used for a different refund")
        return {"refund_id": existing_refund.refund_id, "status": existing_refund.status, "amount": str(existing_refund.amount)}
    payment = database.scalar(select(WebsitePayment).where(WebsitePayment.payment_id == payment_id).with_for_update())
    if payment is None or payment.status not in {"Captured", "Partially Refunded"}:
        raise HTTPException(status_code=409, detail="Only captured payments can be refunded")
    amount = Decimal(str(payload.amount)).quantize(Decimal("0.01"))
    refunded = sum((refund.amount for refund in payment.refunds if refund.status in {"Created", "Pending", "Processed"}), start=Decimal("0.00"))
    if amount <= 0 or refunded + amount > payment.amount:
        raise HTTPException(status_code=422, detail="Refund amount exceeds the captured amount")
    provider_refund_id = None
    refund_status = "Processed"
    if payment.provider == "mock":
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Mock refunds are disabled in production")
    elif payment.provider == "razorpay":
        if not payment.provider_payment_id:
            raise HTTPException(status_code=409, detail="Provider payment reference is missing")
        result = await create_razorpay_refund(payment.provider_payment_id, str(amount))
        provider_refund_id = str(result["id"])
        refund_status = "Pending" if result.get("status") != "processed" else "Processed"
    else:
        raise HTTPException(status_code=503, detail="Unsupported payment provider")
    refund = WebsiteRefund(
        refund_id=str(uuid.uuid4()),
        idempotency_key=idempotency_key,
        payment_id=payment.id,
        provider_refund_id=provider_refund_id,
        amount=amount,
        status=refund_status,
    )
    database.add(refund)
    if refund_status == "Processed":
        processed_total = sum(
            (item.amount for item in payment.refunds if item.status == "Processed"),
            start=Decimal("0.00"),
        ) + amount
        payment.status = "Refunded" if processed_total >= payment.amount else "Partially Refunded"
        payment.order.payment_status = payment.status
        if payment.status == "Refunded" and payment.order.status in {"Confirmed", "Processing"}:
            payment.order.status = "Cancelled"
    database.commit()
    return {"refund_id": refund.refund_id, "status": refund.status, "amount": str(refund.amount)}


@app.get("/api/admin/orders/{order_id}/transactions", tags=["orders"])
def website_order_transactions(
    order_id: str,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> list[dict[str, object]]:
    order = database.scalar(select(WebsiteOrder).where(WebsiteOrder.order_id == order_id))
    if order is None:
        raise HTTPException(status_code=404, detail="Website order not found")
    payment = database.scalar(
        select(WebsitePayment)
        .options(joinedload(WebsitePayment.attempts), joinedload(WebsitePayment.refunds))
        .where(WebsitePayment.order_id == order.id)
    )
    if payment is None:
        return []
    records: list[dict[str, object]] = [{
        "type": "payment",
        "provider": payment.provider,
        "status": payment.status,
        "amount": str(payment.amount),
        "created_at": payment.created_at,
    }]
    records.extend({
        "type": "attempt",
        "status": attempt.status,
        "created_at": attempt.created_at,
    } for attempt in payment.attempts)
    records.extend({
        "type": "refund",
        "status": refund.status,
        "amount": str(refund.amount),
        "created_at": refund.created_at,
    } for refund in payment.refunds)
    return records


@app.get("/api/admin/orders/{order_id}", tags=["orders"])
def website_order_admin_detail(
    order_id: str,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    order = database.scalar(
        select(WebsiteOrder)
        .options(joinedload(WebsiteOrder.items), joinedload(WebsiteOrder.payments))
        .where(WebsiteOrder.order_id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Website order not found")
    return _serialize_website_order_admin_detail(order)


@app.patch("/api/admin/orders/{order_id}/status", tags=["orders"])
def update_website_order_status(
    order_id: str,
    payload: FulfillmentUpdate,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, str]:
    order = database.scalar(select(WebsiteOrder).where(WebsiteOrder.order_id == order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Website order not found")
    allowed = {
        "Confirmed": {"Processing"},
        "Processing": {"Shipped"},
        "Shipped": {"Delivered"},
    }
    if payload.status != order.status and payload.status not in allowed.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move order from {order.status} to {payload.status}")
    if order.payment_status not in {"Captured", "Partially Refunded", "Refunded"}:
        raise HTTPException(status_code=409, detail="Fulfilment updates require a captured payment")
    order.status = payload.status
    database.commit()
    return {"order_id": order.order_id, "status": order.status}


@app.post("/api/auth/login", tags=["auth"])
def login(payload: LoginRequest, response: Response, database: Session = Depends(get_db)) -> SessionResponse:
    user = database.scalar(select(AdminUser).where(AdminUser.username == payload.username))
    if user is None or not user.is_active or not verify_password(database, user, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    token = create_session(database, user)
    set_session_cookie(response, token)
    return SessionResponse(user=UserResponse(username=user.username), csrf_token=csrf_token(token))


@app.post("/api/auth/logout", status_code=204, tags=["auth"])
def logout(
    response: Response,
    database: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    submitted_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    if session_token:
        if not submitted_csrf_token or not hmac.compare_digest(csrf_token(session_token), submitted_csrf_token):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
        session = database.scalar(select(AdminSession).where(AdminSession.token_hash == _token_hash(session_token)))
        if session:
            session.revoked_at = _now()
            database.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@app.get("/api/auth/session", response_model=SessionResponse, tags=["auth"])
def session_status(
    user: AdminUser = Depends(require_admin),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> SessionResponse:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return SessionResponse(user=UserResponse(username=user.username), csrf_token=csrf_token(session_token))


@app.get("/api/dashboard/summary", tags=["dashboard"])
def dashboard_summary(
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, str | int]:
    flipkart_order_count = database.scalar(select(func.count(FlipkartOrder.id))) or 0
    website_order_count = database.scalar(select(func.count(WebsiteOrder.id))) or 0
    pending_count = database.scalar(
        select(func.count(WebsiteOrder.id)).where(WebsiteOrder.payment_status.in_(["Created", "Pending"]))
    ) or 0
    flipkart_pending_count = database.scalar(
        select(func.count(FlipkartOrder.id)).where(FlipkartOrder.status == "pending")
    ) or 0
    flipkart_revenue = database.scalar(
        select(func.coalesce(func.sum(FlipkartOrder.total_amount), 0))
    ) or 0
    website_revenue = database.scalar(
        select(func.coalesce(func.sum(WebsiteOrder.total_amount), 0)).where(WebsiteOrder.payment_status == "Captured")
    ) or 0
    return {
        "orders": flipkart_order_count + website_order_count,
        "pending_orders": pending_count + flipkart_pending_count,
        "revenue": str(flipkart_revenue + website_revenue),
        "profit": "0.00",
        "message": f"Authenticated as {user.username}",
    }


@app.get("/api/orders", tags=["orders"])
def list_orders(
    user: AdminUser = Depends(require_admin),
    limit: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
    payment_status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    database: Session = Depends(get_db),
) -> list[dict[str, object]]:
    flipkart_query = select(FlipkartOrder)
    if date_from:
        flipkart_query = flipkart_query.where(FlipkartOrder.order_date >= date_from)
    if date_to:
        flipkart_query = flipkart_query.where(FlipkartOrder.order_date <= date_to)
    flipkart_orders = database.scalars(
        flipkart_query.order_by(FlipkartOrder.order_date.desc()).limit(limit)
    ).all()
    website_query = select(WebsiteOrder).options(
        joinedload(WebsiteOrder.items),
        joinedload(WebsiteOrder.payments),
    )
    if date_from:
        website_query = website_query.where(WebsiteOrder.created_at >= date_from)
    if date_to:
        website_query = website_query.where(WebsiteOrder.created_at <= date_to)
    website_orders = database.scalars(
        website_query.order_by(WebsiteOrder.created_at.desc()).limit(limit)
    ).unique().all()
    records = [
        {
            "order_id": order.order_id,
            "shipment_id": order.shipment_id,
            "source": "flipkart",
            "order_date": order.order_date,
            "status": order.status,
            "payment_status": order.payment_status,
            "total_amount": str(order.total_amount),
        }
        for order in flipkart_orders
    ]
    records.extend({
        "order_id": order.order_id,
        "source": "website",
        "order_date": order.created_at,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payments[0].provider if order.payments else None,
        "total_amount": str(order.total_amount),
    } for order in website_orders)
    if status_filter:
        records = [item for item in records if str(item["status"]).lower() == status_filter.lower()]
    if payment_status:
        records = [item for item in records if str(item.get("payment_status", "")).lower() == payment_status.lower()]
    records.sort(key=lambda item: str(item.get("order_date") or ""), reverse=True)
    return records[:limit]


@app.get("/api/returns", tags=["returns"])
def list_returns(
    user: AdminUser = Depends(require_admin),
    limit: int = Query(default=50, ge=1, le=200),
    database: Session = Depends(get_db),
) -> list[dict[str, object]]:
    returns = database.scalars(select(ReturnRecord).order_by(ReturnRecord.return_date.desc()).limit(limit)).all()
    return [
        {
            "return_id": item.return_id,
            "order_id": item.order.order_id,
            "product_name": item.product_name,
            "sku": item.sku,
            "return_date": item.return_date,
            "reason": item.reason,
            "status": item.status,
            "refund_amount": str(item.refund_amount or 0),
        }
        for item in returns
    ]


@app.post("/api/sync/flipkart/check", tags=["sync"])
async def flipkart_connection_check(
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    return await check_flipkart_connection(database)
