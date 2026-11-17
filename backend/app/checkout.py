import hashlib
import hmac
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .business_models import (
    Inventory,
    InventoryReservation,
    PaymentAttempt,
    Product,
    ProductOrderSequence,
    WebsiteAddress,
    WebsiteCustomer,
    WebsiteOrder,
    WebsiteOrderItem,
    WebsitePayment,
)
from .config import settings
from .delivery import lookup_pincode
from .schemas import CheckoutItem, CreateOrderRequest

ZERO = Decimal("0.00")
RESERVATION_LIFETIME = timedelta(minutes=20)


def _normalize_mobile(value: str) -> str:
    digits = "".join(character for character in str(value) if character.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits


def _order_id_part(value: str, fallback: str, limit: int) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    return (cleaned[:limit] or fallback)


def _next_product_order_number(database: Session, sku: str) -> int:
    """Atomically increment the persistent counter for one SKU."""
    dialect = database.bind.dialect.name if database.bind is not None else ""
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        raise HTTPException(status_code=503, detail="Unsupported database for order reference allocation")
    statement = insert(ProductOrderSequence).values(
        sku=sku,
        last_assigned_order_number=1,
    ).on_conflict_do_update(
        index_elements=[ProductOrderSequence.sku],
        set_={"last_assigned_order_number": ProductOrderSequence.last_assigned_order_number + 1},
    ).returning(ProductOrderSequence.last_assigned_order_number)
    return int(database.execute(statement).scalar_one())


def _product_order_reference(customer_name: str, sku: str, number: int) -> str:
    name_part = _order_id_part(customer_name.split()[0] if customer_name.strip() else "", "CUS", 24)
    sku_part = _order_id_part(sku, "ITEM", 40)
    return f"{name_part}-{sku_part}-{number:04d}"


def _new_product_order_references(
    database: Session,
    customer_name: str,
    items: list[tuple[Product, Inventory, CheckoutItem]],
) -> list[str]:
    references: list[str] = []
    for product, _, _ in items:
        sku = _order_id_part(product.sku, "ITEM", 120)
        while True:
            number = _next_product_order_number(database, sku)
            candidate = _product_order_reference(customer_name, sku, number)
            existing_order = database.scalar(select(WebsiteOrder.id).where(WebsiteOrder.order_id == candidate))
            existing_item = database.scalar(select(WebsiteOrderItem.id).where(WebsiteOrderItem.product_order_reference == candidate))
            if existing_order is None and existing_item is None:
                references.append(candidate)
                break
    return references


def _normalized_items(items: list[CheckoutItem]) -> list[CheckoutItem]:
    by_key: dict[tuple[str, str], CheckoutItem] = {}
    for item in items:
        configuration = item.configuration.model_dump(exclude_none=True) if item.configuration else {}
        key = (item.sku, json.dumps(configuration, sort_keys=True, separators=(",", ":")))
        current = by_key.get(key)
        quantity = (current.quantity if current else 0) + item.quantity
        if quantity > 10:
            raise HTTPException(status_code=422, detail=f"Maximum quantity for {item.sku} is 10")
        by_key[key] = CheckoutItem(sku=item.sku, quantity=quantity, configuration=item.configuration)
    return [by_key[key] for key in sorted(by_key)]


def _upgrade_selection(product: Product, item: CheckoutItem) -> dict[str, object]:
    selected = item.configuration.model_dump(exclude_none=True) if item.configuration else {}
    available = product.upgrade_options if isinstance(product.upgrade_options, dict) else {}
    if not selected:
        return {"configuration": {}, "upgrade_amount": ZERO, "breakdown": []}
    if selected.get("combined") and any(selected.get(key) for key in ("ram", "hdd", "ssd")):
        raise HTTPException(status_code=422, detail=f"Choose either a combined package or individual upgrades for {product.sku}")
    breakdown: list[dict[str, object]] = []
    total = ZERO
    for key in ("ram", "hdd", "ssd", "combined"):
        option_id = selected.get(key)
        if not option_id:
            continue
        options = available.get(key)
        if not isinstance(options, list):
            raise HTTPException(status_code=409, detail=f"{key.upper()} upgrades are not configured for {product.sku}")
        option = next((entry for entry in options if isinstance(entry, dict) and str(entry.get("id")) == option_id), None)
        if not option or option.get("available", True) is False:
            raise HTTPException(status_code=409, detail=f"Selected {key.upper()} upgrade is unavailable")
        try:
            price = Decimal(str(option.get("price", "0"))).quantize(Decimal("0.01"))
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Product upgrade pricing is invalid") from exc
        if price < ZERO:
            raise HTTPException(status_code=500, detail="Product upgrade pricing is invalid")
        total += price
        breakdown.append({"type": key, "id": option_id, "label": str(option.get("label", option_id)), "amount": str(price)})
    return {"configuration": selected, "upgrade_amount": total, "breakdown": breakdown}


def _locked_products(database: Session, items: list[CheckoutItem]) -> list[tuple[Product, Inventory, CheckoutItem]]:
    normalized = _normalized_items(items)
    products: list[tuple[Product, Inventory, CheckoutItem]] = []
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
        _upgrade_selection(product, item)
        products.append((product, inventory, item))
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


def calculate_cart(database: Session, items: list[CheckoutItem], postal_code: str | None = None) -> dict[str, object]:
    release_expired_reservations(database)
    products = _locked_products(database, items)
    lines = []
    subtotal = ZERO
    for product, inventory, item in products:
        selection = _upgrade_selection(product, item)
        upgrade_amount = selection["upgrade_amount"]
        line_unit_price = (Decimal(product.selling_price) + upgrade_amount).quantize(Decimal("0.01"))
        line_total = (line_unit_price * item.quantity).quantize(Decimal("0.01"))
        subtotal += line_total
        lines.append({
            "sku": product.sku,
            "name": product.name,
            "image_url": product.image_url,
            "quantity": item.quantity,
            "base_unit_price": str(product.selling_price),
            "upgrade_amount": str(upgrade_amount),
            "configuration": selection["configuration"],
            "upgrade_breakdown": selection["breakdown"],
            "unit_price": str(line_unit_price),
            "subtotal": str(line_total),
            "available_quantity": inventory.available_quantity,
        })
    delivery = lookup_pincode(postal_code) if postal_code else None
    delivery_charge = Decimal(str(delivery["delivery_charge"])) if delivery else ZERO
    return {
        "items": lines,
        "subtotal": str(subtotal),
        "delivery_charge": str(delivery_charge),
        "discount": str(ZERO),
        "total": str((subtotal + delivery_charge).quantize(Decimal("0.01"))),
        "delivery_state": delivery["state"] if delivery else None,
        "delivery_city": delivery["city"] if delivery else None,
        "delivery_verified": bool(delivery),
        "delivery_message": delivery["message"] if delivery else "Enter your PIN code to calculate packaging and delivery.",
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


def create_website_order(
    database: Session,
    payload: CreateOrderRequest,
    idempotency_key: str,
    firebase_uid: str | None = None,
) -> dict[str, object]:
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
    delivery = lookup_pincode(payload.address.postal_code)
    delivery_charge = Decimal(str(delivery["delivery_charge"])).quantize(Decimal("0.01"))
    subtotal = sum(
        ((Decimal(product.selling_price) + _upgrade_selection(product, item)["upgrade_amount"]) * item.quantity for product, _, item in locked),
        start=ZERO,
    ).quantize(Decimal("0.01"))
    normalized_phone = _normalize_mobile(payload.customer.phone)
    customer = database.scalars(
        select(WebsiteCustomer)
        .where(WebsiteCustomer.normalized_phone == normalized_phone)
        .order_by(WebsiteCustomer.id)
        .limit(1)
        .with_for_update()
    ).first()
    firebase_customer = None
    if firebase_uid:
        firebase_customer = database.scalar(
            select(WebsiteCustomer)
            .where(WebsiteCustomer.firebase_uid == firebase_uid)
            .with_for_update()
        )
        if firebase_customer is not None and customer is not None and firebase_customer.id != customer.id:
            raise HTTPException(status_code=409, detail="This Google account and mobile number belong to different customer accounts.")
        if customer is not None and customer.firebase_uid not in {None, firebase_uid}:
            raise HTTPException(status_code=409, detail="Verify an existing purchase before linking this Google account.")
        if customer is not None and customer.firebase_uid is None and firebase_customer is None:
            raise HTTPException(status_code=409, detail="Verify an existing purchase with Order ID and mobile before using Google login for this account.")
        customer = firebase_customer or customer
    if customer is None:
        customer = WebsiteCustomer(
            full_name=payload.customer.full_name,
            email=payload.customer.email,
            phone=payload.customer.phone,
            normalized_phone=normalized_phone,
            firebase_uid=firebase_uid,
            auth_provider="google" if firebase_uid else "guest",
        )
        database.add(customer)
        database.flush()
    else:
        if not customer.full_name.strip():
            customer.full_name = payload.customer.full_name
        if not customer.email.strip():
            customer.email = payload.customer.email

    shipping = payload.address.model_dump()
    shipping["state"] = str(delivery["state"])
    if delivery.get("city"):
        shipping["city"] = str(delivery["city"])
    shipping["delivery_state"] = str(delivery["state"])
    shipping["delivery_verified"] = True
    billing = (payload.billing_address or payload.address).model_dump()
    address_columns = {key: shipping[key] for key in ("line1", "line2", "city", "state", "postal_code", "country") if key in shipping}
    database.add(WebsiteAddress(customer_id=customer.id, **address_columns))
    if payload.billing_address:
        database.add(WebsiteAddress(customer_id=customer.id, is_billing=True, **billing))
    product_references = _new_product_order_references(database, payload.customer.full_name, locked)
    order_id = product_references[0]
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
        delivery_charge=delivery_charge,
        discount=ZERO,
        total_amount=(subtotal + delivery_charge).quantize(Decimal("0.01")),
        shipping_address=shipping,
        billing_address=billing,
    )
    database.add(order)
    database.flush()
    for (product, inventory, item), product_reference in zip(locked, product_references, strict=True):
        selection = _upgrade_selection(product, item)
        inventory.available_quantity -= item.quantity
        inventory.reserved_quantity += item.quantity
        database.add(InventoryReservation(
            order_id=order.id,
            product_id=product.id,
            quantity=item.quantity,
            status="reserved",
            expires_at=datetime.now(UTC) + RESERVATION_LIFETIME,
        ))
        database.add(WebsiteOrderItem(
            order_id=order.id,
            product_id=product.id,
            name=product.name,
            sku=product.sku,
            quantity=item.quantity,
            base_unit_price=product.selling_price,
            upgrade_amount=selection["upgrade_amount"],
            configuration={**selection["configuration"], "breakdown": selection["breakdown"]},
            product_order_number=int(product_reference.rsplit("-", 1)[1]),
            product_order_reference=product_reference,
            unit_price=(Decimal(product.selling_price) + selection["upgrade_amount"]).quantize(Decimal("0.01")),
            subtotal=((Decimal(product.selling_price) + selection["upgrade_amount"]) * item.quantity).quantize(Decimal("0.01")),
        ))
    payment = WebsitePayment(
        payment_id=str(uuid.uuid4()),
        order_id=order.id,
        provider=settings.payment_provider,
        status="Created",
        amount=order.total_amount,
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
    }


def get_order_for_customer(database: Session, order_id: str, lookup_token: str) -> WebsiteOrder:
    order = database.scalar(
        select(WebsiteOrder)
        # Collection eager loads must use selectinload here.  Session.scalar()
        # cannot safely consume the duplicate parent rows produced by
        # joinedload() when an order has multiple items or payment attempts.
        .options(selectinload(WebsiteOrder.items), selectinload(WebsiteOrder.payments))
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
