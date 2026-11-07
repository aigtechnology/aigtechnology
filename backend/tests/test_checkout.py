import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import SESSION_COOKIE, create_session, csrf_token
from app.business_models import (
    Inventory,
    InventoryReservation,
    PaymentWebhookEvent,
    Product,
    WebsiteOrder,
    WebsitePayment,
)
from app.config import settings
from app.database import Base, get_db
from app import main as main_module
from app.main import app
from app.models import AdminUser


@pytest.fixture
def client(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(test_engine)
    monkeypatch.setattr(main_module, "engine", test_engine)
    TestingSession = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        database = TestingSession()
        try:
            yield database
        finally:
            database.close()

    limiter_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False
    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    with TestingSession() as database:
        product = Product(
            sku="AIG-PC-1",
            catalog_id="firebase-product-1",
            name="Refurbished desktop",
            selling_price=Decimal("12500.00"),
            is_active=True,
            catalog_stock_quantity=3,
        )
        database.add(product)
        database.flush()
        database.add(Inventory(product_id=product.id, available_quantity=3))
        database.commit()
    yield test_client, TestingSession
    test_client.close()
    app.dependency_overrides.clear()
    app.state.limiter.enabled = limiter_enabled
    Base.metadata.drop_all(test_engine)
    test_engine.dispose()


def test_health_endpoints_report_liveness_and_readiness(client):
    test_client, _ = client

    live = test_client.get("/health/live")
    ready = test_client.get("/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "ok", "service": "aig-admin-api"}
    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ok",
        "checks": {"database": "ok", "redis": "not_configured"},
    }


def order_body(quantity=2, terms=True):
    return {
        "customer": {
            "full_name": "Test Customer",
            "phone": "9876543210",
            "email": "customer@example.com",
        },
        "address": {
            "line1": "12 Test Road",
            "line2": "",
            "city": "Ahmedabad",
            "state": "Gujarat",
            "postal_code": "380001",
        },
        "items": [{"sku": "AIG-PC-1", "quantity": quantity}],
        "terms_accepted": terms,
    }


def place_order(client, body=None, key="test-idempotency-key"):
    return client.post(
        "/api/orders/create",
        headers={"Idempotency-Key": key},
        json=body or order_body(),
    )


def start_mock_payment(client, order):
    return client.post(
        "/api/payments/create-order",
        headers={"X-Order-Access-Token": order["lookup_token"]},
        json={"order_id": order["order_id"]},
    )


def test_validate_uses_database_price(client):
    test_client, _ = client
    response = test_client.post("/api/checkout/validate", json={
        "items": [{"sku": "AIG-PC-1", "quantity": 2}],
    })

    assert response.status_code == 200
    assert response.json()["total"] == "25000.00"
    assert response.json()["items"][0]["unit_price"] == "12500.00"


def test_checkout_rejects_frontend_price_fields(client):
    test_client, _ = client
    response = test_client.post("/api/checkout/validate", json={
        "items": [{"sku": "AIG-PC-1", "quantity": 2, "price": 0.01}],
    })

    assert response.status_code == 422


def test_order_creation_is_idempotent_and_reserves_stock(client):
    test_client, TestingSession = client
    first = place_order(test_client)
    second = place_order(test_client)

    assert first.status_code == second.status_code == 200
    assert first.json()["order_id"] == second.json()["order_id"]
    assert first.json()["lookup_token"] == second.json()["lookup_token"]
    assert first.json()["amount"] == "25000.00"
    with TestingSession() as database:
        inventory = database.scalar(select(Inventory))
        assert inventory.available_quantity == 1
        assert inventory.reserved_quantity == 2
        assert database.scalar(select(WebsiteOrder)).status == "Pending Payment"

    changed = place_order(test_client, order_body(quantity=1))
    assert changed.status_code == 409


def test_mock_failed_payment_releases_reserved_stock(client):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    started = start_mock_payment(test_client, order)
    assert started.status_code == 200
    assert started.json()["test_mode"] is True
    assert "bank transactions" in started.json()["notice"].lower()

    result = test_client.post(
        "/api/payments/verify",
        headers={"X-Order-Access-Token": order["lookup_token"]},
        json={
            "order_id": order["order_id"],
            "payment_id": order["payment_id"],
            "outcome": "failure",
        },
    )

    assert result.status_code == 200
    assert result.json()["payment_status"] == "Failed"
    with TestingSession() as database:
        inventory = database.scalar(select(Inventory))
        assert inventory.available_quantity == 3
        assert inventory.reserved_quantity == 0


def test_mock_success_needs_secure_lookup_token(client):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    start_mock_payment(test_client, order)
    result = test_client.post(
        "/api/payments/verify",
        headers={"X-Order-Access-Token": order["lookup_token"]},
        json={
            "order_id": order["order_id"],
            "payment_id": order["payment_id"],
            "outcome": "success",
        },
    )

    assert result.status_code == 200
    assert result.json()["payment_status"] == "Captured"
    details = test_client.get(
        f"/api/orders/{order['order_id']}",
        headers={"X-Order-Access-Token": order["lookup_token"]},
    )
    assert details.status_code == 200
    assert details.json()["items"][0]["name"] == "Refurbished desktop"
    assert details.json()["payment_status"] == "Captured"
    unauthorized = test_client.get(
        f"/api/orders/{order['order_id']}",
        headers={"X-Order-Access-Token": "wrong-token"},
    )
    assert unauthorized.status_code == 404
    with TestingSession() as database:
        inventory = database.scalar(select(Inventory))
        reservation = database.scalar(select(InventoryReservation))
        assert inventory.available_quantity == 1
        assert inventory.reserved_quantity == 0
        assert reservation.status == "committed"


def test_mock_verification_cannot_start_before_payment_order(client):
    test_client, _ = client
    order = place_order(test_client).json()
    result = test_client.post(
        "/api/payments/verify",
        headers={"X-Order-Access-Token": order["lookup_token"]},
        json={
            "order_id": order["order_id"],
            "payment_id": order["payment_id"],
            "outcome": "success",
        },
    )

    assert result.status_code == 409


def test_terms_must_be_accepted_before_order_creation(client):
    test_client, TestingSession = client
    response = place_order(test_client, order_body(terms=False))

    assert response.status_code == 422
    with TestingSession() as database:
        assert database.scalar(select(WebsiteOrder)) is None


def test_duplicate_razorpay_webhook_is_processed_once(client, monkeypatch):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    with TestingSession() as database:
        payment = database.scalar(select(WebsitePayment))
        payment.provider = "razorpay"
        payment.provider_order_id = "order_test_1"
        payment.status = "Pending"
        database.commit()

    monkeypatch.setattr(settings, "razorpay_webhook_secret", "webhook-test-secret")
    event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_test_1",
                    "order_id": "order_test_1",
                    "amount": 2500000,
                    "currency": "INR",
                },
            },
        },
    }
    body = json.dumps(event).encode()
    signature = hmac.new(b"webhook-test-secret", body, hashlib.sha256).hexdigest()
    headers = {"X-Razorpay-Signature": signature, "X-Razorpay-Event-Id": "event_test_1"}
    first = test_client.post("/api/webhooks/razorpay", content=body, headers=headers)
    second = test_client.post("/api/webhooks/razorpay", content=body, headers=headers)

    assert first.status_code == second.status_code == 200
    assert second.json()["duplicate"] is True
    with TestingSession() as database:
        assert len(database.scalars(select(PaymentWebhookEvent)).all()) == 1
        inventory = database.scalar(select(Inventory))
        reservation = database.scalar(select(InventoryReservation))
        payment = database.scalar(select(WebsitePayment))
        assert payment.status == "Captured"
        assert inventory.reserved_quantity == 0
        assert reservation.status == "committed"


def test_invalid_razorpay_webhook_signature_is_rejected(client, monkeypatch):
    test_client, _ = client
    monkeypatch.setattr(settings, "razorpay_webhook_secret", "webhook-test-secret")
    response = test_client.post(
        "/api/webhooks/razorpay",
        content=b'{"event":"payment.captured"}',
        headers={"X-Razorpay-Signature": "invalid", "X-Razorpay-Event-Id": "event_invalid"},
    )

    assert response.status_code == 400


def test_mock_refund_is_idempotent_and_updates_payment(client):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    start_mock_payment(test_client, order)
    test_client.post(
        "/api/payments/verify",
        headers={"X-Order-Access-Token": order["lookup_token"]},
        json={
            "order_id": order["order_id"],
            "payment_id": order["payment_id"],
            "outcome": "success",
        },
    )
    with TestingSession() as database:
        admin = AdminUser(username="refund-admin", password_hash="unused", is_active=True)
        database.add(admin)
        database.commit()
        token = create_session(database, admin)
    test_client.cookies.set(SESSION_COOKIE, token)
    headers = {"Idempotency-Key": "refund-test-1", "X-CSRF-Token": csrf_token(token)}
    first = test_client.post(
        f"/api/payments/{order['payment_id']}/refund",
        headers=headers,
        json={"amount": 100},
    )
    duplicate = test_client.post(
        f"/api/payments/{order['payment_id']}/refund",
        headers=headers,
        json={"amount": 100},
    )

    assert first.status_code == duplicate.status_code == 200
    assert first.json()["refund_id"] == duplicate.json()["refund_id"]
    assert first.json()["status"] == "Processed"
    with TestingSession() as database:
        payment = database.scalar(select(WebsitePayment))
        assert payment.status == "Partially Refunded"


def test_admin_reconciliation_uses_provider_status(client, monkeypatch):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    with TestingSession() as database:
        payment = database.scalar(select(WebsitePayment))
        payment.provider = "razorpay"
        payment.provider_order_id = "order_reconcile_1"
        payment.provider_payment_id = "pay_reconcile_1"
        payment.status = "Pending"
        admin = AdminUser(username="reconcile-admin", password_hash="unused", is_active=True)
        database.add(admin)
        database.commit()
        token = create_session(database, admin)
    test_client.cookies.set(SESSION_COOKIE, token)

    async def captured_payment(_provider_payment_id):
        return {
            "order_id": "order_reconcile_1",
            "amount": 2500000,
            "currency": "INR",
            "status": "captured",
        }

    monkeypatch.setattr(main_module, "fetch_razorpay_payment", captured_payment)
    missing_csrf = test_client.post(f"/api/admin/payments/{order['payment_id']}/reconcile")
    assert missing_csrf.status_code == 403
    response = test_client.post(
        f"/api/admin/payments/{order['payment_id']}/reconcile",
        headers={"X-CSRF-Token": csrf_token(token)},
    )

    assert response.status_code == 200
    assert response.json()["payment_status"] == "Captured"
    assert response.json()["order_status"] == "Confirmed"
    with TestingSession() as database:
        inventory = database.scalar(select(Inventory))
        assert inventory.reserved_quantity == 0


def test_admin_orders_include_website_order(client):
    test_client, TestingSession = client
    order = place_order(test_client).json()
    with TestingSession() as database:
        admin = AdminUser(username="admin", password_hash="unused", is_active=True)
        database.add(admin)
        database.commit()
        session_token = create_session(database, admin)
    test_client.cookies.set(SESSION_COOKIE, session_token)

    response = test_client.get("/api/orders")

    assert response.status_code == 200
    assert response.json()[0]["source"] == "website"
    assert response.json()[0]["order_id"] == order["order_id"]
    assert "customer" not in response.json()[0]
    assert "payment_reference" not in response.json()[0]
    details = test_client.get(f"/api/admin/orders/{order['order_id']}")
    assert details.status_code == 200
    assert details.json()["items"][0]["sku"] == "AIG-PC-1"
    assert "customer_email" not in details.json()
    assert "shipping_address" not in details.json()
    session_details = test_client.get(f"/api/orders/{order['order_id']}")
    assert session_details.status_code == 200
    assert "customer_email" not in session_details.json()
    assert "payment_reference" not in session_details.json()
    history = test_client.get(f"/api/admin/orders/{order['order_id']}/transactions")
    assert history.status_code == 200
    assert {item["type"] for item in history.json()} == {"payment", "attempt"}
    assert all("provider_reference" not in item for item in history.json())


def test_security_headers_and_origin_restriction(client):
    test_client, _ = client
    response = test_client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    blocked = test_client.get("/api/health", headers={"Origin": "https://untrusted.example"})
    assert blocked.status_code == 403
