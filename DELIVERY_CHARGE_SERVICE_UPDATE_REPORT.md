# Delivery Charge and Service Booking Update

## Implemented

- Added server-side Indian PIN validation and state lookup in `backend/app/delivery.py`.
- Gujarat orders receive INR 350 packaging and delivery; all other verified Indian states receive INR 450.
- The charge is calculated once per order, persisted in the existing `website_orders.delivery_charge` field, and included in the trusted order total used for Razorpay.
- The verified PIN and detected state are retained in the existing order shipping JSON without changing the database schema.
- Added `GET /api/delivery/lookup?postal_code=380001` for checkout state/charge detection.
- Checkout now verifies the PIN, fills the detected city/state, displays the charge, sends the PIN to backend validation, and blocks order placement until verification succeeds.
- Admin order details now show PIN, detected state, subtotal, packaging/delivery, and final payable amount.
- Order confirmation emails now show subtotal, packaging/delivery, and final payable amount.
- Service booking no longer asks for or submits Address or Preferred contact time. Existing purchase verification and service request APIs remain in place.

## Validation status

| Check | Status | Result |
|---|---|---|
| Python syntax | PASS | Backend modules compile successfully. |
| Existing checkout API without PIN | PASS | Existing validation behavior remains available for cart previews. |
| Gujarat PIN order total | PASS | Existing checkout test order now calculates subtotal + INR 350. |
| Backend address persistence | PASS | Detected metadata stays in order JSON; legacy address table receives only supported columns. |
| Existing focused checkout suite | BLOCKED | Six older tests still assume mock payments and zero delivery; the current backend is Razorpay-only and the expected amount must include delivery. |
| Browser JavaScript syntax | NOT TESTED | Node.js is not installed on this PC. |
| Live Razorpay payment | NOT TESTED | No real customer payment was attempted. |
| India Post API availability | NOT TESTED | The implementation uses the API when available and a controlled PIN-prefix fallback when it is unavailable. |

## Manual verification

1. Restart the backend and frontend.
2. Open checkout and enter `380001`; confirm Gujarat and INR 350.
3. Enter `400001`; confirm Maharashtra and INR 450.
4. Try an invalid or blank PIN; order placement must remain blocked.
5. Open Services; Address and Preferred contact time should not be displayed.
6. Open an admin website order and verify the pricing breakdown.

