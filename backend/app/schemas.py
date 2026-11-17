from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from decimal import Decimal


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    username: str


class SessionResponse(BaseModel):
    authenticated: bool = True
    user: UserResponse
    csrf_token: str


class CheckoutConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ram: str | None = Field(default=None, max_length=80)
    hdd: str | None = Field(default=None, max_length=80)
    ssd: str | None = Field(default=None, max_length=80)
    combined: str | None = Field(default=None, max_length=80)


class CheckoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._-]+$")
    quantity: int = Field(ge=1, le=10)
    configuration: CheckoutConfiguration | None = None


class CheckoutValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CheckoutItem] = Field(min_length=1, max_length=20)
    postal_code: str | None = Field(default=None, pattern=r"^[1-9][0-9]{5}$")


class AddressInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line1: str = Field(min_length=3, max_length=250)
    line2: str = Field(default="", max_length=250)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(pattern=r"^[1-9][0-9]{5}$")


class CheckoutCustomer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(pattern=r"^[6-9][0-9]{9}$")
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer: CheckoutCustomer
    address: AddressInput
    billing_address: AddressInput | None = None
    items: list[CheckoutItem] = Field(min_length=1, max_length=20)
    terms_accepted: bool


class CatalogSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    catalog_id: str = Field(min_length=1, max_length=160)
    sku: str = Field(default="", max_length=120)
    name: str = Field(min_length=1, max_length=255)
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    stock_quantity: int | None = Field(default=None, ge=0, le=100000)
    published: bool
    image_url: str | None = Field(default=None, max_length=2048)
    specifications: dict[str, str] = Field(default_factory=dict, max_length=30)
    upgrade_options: dict[str, list[dict[str, object]]] = Field(default_factory=dict, max_length=4)


class VerifyPaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(min_length=3, max_length=80)
    payment_id: str = Field(min_length=36, max_length=36)
    outcome: str | None = Field(default=None, pattern=r"^(success|failure)$")
    razorpay_order_id: str | None = Field(default=None, max_length=120)
    razorpay_payment_id: str | None = Field(default=None, max_length=120)
    razorpay_signature: str | None = Field(default=None, max_length=256)


class PaymentOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(min_length=3, max_length=80)


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: float = Field(gt=0, le=100000000)


class FulfillmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["Order Placed", "Confirmed", "Processing", "Packed", "Shipped", "In Transit", "Out for Delivery", "Delivered", "Delivery Failed", "Returned", "Cancelled"]


class DispatchNotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    carrier: str | None = Field(default=None, max_length=120)
    tracking_number: str = Field(min_length=2, max_length=160)
    tracking_url: str | None = Field(default=None, max_length=2048)
    actual_dispatch_date: datetime | None = None
    estimated_delivery_date: datetime | None = None


class DispatchSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    working_days: int = Field(ge=0, le=30)


class PurchaseVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_type: Literal["GST", "NON_GST", "ONLINE"] | None = None
    invoice_number: str = Field(min_length=1, max_length=120)
    mobile: str = Field(pattern=r"^[6-9][0-9]{9}$")


class ServiceRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(pattern=r"^[6-9][0-9]{9}$")
    email: str | None = Field(default=None, max_length=254)
    service_category: str = Field(min_length=2, max_length=100)
    device_type: str = Field(min_length=2, max_length=40)
    brand_model: str | None = Field(default=None, max_length=160)
    problem_description: str = Field(min_length=10, max_length=1800)
    address: str = Field(default="", max_length=500)
    preferred_contact_time: str | None = Field(default=None, max_length=80)
    image_urls: list[str] = Field(default_factory=list, max_length=6)
    purchase_type: Literal["GST", "NON_GST", "ONLINE"]
    purchase_reference: str = Field(min_length=1, max_length=120)
    purchase_mobile: str = Field(pattern=r"^[6-9][0-9]{9}$")


class ServiceRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["New Request", "Under Review", "Approved", "Technician Assigned", "Inspection Scheduled", "In Progress", "Waiting for Parts", "Completed", "Rejected", "Cancelled"]
    assigned_to: str | None = Field(default=None, max_length=120)
    internal_notes: str | None = Field(default=None, max_length=5000)
