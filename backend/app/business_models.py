from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from .database import Base


class FlipkartOrder(Base):
    __tablename__ = "flipkart_orders"

    id = Column(Integer, primary_key=True)
    order_id = Column(String(120), unique=True, nullable=False, index=True)
    shipment_id = Column(String(120), index=True)
    order_date = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(String(40), nullable=False, default="pending", index=True)
    payment_status = Column(String(40))
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="INR")
    customer_reference = Column(String(120))
    source_payload = Column(JSON)
    synced_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items = relationship("FlipkartOrderItem", back_populates="order", cascade="all, delete-orphan")
    shipments = relationship("Shipment", back_populates="order", cascade="all, delete-orphan")
    returns = relationship("ReturnRecord", back_populates="order")


class FlipkartOrderItem(Base):
    __tablename__ = "flipkart_order_items"

    id = Column(Integer, primary_key=True)
    order_id = Column(ForeignKey("flipkart_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name = Column(String(255), nullable=False)
    sku = Column(String(120), nullable=False, index=True)
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Numeric(12, 2), nullable=False, default=0)
    cost_price = Column(Numeric(12, 2), nullable=False, default=0)

    order = relationship("FlipkartOrder", back_populates="items")


class Shipment(Base):
    __tablename__ = "shipments"

    id = Column(Integer, primary_key=True)
    shipment_id = Column(String(120), unique=True, nullable=False, index=True)
    order_id = Column(ForeignKey("flipkart_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(40), nullable=False, default="pending", index=True)
    carrier = Column(String(120))
    tracking_number = Column(String(160))
    shipped_at = Column(DateTime(timezone=True))
    delivered_at = Column(DateTime(timezone=True))
    source_payload = Column(JSON)

    order = relationship("FlipkartOrder", back_populates="shipments")


class ReturnRecord(Base):
    __tablename__ = "returns"

    id = Column(Integer, primary_key=True)
    return_id = Column(String(120), unique=True, nullable=False, index=True)
    order_id = Column(ForeignKey("flipkart_orders.id"), nullable=False, index=True)
    product_name = Column(String(255), nullable=False)
    sku = Column(String(120), nullable=False, index=True)
    return_date = Column(DateTime(timezone=True), index=True)
    reason = Column(String(255))
    return_type = Column(String(80))
    status = Column(String(40), nullable=False, default="requested", index=True)
    refund_amount = Column(Numeric(12, 2), default=0)
    tracking_number = Column(String(160))
    source_payload = Column(JSON)

    order = relationship("FlipkartOrder", back_populates="returns")
    inspection = relationship("ReturnInspection", back_populates="return_record", uselist=False, cascade="all, delete-orphan")


class ReturnInspection(Base):
    __tablename__ = "return_inspections"

    id = Column(Integer, primary_key=True)
    return_id = Column(ForeignKey("returns.id", ondelete="CASCADE"), unique=True, nullable=False)
    product_received = Column(Boolean, default=False, nullable=False)
    physical_condition = Column(String(80))
    power_on_test = Column(String(40))
    functional_test = Column(String(40))
    missing_accessories = Column(Text)
    damage_details = Column(Text)
    inspection_photos = Column(JSON)
    internal_remarks = Column(Text)
    final_result = Column(String(40))
    inspected_at = Column(DateTime(timezone=True))

    return_record = relationship("ReturnRecord", back_populates="inspection")


class Product(Base):
    __tablename__ = "business_products"

    id = Column(Integer, primary_key=True)
    sku = Column(String(120), unique=True, nullable=False, index=True)
    catalog_id = Column(String(160), unique=True, index=True)
    name = Column(String(255), nullable=False)
    selling_price = Column(Numeric(12, 2), default=0, nullable=False)
    cost_price = Column(Numeric(12, 2), default=0, nullable=False)
    low_stock_threshold = Column(Integer, default=5, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    image_url = Column(String(2048))
    catalog_stock_quantity = Column(Integer)

    inventory = relationship("Inventory", back_populates="product", uselist=False, cascade="all, delete-orphan")
    movements = relationship("InventoryMovement", back_populates="product")


class Inventory(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True)
    product_id = Column(ForeignKey("business_products.id", ondelete="CASCADE"), unique=True, nullable=False)
    available_quantity = Column(Integer, default=0, nullable=False)
    reserved_quantity = Column(Integer, default=0, nullable=False)
    last_synced_at = Column(DateTime(timezone=True))

    product = relationship("Product", back_populates="inventory")


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True)
    product_id = Column(ForeignKey("business_products.id"), nullable=False, index=True)
    movement_type = Column(String(40), nullable=False)
    quantity = Column(Integer, nullable=False)
    reference = Column(String(160))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    product = relationship("Product", back_populates="movements")


class WebsiteCustomer(Base):
    __tablename__ = "website_customers"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(120), nullable=False)
    phone = Column(String(20), nullable=False, index=True)
    email = Column(String(254), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    addresses = relationship("WebsiteAddress", back_populates="customer", cascade="all, delete-orphan")
    orders = relationship("WebsiteOrder", back_populates="customer")


class WebsiteAddress(Base):
    __tablename__ = "website_addresses"

    id = Column(Integer, primary_key=True)
    customer_id = Column(ForeignKey("website_customers.id", ondelete="CASCADE"), nullable=False, index=True)
    line1 = Column(String(250), nullable=False)
    line2 = Column(String(250), nullable=False, default="")
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    postal_code = Column(String(10), nullable=False)
    country = Column(String(2), nullable=False, default="IN")
    is_billing = Column(Boolean, default=False, nullable=False)

    customer = relationship("WebsiteCustomer", back_populates="addresses")


class WebsiteOrder(Base):
    __tablename__ = "website_orders"

    id = Column(Integer, primary_key=True)
    order_id = Column(String(36), unique=True, nullable=False, index=True)
    idempotency_key = Column(String(80), unique=True, nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    customer_id = Column(ForeignKey("website_customers.id"), nullable=False, index=True)
    lookup_token_hash = Column(String(64), nullable=False)
    status = Column(String(30), nullable=False, default="Pending Payment", index=True)
    payment_status = Column(String(30), nullable=False, default="Created", index=True)
    subtotal = Column(Numeric(12, 2), nullable=False)
    delivery_charge = Column(Numeric(12, 2), nullable=False, default=0)
    discount = Column(Numeric(12, 2), nullable=False, default=0)
    total_amount = Column(Numeric(12, 2), nullable=False)
    shipping_address = Column(JSON, nullable=False)
    billing_address = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    customer = relationship("WebsiteCustomer", back_populates="orders")
    items = relationship("WebsiteOrderItem", back_populates="order", cascade="all, delete-orphan")
    payments = relationship("WebsitePayment", back_populates="order", cascade="all, delete-orphan")
    reservations = relationship("InventoryReservation", back_populates="order", cascade="all, delete-orphan")


class WebsiteOrderItem(Base):
    __tablename__ = "website_order_items"

    id = Column(Integer, primary_key=True)
    order_id = Column(ForeignKey("website_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(ForeignKey("business_products.id"), nullable=False)
    name = Column(String(255), nullable=False)
    sku = Column(String(120), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 2), nullable=False)
    subtotal = Column(Numeric(12, 2), nullable=False)

    order = relationship("WebsiteOrder", back_populates="items")


class WebsitePayment(Base):
    __tablename__ = "website_payments"

    id = Column(Integer, primary_key=True)
    payment_id = Column(String(36), unique=True, nullable=False, index=True)
    order_id = Column(ForeignKey("website_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(30), nullable=False)
    status = Column(String(30), nullable=False, default="Created", index=True)
    provider_order_id = Column(String(120), unique=True, index=True)
    provider_payment_id = Column(String(120), unique=True, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="INR")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    order = relationship("WebsiteOrder", back_populates="payments")
    attempts = relationship("PaymentAttempt", back_populates="payment", cascade="all, delete-orphan")
    refunds = relationship("WebsiteRefund", back_populates="payment", cascade="all, delete-orphan")


class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"

    id = Column(Integer, primary_key=True)
    payment_id = Column(ForeignKey("website_payments.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False)
    status = Column(String(30), nullable=False, default="Created", index=True)
    provider_reference = Column(String(120), unique=True)
    error_code = Column(String(80))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    payment = relationship("WebsitePayment", back_populates="attempts")


class PaymentWebhookEvent(Base):
    __tablename__ = "payment_webhook_events"

    id = Column(Integer, primary_key=True)
    provider_event_id = Column(String(160), unique=True, nullable=False)
    event_type = Column(String(100), nullable=False)
    payload = Column(JSON, nullable=False)
    processed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InventoryReservation(Base):
    __tablename__ = "inventory_reservations"
    __table_args__ = (UniqueConstraint("order_id", "product_id", name="uq_reservation_order_product"),)

    id = Column(Integer, primary_key=True)
    order_id = Column(ForeignKey("website_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(ForeignKey("business_products.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="reserved", index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    order = relationship("WebsiteOrder", back_populates="reservations")


class WebsiteRefund(Base):
    __tablename__ = "website_refunds"

    id = Column(Integer, primary_key=True)
    refund_id = Column(String(36), unique=True, nullable=False, index=True)
    idempotency_key = Column(String(80), unique=True, nullable=False)
    payment_id = Column(ForeignKey("website_payments.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_refund_id = Column(String(120), unique=True)
    amount = Column(Numeric(12, 2), nullable=False)
    status = Column(String(30), nullable=False, default="Created", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    payment = relationship("WebsitePayment", back_populates="refunds")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True)
    expense_date = Column(DateTime(timezone=True), nullable=False, index=True)
    category = Column(String(80), nullable=False)
    description = Column(String(255))
    amount = Column(Numeric(12, 2), nullable=False)
    reference = Column(String(160))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True)
    settlement_id = Column(String(120), unique=True, nullable=False, index=True)
    settlement_date = Column(DateTime(timezone=True), index=True)
    gross_sales = Column(Numeric(12, 2), default=0, nullable=False)
    marketplace_fees = Column(Numeric(12, 2), default=0, nullable=False)
    refunds = Column(Numeric(12, 2), default=0, nullable=False)
    settlement_amount = Column(Numeric(12, 2), default=0, nullable=False)
    reconciled = Column(Boolean, default=False, nullable=False)
    notes = Column(Text)
    source_payload = Column(JSON)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    notification_type = Column(String(60), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True)
    sync_type = Column(String(60), nullable=False, index=True)
    status = Column(String(40), nullable=False)
    records_processed = Column(Integer, default=0, nullable=False)
    error_message = Column(Text)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    admin_user_id = Column(ForeignKey("admin_users.id"), index=True)
    action = Column(String(120), nullable=False, index=True)
    entity_type = Column(String(80))
    entity_id = Column(String(120))
    details = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
