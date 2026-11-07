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


class CheckoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._-]+$")
    quantity: int = Field(ge=1, le=10)


class CheckoutValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CheckoutItem] = Field(min_length=1, max_length=20)


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


class VerifyPaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(min_length=36, max_length=36)
    payment_id: str = Field(min_length=36, max_length=36)
    outcome: str | None = Field(default=None, pattern=r"^(success|failure)$")
    razorpay_order_id: str | None = Field(default=None, max_length=120)
    razorpay_payment_id: str | None = Field(default=None, max_length=120)
    razorpay_signature: str | None = Field(default=None, max_length=256)


class PaymentOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(min_length=36, max_length=36)


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: float = Field(gt=0, le=100000000)


class FulfillmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["Processing", "Shipped", "Delivered"]
