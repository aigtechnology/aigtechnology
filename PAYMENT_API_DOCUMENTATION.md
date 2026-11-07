# Checkout and Payment API

Base path: `/api`. The static storefront calls the configured public API origin from `assets/js/api-config.js`. JSON amounts are INR decimal strings in responses. The backend remains the source of product prices and stock.

## Catalog sync (Firebase admin)

### `POST /api/catalog/sync`

Requires `Authorization: Bearer <Firebase ID token>`. The backend verifies the token signature, Firebase project audience/issuer, and either the configured admin claim or allowlisted owner UID.

```json
{
  "catalog_id": "firebase-document-id",
  "sku": "AIG-PC-001",
  "name": "Refurbished desktop",
  "price": 12500,
  "stock_quantity": 3,
  "published": true,
  "image_url": "https://images.example.test/product.webp"
}
```

Non-published, unpriced, or SKU-less entries are not eligible for checkout. Inventory quantity changes only when the Firebase source stock value changes; an unchanged source value does not replenish stock after an order.

### `DELETE /api/catalog/{catalog_id}`

Requires the same Firebase admin bearer token. Archives the backend listing; it does not delete product/order history.

## Checkout and order

### `POST /api/checkout/validate`

Limited to 30 requests/minute per client IP. The body accepts SKUs and quantities only; unknown fields such as client-supplied prices are rejected.

```json
{ "items": [{ "sku": "AIG-PC-001", "quantity": 1 }] }
```

Returns authoritative item names, image references, quantities, unit prices, line totals, delivery, discounts, total, and currency. Delivery and discount are currently zero.

### `POST /api/orders/create`

Limited to 10 requests/minute per client IP. Requires an `Idempotency-Key` header and a validated customer/address payload. Terms acceptance is required.

```json
{
  "customer": {
    "full_name": "Customer Name",
    "phone": "9876543210",
    "email": "customer@example.com"
  },
  "address": {
    "line1": "12 Example Road",
    "line2": "",
    "city": "Ahmedabad",
    "state": "Gujarat",
    "postal_code": "380001"
  },
  "billing_address": null,
  "items": [{ "sku": "AIG-PC-001", "quantity": 1 }],
  "terms_accepted": true
}
```

Returns server-generated `order_id`, `payment_id`, a high-entropy `lookup_token`, and total. Save the lookup token in the current browser session and send it as `X-Order-Access-Token`; do not put it in a URL or logs. Reusing the same idempotency key with the same request returns the same order; using it for a different request returns `409`.

## Payments

### `POST /api/payments/create-order`

Requires `X-Order-Access-Token` and `{ "order_id": "<UUID>" }`. Starts a mock test attempt or creates/reuses a Razorpay order. The mock response lists success/failure simulation options and explicitly states it is not a bank transaction. Mock payments are rejected in production.

For Razorpay, the response exposes only the public `key_id`, provider order reference, amount, and currency. The key secret and webhook secret are never returned.

### `POST /api/payments/verify`

Requires `X-Order-Access-Token`, order ID, and payment ID. In mock mode, non-production only:

```json
{ "order_id": "<UUID>", "payment_id": "<UUID>", "outcome": "success" }
```

For Razorpay, submit `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`. The backend checks the HMAC signature and verifies the payment status, order ID, amount, and currency directly with Razorpay before confirming it. A browser redirect alone is not authoritative.

### `GET /api/payments/{payment_id}/status`

Requires the order access token header. For an eligible pending/authorized Razorpay payment reference, the backend reconciles against provider status before returning.

### `POST /api/webhooks/razorpay`

Provider-only endpoint. Requires `X-Razorpay-Signature` and `X-Razorpay-Event-Id`. The signature is verified against the raw request body before JSON parsing. Event IDs are unique; duplicate deliveries are acknowledged without applying state changes again. Configure `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed` events in Razorpay.

### `POST /api/payments/{payment_id}/refund`

Requires an authenticated backend admin session cookie and an `Idempotency-Key` header. Body: `{ "amount": 100.00 }`. Mock refunds are simulations in non-production; Razorpay refunds are initiated server-side and remain pending until provider confirmation where applicable.

### `POST /api/admin/payments/{payment_id}/reconcile`

Requires an authenticated backend admin session. Checks the recorded Razorpay payment reference with the provider and reconciles captured/authorized/failed state. It is not available for mock payments.

## Orders and admin

- `GET /api/orders/{order_id}`: customer must send `X-Order-Access-Token`; backend admin sessions may access for admin support.
- `GET /api/orders`: backend admin session required; returns a combined, paginated list of website and Flipkart orders. Optional filters: `status`, `payment_status`, `date_from`, `date_to`.
- `GET /api/admin/orders/{order_id}/transactions`: backend admin session required; returns payment attempts and refund history.
- `PATCH /api/admin/orders/{order_id}/status`: backend admin session required; moves captured orders along Confirmed → Processing → Shipped → Delivered.

Order statuses: Pending Payment, Confirmed, Processing, Shipped, Delivered, Cancelled. Payment statuses: Created, Pending, Authorized, Captured, Failed, Refunded, Partially Refunded.

## Errors and deployment notes

Invalid input returns `422`; insufficient/changed stock, duplicate key conflicts, or invalid state transitions return `409`; missing/invalid access tokens return `401` or `404`. Public checkout endpoints use per-process IP rate limits; add shared edge limits before multi-worker/multi-instance production deployment.
