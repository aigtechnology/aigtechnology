import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
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
from sqlalchemy.orm import Session, joinedload, selectinload

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
from .delivery import lookup_pincode
from .database import Base, engine, get_db
from .firebase_auth import require_firebase_admin, verify_firebase_token
from .models import AdminSession, AdminUser
from .business_models import (
    CustomerSession,
    FlipkartOrder,
    Inventory,
    PaymentAttempt,
    PaymentWebhookEvent,
    Product,
    ReturnRecord,
    WebsiteOrder,
    WebsiteCustomer,
    WebsitePayment,
    WebsiteRefund,
    OfflinePurchase,
    ServiceRequest,
    DeliveryChargeRule,
    InventoryMovement,
)
from .payment_providers import (
    create_razorpay_order,
    create_razorpay_refund,
    fetch_razorpay_payment,
    parse_webhook_body,
    verify_razorpay_payment_signature,
    verify_razorpay_webhook_signature,
)
from .notifications import get_dispatch_date, get_dispatch_working_days, send_dispatch_email, send_order_emails, set_dispatch_working_days
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
    DispatchSettingsUpdate,
    DispatchNotificationRequest,
    UserResponse,
    VerifyPaymentRequest,
    PurchaseVerificationRequest,
    ServiceRequestCreate,
    ServiceRequestUpdate,
    FirebaseCustomerSessionRequest,
    DeliveryChargeRuleInput,
    InventoryAdjustmentRequest,
    InventoryThresholdRequest,
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
        if settings.payment_provider != "razorpay":
            raise RuntimeError("Production requires Razorpay payments.")
        if (
            not settings.razorpay_key_id.startswith("rzp_live_")
            or not settings.razorpay_key_secret
            or not settings.razorpay_webhook_secret
        ):
            raise RuntimeError("Production validation requires live Razorpay credentials and a webhook secret.")
        with engine.connect() as connection:
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
        if revision != "20261118_02":
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

    if settings.rate_limit_storage_uri and settings.rate_limit_storage_uri.startswith(("redis://", "rediss://")):
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
    elif settings.rate_limit_storage_uri == "memory://":
        checks["redis"] = "ok"
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
        "dispatch_date": get_dispatch_date(order.created_at),
        "actual_dispatch_date": order.actual_dispatch_date,
        "estimated_delivery_date": order.estimated_delivery_date,
        "carrier": order.carrier,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
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
        "subtotal": str(order.subtotal),
        "delivery_charge": str(order.delivery_charge),
        "items": [
            {"name": item.name, "sku": item.sku, "quantity": item.quantity,
             "product_order_number": item.product_order_number,
             "product_order_reference": item.product_order_reference,
             "base_unit_price": str(item.base_unit_price or item.unit_price),
             "upgrade_amount": str(item.upgrade_amount or 0),
             "configuration": item.configuration or {},
             "unit_price": str(item.unit_price), "subtotal": str(item.subtotal)}
            for item in order.items
        ],
        "shipping_address": order.shipping_address,
    }

def _serialize_website_order_admin_detail(order: WebsiteOrder) -> dict[str, object]:
    customer = order.customer
    payment = order.payments[0] if order.payments else None
    return {
        "order_id": order.order_id,
        "source": "website",
        "order_date": order.created_at,
        "dispatch_date": get_dispatch_date(order.created_at),
        "actual_dispatch_date": order.actual_dispatch_date,
        "estimated_delivery_date": order.estimated_delivery_date,
        "carrier": order.carrier,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
        "customer": customer.full_name,
        "customer_email": customer.email,
        "customer_phone": customer.phone,
        "customer_account_id": customer.id,
        "customer_firebase_uid": customer.firebase_uid,
        "customer_auth_provider": customer.auth_provider or "guest",
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": payment.provider if payment else None,
        "payment_id": payment.payment_id if payment else None,
        "payment_reference": payment.provider_payment_id if payment else None,
        "total_amount": str(order.total_amount),
        "subtotal": str(order.subtotal),
        "delivery_charge": str(order.delivery_charge),
        "shipping_address": order.shipping_address,
        "billing_address": order.billing_address,
        "items": [
            {"name": item.name, "sku": item.sku, "quantity": item.quantity,
             "product_order_number": item.product_order_number,
             "product_order_reference": item.product_order_reference,
             "base_unit_price": str(item.base_unit_price or item.unit_price),
             "upgrade_amount": str(item.upgrade_amount or 0),
             "configuration": item.configuration or {},
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
            category=payload.category,
            selling_price=synced_price,
            is_active=payable,
            image_url=payload.image_url,
            catalog_stock_quantity=payload.stock_quantity,
            structured_specifications=payload.specifications,
            upgrade_options=payload.upgrade_options,
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
        product.category = payload.category
        product.selling_price = synced_price
        product.is_active = payable
        product.image_url = payload.image_url
        product.structured_specifications = payload.specifications
        product.upgrade_options = payload.upgrade_options
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
    return calculate_cart(database, payload.items, payload.postal_code)


@app.get("/api/delivery/lookup", tags=["checkout"])
@limiter.limit("30/minute")
def lookup_delivery(request: Request, postal_code: str = Query(..., min_length=6, max_length=6)) -> dict[str, object]:
    return lookup_pincode(postal_code)


@app.post("/api/orders/create", tags=["orders"])
@limiter.limit("10/minute")
def create_order(
    request: Request,
    payload: CreateOrderRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    authorization: str | None = Header(default=None),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    firebase_uid = None
    if authorization:
        firebase_uid = str(verify_firebase_token(authorization).get("sub") or "") or None
    return create_website_order(database, payload, idempotency_key or "", firebase_uid=firebase_uid)


def _normalize_mobile(value: str) -> str:
    digits = "".join(character for character in str(value) if character.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits


CUSTOMER_SESSION_COOKIE = "aig_customer_session"
CUSTOMER_SESSION_LIFETIME = timedelta(days=30)


def _customer_session_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _customer_session(database: Session, token: str | None) -> CustomerSession:
    if not token:
        raise HTTPException(status_code=401, detail="Customer verification is required")
    session = database.scalar(select(CustomerSession).where(CustomerSession.token_hash == _customer_session_hash(token)))
    if session is None or session.revoked_at is not None or session.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Customer session has expired")
    return session


def _issue_customer_session(database: Session, customer_id: int | None, normalized_phone: str | None, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    database.add(CustomerSession(
        token_hash=_customer_session_hash(token),
        customer_id=customer_id,
        normalized_phone=normalized_phone,
        expires_at=datetime.now(UTC) + CUSTOMER_SESSION_LIFETIME,
    ))
    response.set_cookie(
        CUSTOMER_SESSION_COOKIE,
        token,
        max_age=int(CUSTOMER_SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        path="/",
    )


def _link_firebase_customer(database: Session, customer: WebsiteCustomer, claims: dict[str, object]) -> None:
    firebase_uid = str(claims.get("sub") or "")
    if not firebase_uid:
        raise HTTPException(status_code=401, detail="Firebase account identity is missing")
    linked = database.scalar(
        select(WebsiteCustomer).where(WebsiteCustomer.firebase_uid == firebase_uid).with_for_update()
    )
    if linked is not None and linked.id != customer.id:
        raise HTTPException(status_code=409, detail="This Google account is already linked to another customer account")
    if customer.firebase_uid not in {None, firebase_uid}:
        raise HTTPException(status_code=409, detail="This customer account is already linked to another Google account")
    customer.firebase_uid = firebase_uid
    customer.auth_provider = "google"
    email = str(claims.get("email") or "").strip()
    name = str(claims.get("name") or "").strip()
    if email and (not customer.email or customer.email.endswith("@guest.aigtechnology.local")):
        customer.email = email
    if name and not customer.full_name.strip():
        customer.full_name = name


@app.post("/api/customer/firebase-session", tags=["customer service"])
@limiter.limit("10/minute")
def customer_firebase_session(
    request: Request,
    payload: FirebaseCustomerSessionRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    claims = verify_firebase_token(authorization)
    firebase_uid = str(claims.get("sub") or "")
    customer = database.scalar(select(WebsiteCustomer).where(WebsiteCustomer.firebase_uid == firebase_uid).with_for_update())
    if payload.invoice_number or payload.mobile:
        if not payload.invoice_number or not payload.mobile:
            raise HTTPException(status_code=422, detail="Both purchase reference and registered mobile are required to link the account")
        records = _find_verified_purchases(database, PurchaseVerificationRequest(invoice_number=payload.invoice_number, mobile=payload.mobile))
        if not records:
            raise HTTPException(status_code=404, detail="No verified purchase was found for that mobile number and reference")
        mobile = _normalize_mobile(payload.mobile)
        customer = database.scalar(select(WebsiteCustomer).where(WebsiteCustomer.normalized_phone == mobile).order_by(WebsiteCustomer.id).limit(1).with_for_update())
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer account was not found for that purchase")
        _link_firebase_customer(database, customer, claims)
    if customer is None:
        return {"authenticated": False, "linked": False, "message": "Google verified. Verify a purchase with Order ID and mobile number to link your account."}
    _issue_customer_session(database, customer.id, customer.normalized_phone, response)
    database.commit()
    return {"authenticated": True, "linked": True, "customer_id": customer.id}


def _warranty_status(purchase_date: datetime, warranty_months: int) -> tuple[str, str | None]:
    if not warranty_months or warranty_months <= 0:
        return "Warranty Not Available", None
    start = purchase_date if purchase_date.tzinfo else purchase_date.replace(tzinfo=UTC)
    expiry = start + timedelta(days=round(warranty_months * 30.4375))
    return ("Under Warranty" if expiry >= datetime.now(UTC) else "Warranty Expired", expiry.isoformat())


def _purchase_record_from_offline(item: OfflinePurchase) -> dict[str, object]:
    warranty_status, warranty_expiry = _warranty_status(item.purchase_date, item.warranty_months)
    return {
        "source": item.invoice_type,
        "invoice_type": item.invoice_type,
        "reference": item.invoice_number,
        "customer_name": item.customer_name,
        "mobile": item.mobile,
        "email": item.email,
        "purchase_date": item.purchase_date.isoformat(),
        "warranty_status": warranty_status,
        "warranty_expiry": warranty_expiry,
        "service_eligibility": "Eligible",
        "products": [{
            "name": item.product_name,
            "sku": item.product_model or "ITEM",
            "model": item.product_model,
            "serial_number": item.serial_number,
            "quantity": 1,
            "warranty_months": item.warranty_months,
            "invoice_amount": str(item.invoice_amount),
            "warranty_status": warranty_status,
        }],
    }


def _purchase_record_from_online(order: WebsiteOrder) -> dict[str, object]:
    return {
        "source": "ONLINE",
        "invoice_type": "ONLINE",
        "reference": order.order_id,
        "customer_name": order.customer.full_name,
        "mobile": order.customer.phone,
        "email": order.customer.email,
        "purchase_date": order.created_at.isoformat(),
        "order_status": order.status,
        "payment_status": order.payment_status,
        "dispatch_date": get_dispatch_date(order.created_at),
        "actual_dispatch_date": order.actual_dispatch_date.isoformat() if order.actual_dispatch_date else None,
        "estimated_delivery_date": order.estimated_delivery_date.isoformat() if order.estimated_delivery_date else None,
        "carrier": order.carrier,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
        "warranty_status": "Verification Required",
        "warranty_expiry": None,
        "service_eligibility": "Eligible" if order.payment_status == "Captured" else "Payment not captured",
        "products": [{
            "name": item.name,
            "sku": item.sku,
            "model": item.sku,
            "serial_number": "",
            "quantity": item.quantity,
            "warranty_months": 0,
            "invoice_amount": str(item.subtotal),
            "product_order_reference": item.product_order_reference,
            "warranty_status": "Verification Required",
        } for item in order.items],
    }


def _find_verified_purchases(database: Session, payload: PurchaseVerificationRequest) -> list[dict[str, object]]:
    mobile = _normalize_mobile(payload.mobile)
    records: list[dict[str, object]] = []
    if payload.invoice_type in {None, "GST", "NON_GST"}:
        query = select(OfflinePurchase).where(
            OfflinePurchase.mobile == mobile,
            OfflinePurchase.invoice_number == payload.invoice_number,
        )
        if payload.invoice_type:
            query = query.where(OfflinePurchase.invoice_type == payload.invoice_type)
        records.extend(_purchase_record_from_offline(item) for item in database.scalars(query.order_by(OfflinePurchase.purchase_date.desc())).all())
    if payload.invoice_type in {None, "ONLINE"}:
        order = database.scalar(
            select(WebsiteOrder)
            .join(WebsiteCustomer, WebsiteOrder.customer_id == WebsiteCustomer.id)
            .options(joinedload(WebsiteOrder.customer), selectinload(WebsiteOrder.items))
            .where(WebsiteCustomer.normalized_phone == mobile, WebsiteOrder.order_id == payload.invoice_number)
        )
        if order and order.payment_status == "Captured":
            records.append(_purchase_record_from_online(order))
    return records


@app.post("/api/customer/verify-purchase", tags=["customer service"])
@limiter.limit("10/minute")
def verify_customer_purchase(
    request: Request,
    payload: PurchaseVerificationRequest,
    response: Response,
    authorization: str | None = Header(default=None),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    records = _find_verified_purchases(database, payload)
    if not records:
        raise HTTPException(status_code=404, detail="No verified purchase was found for that mobile number and reference.")
    mobile = _normalize_mobile(payload.mobile)
    customer = database.scalar(select(WebsiteCustomer).where(WebsiteCustomer.normalized_phone == mobile).order_by(WebsiteCustomer.id).limit(1))
    online_order = database.scalar(
        select(WebsiteOrder)
        .join(WebsiteCustomer, WebsiteOrder.customer_id == WebsiteCustomer.id)
        .where(WebsiteCustomer.normalized_phone == mobile, WebsiteOrder.order_id == payload.invoice_number)
    )
    target_customer = online_order.customer if online_order else customer
    if target_customer is None:
        raise HTTPException(status_code=404, detail="Customer account was not found for that purchase")
    if authorization:
        _link_firebase_customer(database, target_customer, verify_firebase_token(authorization))
    _issue_customer_session(database, target_customer.id, mobile, response)
    database.commit()
    first = records[0]
    return {**first, "verified": True, "account_authenticated": True, "verified_mobile": mobile, "purchases": records}


@app.get("/api/customer/account", tags=["customer service"])
def customer_account(
    customer_session: str | None = Cookie(default=None, alias=CUSTOMER_SESSION_COOKIE),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    session = _customer_session(database, customer_session)
    orders = database.scalars(
        select(WebsiteOrder)
        .join(WebsiteCustomer, WebsiteOrder.customer_id == WebsiteCustomer.id)
        .options(joinedload(WebsiteOrder.customer), selectinload(WebsiteOrder.items), selectinload(WebsiteOrder.payments))
        .where(
            WebsiteCustomer.normalized_phone == session.normalized_phone,
            WebsiteOrder.payment_status.in_(["Captured", "Partially Refunded", "Refunded"]),
        )
        .order_by(WebsiteOrder.created_at.desc())
    ).all()
    offline = database.scalars(select(OfflinePurchase).where(OfflinePurchase.mobile == session.normalized_phone).order_by(OfflinePurchase.purchase_date.desc())).all()
    customer = session.customer or (orders[0].customer if orders else None)
    profile = (
        {"full_name": customer.full_name, "phone": customer.phone, "email": customer.email}
        if customer else
        {"full_name": offline[0].customer_name if offline else "Verified customer", "phone": session.normalized_phone, "email": offline[0].email if offline else None}
    )
    return {
        "customer": profile,
        "verified_mobile": session.normalized_phone,
        "orders": [_serialize_website_order(order) for order in orders],
        "offline_purchases": [_purchase_record_from_offline(item) for item in offline],
    }


@app.post("/api/customer/logout", status_code=204, tags=["customer service"])
def customer_logout(
    response: Response,
    customer_session: str | None = Cookie(default=None, alias=CUSTOMER_SESSION_COOKIE),
    database: Session = Depends(get_db),
) -> None:
    if customer_session:
        session = database.scalar(select(CustomerSession).where(CustomerSession.token_hash == _customer_session_hash(customer_session)))
        if session:
            session.revoked_at = datetime.now(UTC)
            database.commit()
    response.delete_cookie(CUSTOMER_SESSION_COOKIE, path="/")


@app.post("/api/service-requests", tags=["customer service"])
@limiter.limit("5/minute")
def create_service_request(
    request: Request,
    payload: ServiceRequestCreate,
    database: Session = Depends(get_db),
) -> dict[str, object]:
    verification = _find_verified_purchases(database, PurchaseVerificationRequest(
        invoice_type=payload.purchase_type,
        invoice_number=payload.purchase_reference,
        mobile=payload.purchase_mobile,
    ))
    if not verification:
        raise HTTPException(status_code=403, detail="Purchase verification is required before booking a service.")
    reference_id = f"SR-{datetime.now(UTC):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"
    service_request = ServiceRequest(
        reference_id=reference_id,
        customer_name=payload.customer_name,
        phone=payload.phone,
        email=payload.email,
        service_category=payload.service_category,
        device_type=payload.device_type,
        brand_model=payload.brand_model or "",
        problem_description=payload.problem_description,
        address="",
        preferred_contact_time="",
        image_urls=payload.image_urls,
        purchase_type=payload.purchase_type,
        purchase_reference=payload.purchase_reference,
        purchase_mobile=payload.purchase_mobile,
    )
    database.add(service_request)
    database.commit()
    return {"reference_id": reference_id, "status": service_request.status, "verified_purchase": verification[0]}


@app.get("/api/admin/service-requests", tags=["customer service"])
def list_service_requests(
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> list[dict[str, object]]:
    requests = database.scalars(select(ServiceRequest).order_by(ServiceRequest.created_at.desc()).limit(500)).all()
    return [{
        "reference_id": item.reference_id, "customer_name": item.customer_name, "phone": item.phone,
        "email": item.email, "service_category": item.service_category, "device_type": item.device_type,
        "brand_model": item.brand_model, "problem_description": item.problem_description,
        "address": item.address, "preferred_contact_time": item.preferred_contact_time,
        "image_urls": item.image_urls or [], "purchase_type": item.purchase_type,
        "purchase_reference": item.purchase_reference, "status": item.status,
        "assigned_to": item.assigned_to, "internal_notes": item.internal_notes,
        "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat(),
    } for item in requests]


@app.patch("/api/admin/service-requests/{reference_id}", tags=["customer service"])
def update_service_request(
    reference_id: str,
    payload: ServiceRequestUpdate,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, str]:
    item = database.scalar(select(ServiceRequest).where(ServiceRequest.reference_id == reference_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Service request not found")
    item.status = payload.status
    item.assigned_to = payload.assigned_to
    item.internal_notes = payload.internal_notes
    database.commit()
    return {"reference_id": item.reference_id, "status": item.status}


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
        .options(
            joinedload(WebsiteOrder.customer),
            selectinload(WebsiteOrder.items),
            selectinload(WebsiteOrder.payments),
        )
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
    if payment.provider != "razorpay":
        raise HTTPException(status_code=503, detail="Only Razorpay payments are supported")
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=503, detail="Razorpay webhook verification is not configured")
    if payment.provider_order_id:
        return {
            "provider": "razorpay", "key_id": settings.razorpay_key_id,
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
        "provider": "razorpay", "key_id": settings.razorpay_key_id,
        "provider_order_id": payment.provider_order_id, "payment_id": payment.payment_id,
        "amount": str(payment.amount), "currency": payment.currency,
    }


@app.post("/api/payments/verify", tags=["payments"])
@limiter.limit("10/minute")
async def verify_payment(
    request: Request,
    payload: VerifyPaymentRequest,
    response: Response,
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
        customer = database.get(WebsiteCustomer, order.customer_id)
        if customer:
            _issue_customer_session(database, customer.id, customer.normalized_phone, response)
            database.commit()
        return {"order_id": order.order_id, "payment_status": payment.status, "order_status": order.status}
    if payment.status in {"Failed", "Refunded", "Partially Refunded"}:
        raise HTTPException(status_code=409, detail="Payment attempt is already in a terminal state")
    if payment.status not in {"Pending", "Authorized"}:
        raise HTTPException(status_code=409, detail="Start the payment provider flow before verification")

    if payment.provider != "razorpay":
        raise HTTPException(status_code=503, detail="Only Razorpay payments are supported")
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
    result = await _reconcile_razorpay_payment(database, payment, provider_payment)
    if result.get("payment_status") == "Captured":
        customer = database.get(WebsiteCustomer, order.customer_id)
        if customer:
            _issue_customer_session(database, customer.id, customer.normalized_phone, response)
            database.commit()
    return {"order_id": order.order_id, **result}


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
    captured_transition = provider_status == "captured" and payment.status not in {"Captured", "Refunded", "Partially Refunded"}
    if captured_transition:
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
    if captured_transition and payment.status == "Captured":
        await send_order_emails(order, payment)
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
    captured_order: WebsiteOrder | None = None
    captured_payment: WebsitePayment | None = None
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
                            captured_order = order
                            captured_payment = payment
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
    if captured_order is not None and captured_payment is not None:
        await send_order_emails(captured_order, captured_payment)
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
    if payment.provider == "razorpay":
        if not payment.provider_payment_id:
            raise HTTPException(status_code=409, detail="Provider payment reference is missing")
        result = await create_razorpay_refund(payment.provider_payment_id, str(amount))
        provider_refund_id = str(result["id"])
        refund_status = "Pending" if result.get("status") != "processed" else "Processed"
    else:
        raise HTTPException(status_code=503, detail="Only Razorpay refunds are supported")
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
        .options(selectinload(WebsitePayment.attempts), selectinload(WebsitePayment.refunds))
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
        .options(
            joinedload(WebsiteOrder.customer),
            selectinload(WebsiteOrder.items),
            selectinload(WebsiteOrder.payments),
        )
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
        "Order Placed": {"Confirmed", "Processing", "Cancelled"}, "Confirmed": {"Processing", "Cancelled"},
        "Processing": {"Packed", "Cancelled"}, "Packed": {"Shipped", "Cancelled"},
        "Shipped": {"In Transit", "Out for Delivery", "Delivery Failed", "Returned"},
        "In Transit": {"Out for Delivery", "Delivery Failed", "Returned"},
        "Out for Delivery": {"Delivered", "Delivery Failed", "Returned"},
        "Delivered": {"Returned"}, "Delivery Failed": {"In Transit", "Returned", "Cancelled"},
        "Returned": set(), "Cancelled": set(),
    }
    if payload.status != order.status and payload.status not in allowed.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move order from {order.status} to {payload.status}")
    if order.payment_status not in {"Captured", "Partially Refunded", "Refunded"}:
        raise HTTPException(status_code=409, detail="Fulfilment updates require a captured payment")
    order.status = payload.status
    database.commit()
    return {"order_id": order.order_id, "status": order.status}


@app.post("/api/admin/orders/{order_id}/dispatch", tags=["orders"])
async def dispatch_website_order(
    order_id: str,
    payload: DispatchNotificationRequest,
    user: AdminUser = Depends(require_admin),
    database: Session = Depends(get_db),
) -> dict[str, object]:
    order = database.scalar(
        select(WebsiteOrder)
        # Keep the row lock limited to website_orders.  joinedload() adds a
        # LEFT OUTER JOIN for the nullable customer_id, and PostgreSQL rejects
        # FOR UPDATE when it would also lock the nullable side of that join.
        .options(selectinload(WebsiteOrder.customer), selectinload(WebsiteOrder.payments))
        .where(WebsiteOrder.order_id == order_id)
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Website order not found")
    if order.payment_status not in {"Captured", "Partially Refunded"}:
        raise HTTPException(status_code=409, detail="Dispatch updates require a captured payment")
    order.carrier = payload.carrier.strip() if payload.carrier else None
    order.tracking_number = payload.tracking_number.strip()
    if payload.tracking_url and not payload.tracking_url.startswith(("https://", "http://")):
        raise HTTPException(status_code=422, detail="Tracking URL must start with http:// or https://")
    order.tracking_url = payload.tracking_url.strip() if payload.tracking_url else None
    order.actual_dispatch_date = payload.actual_dispatch_date or datetime.now(UTC)
    order.estimated_delivery_date = payload.estimated_delivery_date
    if order.status in {"Confirmed", "Processing", "Packed"}:
        order.status = "Shipped"
    database.commit()
    dispatch_date = get_dispatch_date(order.created_at)
    email_sent = await send_dispatch_email(order, dispatch_date)
    return {
        "order_id": order.order_id,
        "status": order.status,
        "dispatch_date": dispatch_date,
        "carrier": order.carrier,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
        "actual_dispatch_date": order.actual_dispatch_date,
        "estimated_delivery_date": order.estimated_delivery_date,
        "email_sent": email_sent,
    }


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
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    database: Session = Depends(get_db),
) -> dict[str, object]:
    now = datetime.now(UTC)
    start = date_from or datetime(now.year, now.month, now.day, tzinfo=UTC) - timedelta(days=29)
    end = date_to or now
    paid_filter = WebsiteOrder.payment_status.in_(["Captured", "Partially Refunded"])
    date_filter = WebsiteOrder.created_at >= start, WebsiteOrder.created_at <= end
    paid_orders = database.scalars(select(WebsiteOrder).where(paid_filter, *date_filter)).all()
    successful_revenue = sum((Decimal(order.total_amount) for order in paid_orders), start=Decimal("0.00"))
    refunded_amount = database.scalar(select(func.coalesce(func.sum(WebsiteRefund.amount), 0)).join(WebsitePayment).where(WebsiteRefund.status == "Processed", WebsiteRefund.created_at >= start, WebsiteRefund.created_at <= end)) or 0
    status_counts = {status_name: database.scalar(select(func.count(WebsiteOrder.id)).where(WebsiteOrder.status == status_name, *date_filter)) or 0 for status_name in ["Pending Payment", "Confirmed", "Processing", "Packed", "Shipped", "In Transit", "Out for Delivery", "Delivered", "Cancelled"]}
    total_products = database.scalar(select(func.count(Product.id)).where(Product.is_active.is_(True))) or 0
    inventory_rows = database.execute(select(Product, Inventory).join(Inventory, Inventory.product_id == Product.id, isouter=True).where(Product.is_active.is_(True))).all()
    total_stock = sum((int(row[1].available_quantity) for row in inventory_rows if row[1]), start=0)
    low_stock = sum(1 for product, inventory in inventory_rows if inventory and 0 < inventory.available_quantity <= product.low_stock_threshold)
    out_of_stock = sum(1 for product, inventory in inventory_rows if not inventory or inventory.available_quantity <= 0)
    customers = database.scalar(select(func.count(WebsiteCustomer.id))) or 0
    new_customers = database.scalar(select(func.count(WebsiteCustomer.id)).where(WebsiteCustomer.created_at >= start, WebsiteCustomer.created_at <= end)) or 0
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
        "range": {"from": start, "to": end},
        "orders": flipkart_order_count + website_order_count,
        "orders_in_range": len(paid_orders) + (database.scalar(select(func.count(FlipkartOrder.id)).where(FlipkartOrder.order_date >= start, FlipkartOrder.order_date <= end)) or 0),
        "pending_orders": pending_count + flipkart_pending_count,
        "revenue": str(successful_revenue),
        "refunded_amount": str(Decimal(refunded_amount)),
        "net_revenue": str(successful_revenue - Decimal(refunded_amount)),
        "profit": "0.00",
        "today_sales": str(sum((Decimal(order.total_amount) for order in paid_orders if order.created_at and order.created_at.date() == now.date()), start=Decimal("0.00"))),
        "monthly_sales": str(successful_revenue),
        "successful_payments": len(paid_orders),
        "failed_payments": database.scalar(select(func.count(WebsiteOrder.id)).where(WebsiteOrder.payment_status == "Failed", *date_filter)) or 0,
        "pending_payments": database.scalar(select(func.count(WebsiteOrder.id)).where(WebsiteOrder.payment_status.in_(["Created", "Pending"]), *date_filter)) or 0,
        "status_counts": status_counts,
        "products": {"total": total_products, "low_stock": low_stock, "out_of_stock": out_of_stock, "available_stock": total_stock},
        "customers": {"total": customers, "new": new_customers},
        "message": f"Authenticated as {user.username}",
    }


@app.get("/api/admin/delivery-charges", tags=["settings"])
def list_delivery_charge_rules(user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> list[dict[str, object]]:
    return [{"category": rule.category, "region": rule.region, "charge_amount": str(rule.charge_amount), "charge_type": rule.charge_type, "free_delivery": rule.free_delivery, "free_delivery_minimum": str(rule.free_delivery_minimum) if rule.free_delivery_minimum is not None else None, "enabled": rule.enabled} for rule in database.scalars(select(DeliveryChargeRule).order_by(DeliveryChargeRule.category, DeliveryChargeRule.region)).all()]


@app.put("/api/admin/delivery-charges", tags=["settings"])
def save_delivery_charge_rule(payload: DeliveryChargeRuleInput, user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> dict[str, object]:
    category = payload.category.strip()
    rule = database.scalar(select(DeliveryChargeRule).where(func.lower(DeliveryChargeRule.category) == category.casefold(), DeliveryChargeRule.region == payload.region).with_for_update())
    if rule is None:
        rule = DeliveryChargeRule(category=category, region=payload.region)
        database.add(rule)
    rule.charge_amount = payload.charge_amount.quantize(Decimal("0.01"))
    rule.charge_type = payload.charge_type
    rule.free_delivery = payload.free_delivery
    rule.free_delivery_minimum = payload.free_delivery_minimum
    rule.enabled = payload.enabled
    database.commit()
    return {"saved": True, "category": rule.category, "region": rule.region}


@app.delete("/api/admin/delivery-charges/{category}", status_code=204, tags=["settings"])
def delete_delivery_charge_rule(category: str, region: str = Query(default="all"), user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> None:
    if region not in {"all", "gujarat", "outside_gujarat"}:
        raise HTTPException(status_code=422, detail="Invalid delivery rule region")
    rule = database.scalar(select(DeliveryChargeRule).where(DeliveryChargeRule.category == category, DeliveryChargeRule.region == region).with_for_update())
    if rule:
        database.delete(rule)
        database.commit()


@app.get("/api/admin/inventory", tags=["inventory"])
def inventory_dashboard(user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> dict[str, object]:
    rows = database.execute(select(Product, Inventory).join(Inventory, Inventory.product_id == Product.id, isouter=True).where(Product.is_active.is_(True)).order_by(Product.name)).all()
    products = [{"sku": product.sku, "name": product.name, "category": product.category, "available_quantity": inventory.available_quantity if inventory else 0, "reserved_quantity": inventory.reserved_quantity if inventory else 0, "low_stock_threshold": product.low_stock_threshold, "status": "out_of_stock" if not inventory or inventory.available_quantity <= 0 else "low_stock" if inventory.available_quantity <= product.low_stock_threshold else "in_stock"} for product, inventory in rows]
    return {"products": products, "summary": {"total_products": len(products), "available_stock": sum(item["available_quantity"] for item in products), "low_stock": sum(item["status"] == "low_stock" for item in products), "out_of_stock": sum(item["status"] == "out_of_stock" for item in products)}}


@app.post("/api/admin/inventory/adjust", tags=["inventory"])
def adjust_inventory(payload: InventoryAdjustmentRequest, user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> dict[str, object]:
    product = database.scalar(select(Product).where(Product.sku == payload.sku, Product.is_active.is_(True)).with_for_update())
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    inventory = database.scalar(select(Inventory).where(Inventory.product_id == product.id).with_for_update())
    if inventory is None:
        inventory = Inventory(product_id=product.id, available_quantity=0, reserved_quantity=0)
        database.add(inventory)
        database.flush()
    previous = inventory.available_quantity
    if payload.action == "remove" and payload.quantity > inventory.available_quantity:
        raise HTTPException(status_code=409, detail="Cannot remove more stock than available")
    inventory.available_quantity += payload.quantity if payload.action == "add" else -payload.quantity
    database.add(InventoryMovement(product_id=product.id, movement_type="manual_add" if payload.action == "add" else "manual_remove", quantity=payload.quantity if payload.action == "add" else -payload.quantity, reference=f"admin:{user.username}", notes=f"{payload.reason}: {payload.notes or ''} (previous={previous}, new={inventory.available_quantity})"))
    database.commit()
    return {"sku": product.sku, "previous_quantity": previous, "new_quantity": inventory.available_quantity}


@app.patch("/api/admin/inventory/threshold", tags=["inventory"])
def update_inventory_threshold(payload: InventoryThresholdRequest, user: AdminUser = Depends(require_admin), database: Session = Depends(get_db)) -> dict[str, object]:
    product = database.scalar(select(Product).where(Product.sku == payload.sku, Product.is_active.is_(True)).with_for_update())
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.low_stock_threshold = payload.low_stock_threshold
    database.commit()
    return {"sku": product.sku, "low_stock_threshold": product.low_stock_threshold}


@app.get("/api/admin/inventory/movements", tags=["inventory"])
def inventory_movements(user: AdminUser = Depends(require_admin), limit: int = Query(default=100, ge=1, le=500), database: Session = Depends(get_db)) -> list[dict[str, object]]:
    rows = database.scalars(select(InventoryMovement).options(joinedload(InventoryMovement.product)).order_by(InventoryMovement.created_at.desc()).limit(limit)).all()
    return [{"sku": row.product.sku if row.product else None, "product_name": row.product.name if row.product else None, "movement_type": row.movement_type, "quantity": row.quantity, "reference": row.reference, "notes": row.notes, "created_at": row.created_at} for row in rows]


@app.get("/api/admin/dispatch-settings", tags=["settings"])
def dispatch_settings(user: AdminUser = Depends(require_admin)) -> dict[str, int]:
    return {"working_days": get_dispatch_working_days()}


@app.patch("/api/admin/dispatch-settings", tags=["settings"])
def update_dispatch_settings(
    payload: DispatchSettingsUpdate,
    user: AdminUser = Depends(require_admin),
) -> dict[str, int]:
    return {"working_days": set_dispatch_working_days(payload.working_days)}


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
        selectinload(WebsiteOrder.items),
        selectinload(WebsiteOrder.payments),
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
