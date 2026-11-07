import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .business_models import (
    Inventory,
    InventoryReservation,
    PaymentAttempt,
    Product,
    WebsiteAddress,
    WebsiteCustomer,
    WebsiteOrder,
    WebsiteOrderItem,
    WebsitePayment,
)
from .config import settings
from .schemas import CheckoutItem, CreateOrderRequest

ZERO = Decimal("0.00")
RESERVATION_LIFETIME = timedelta(minutes=20)


def _normalized_items(items: list[CheckoutItem]) -> list[CheckoutItem]:
    by_sku: dict[str, int] = {}
    for item in items:
        by_sku[item.sku] = by_sku.get(item.sku, 0) + item.quantity
        if by_sku[item.sku] > 10:
            raise HTTPException(status_code=422, detail=f"Maximum quantity for {item.sku} is 10")
    return [CheckoutItem(sku=sku, quantity=quantity) for sku, quantity in sorted(by_sku.items())]


def _locked_products(database: Session, items: list[CheckoutItem]) -> list[tuple[Product, Inventory, int]]:
    normalized = _normalized_items(items)
    products: list[tuple[Product, Inventory, int]] = []
    for item in normalized:
        product = database.scalar(
            select(Product).where(Product.sku == item.sku, Product.is_active.is_(True)).with_for_update()
        )
        inventory = (
            database.scalar(select(Inventory).where(Inventory.product_id == product.id).with_for_update())
            if product
            else None
        )
        if product is None or inventory is None:
            raise HTTPException(status_code=409, detail=f"Product {item.sku} is unavailable for online checkout")
        if inventory.available_quantity < item.quantity:
            raise HTTPException(status_code=409, detail=f"Insufficient stock for {item.sku}")
        if product.selling_price <= ZERO:
            raise HTTPException(status_code=409, detail=f"Product {item.sku} does not have a payable price")
        products.append((product, inventory, item.quantity))
    return products


def release_expired_reservations(database: Session) -> None:
    now = datetime.now(UTC)
    expired = database.scalars(
        select(InventoryReservation)
        .where(InventoryReservation.status == "reserved", InventoryReservation.expires_at <= now)
        .with_for_update()
    ).all()
    for reservation in expired:
        order = database.scalar(select(WebsiteOrder).where(WebsiteOrder.id == reservation.order_id).with_for_update())
        if order is None or order.status != "Pending Payment":
            continue
        release_reservations(database, order)
        order.status = "Cancelled"
        order.payment_status = "Failed"
        payment = database.scalar(select(WebsitePayment).where(WebsitePayment.order_id == order.id).with_for_update())
        if payment and payment.status not in {"Captured", "Refunded", "Partially Refunded"}:
            payment.status = "Failed"
            for attempt in payment.attempts:
                if attempt.status in {"Created", "Pending"}:
                    attempt.status = "Failed"
    if expired:
        database.commit()


def calculate_cart(database: Session, items: list[CheckoutItem]) -> dict[str, object]:
    release_expired_reservations(database)
    products = _locked_products(database, items)
    lines = []
    subtotal = ZERO
    for product, inventory, quantity in products:
        line_total = (Decimal(product.selling_price) * quantity).quantize(Decimal("0.01"))
        subtotal += line_total
        lines.append({
            "sku": product.sku,
            "name": product.name,
            "image_url": product.image_url,
            "quantity": quantity,
            "unit_price": str(product.selling_price),
            "subtotal": str(line_total),
            "available_quantity": inventory.available_quantity,
        })
    return {
        "items": lines,
        "subtotal": str(subtotal),
        "delivery_charge": str(ZERO),
        "discount": str(ZERO),
        "total": str(subtotal),
        "currency": "INR",
    }


def _request_fingerprint(payload: CreateOrderRequest, items: list[CheckoutItem]) -> str:
    body = payload.model_dump(mode="json", exclude={"terms_accepted"})
    body["items"] = [item.model_dump() for item in items]
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _lookup_token(order_id: str) -> str:
    return hmac.new(
        settings.session_secret.encode(),
        f"website-order:{order_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def create_website_order(database: Session, payload: CreateOrderRequest, idempotency_key: str) -> dict[str, object]:
    if not payload.terms_accepted:
        raise HTTPException(status_code=422, detail="Accept the terms and conditions before placing the order")
    if not idempotency_key or len(idempotency_key) > 80:
        raise HTTPException(status_code=400, detail="A valid Idempotency-Key header is required")
    items = _normalized_items(payload.items)
    fingerprint = _request_fingerprint(payload, items)
    release_expired_reservations(database)
    existing = database.scalar(select(WebsiteOrder).where(WebsiteOrder.idempotency_key == idempotency_key))
    if existing:
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="Idempotency key was already used for a different order")
        payment = database.scalar(select(WebsitePayment).where(WebsitePayment.order_id == existing.id))
        return _order_created_response(existing, payment)

    locked = _locked_products(database, items)
    subtotal = sum(
        (Decimal(product.selling_price) * quantity for product, _, quantity in locked),
        start=ZERO,
    ).quantize(Decimal("0.01"))
    customer = WebsiteCustomer(
        full_name=payload.customer.full_name,
        email=payload.customer.email,
        phone=payload.customer.phone,
    )
    database.add(customer)
    database.flush()

    shipping = payload.address.model_dump()
    billing = (payload.billing_address or payload.address).model_dump()
    database.add(WebsiteAddress(customer_id=customer.id, **shipping))
    if payload.billing_address:
        database.add(WebsiteAddress(customer_id=customer.id, is_billing=True, **billing))
    order_id = str(uuid.uuid4())
    token = _lookup_token(order_id)
    order = WebsiteOrder(
        order_id=order_id,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
        customer_id=customer.id,
        lookup_token_hash=hashlib.sha256(token.encode()).hexdigest(),
        status="Pending Payment",
        payment_status="Created",
        subtotal=subtotal,
        delivery_charge=ZERO,
        discount=ZERO,
        total_amount=subtotal,
        shipping_address=shipping,
        billing_address=billing,
    )
    database.add(order)
    database.flush()
    for product, inventory, quantity in locked:
        inventory.available_quantity -= quantity
        inventory.reserved_quantity += quantity
        database.add(InventoryReservation(
            order_id=order.id,
            product_id=product.id,
            quantity=quantity,
            status="reserved",
            expires_at=datetime.now(UTC) + RESERVATION_LIFETIME,
        ))
        database.add(WebsiteOrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            sku=product.sku,
            quantity=quantity,
            unit_price=product.selling_price,
            subtotal=(Decimal(product.selling_price) * quantity).quantize(Decimal("0.01")),
        ))
    payment = WebsitePayment(
        payment_id=str(uuid.uuid4()),
        order_id=order.id,
        provider=settings.payment_provider,
        status="Created",
        amount=subtotal,
    )
    database.add(payment)
    database.flush()
    database.add(PaymentAttempt(payment_id=payment.id, attempt_number=1, status="Created"))
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        raced = database.scalar(select(WebsiteOrder).where(WebsiteOrder.idempotency_key == idempotency_key))
        if raced and raced.request_fingerprint == fingerprint:
            raced_payment = database.scalar(select(WebsitePayment).where(WebsitePayment.order_id == raced.id))
            return _order_created_response(raced, raced_payment)
        raise
    database.refresh(order)
    database.refresh(payment)
    return _order_created_response(order, payment, token)


def _order_created_response(
    order: WebsiteOrder,
    payment: WebsitePayment | None,
    token: str | None = None,
) -> dict[str, object]:
    return {
        "order_id": order.order_id,
        "lookup_token": token or _lookup_token(order.order_id),
        "payment_id": payment.payment_id if payment else None,
        "payment_status": order.payment_status,
        "order_status": order.status,
        "amount": str(order.total_amount),
        "currency": "INR",
        "provider": payment.provider if payment else settings.payment_provider,
        "test_mode": settings.payment_provider == "mock",
        "test_mode_notice": "TEST MODE — no real payment or bank transaction occurs." if settings.payment_provider == "mock" else None,
    }


def get_order_for_customer(database: Session, order_id: str, lookup_token: str) -> WebsiteOrder:
    order = database.scalar(
        select(WebsiteOrder)
        .options(joinedload(WebsiteOrder.items), joinedload(WebsiteOrder.payments))
        .where(WebsiteOrder.order_id == order_id)
    )
    if not order or not hmac.compare_digest(
        order.lookup_token_hash,
        hashlib.sha256(lookup_token.encode()).hexdigest(),
    ):
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def release_reservations(database: Session, order: WebsiteOrder) -> None:
    for reservation in database.scalars(
        select(InventoryReservation)
        .where(InventoryReservation.order_id == order.id, InventoryReservation.status == "reserved")
        .with_for_update()
    ):
        inventory = database.scalar(select(Inventory).where(Inventory.product_id == reservation.product_id).with_for_update())
        if inventory:
            inventory.available_quantity += reservation.quantity
            inventory.reserved_quantity -= reservation.quantity
        reservation.status = "released"


def capture_reservations(database: Session, order: WebsiteOrder) -> None:
    for reservation in database.scalars(
        select(InventoryReservation)
        .where(InventoryReservation.order_id == order.id, InventoryReservation.status == "reserved")
        .with_for_update()
    ):
        inventory = database.scalar(select(Inventory).where(Inventory.product_id == reservation.product_id).with_for_update())
        if inventory:
            inventory.reserved_quantity -= reservation.quantity
        reservation.status = "committed"
