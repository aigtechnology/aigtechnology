# Payment Frontend Audit

Audit of the repository before the checkout implementation, followed by the integration decisions made during implementation.

## 1. Existing checkout functionality

- The public site is static HTML/CSS/vanilla JavaScript intended for GitHub Pages.
- `products.html` and `product.html` use `assets/js/site.js` and Firestore-backed product documents.
- Product cards showed the Firebase `price` field when present, linked to product enquiries, and offered WhatsApp enquiry links.
- There was no persistent cart, checkout form, website order creation, online payment flow, or customer order lookup.
- The Firebase product editor already supported SKU, price, publication, stock quantity, and images.

## 2. Missing frontend components

- Cart add/update/remove and server-validated cart totals.
- Customer, delivery, optional billing, and terms fields.
- Checkout loading/error/payment states and a secure order confirmation view.
- A clearly labelled mock payment selection and Razorpay Checkout browser integration.
- Customer order-detail access without relying on a predictable order number.
- An admin flow to sync existing Firebase products to the backend catalog.

## 3. Existing payment-related backend endpoints

There were no website checkout or payment endpoints. The existing FastAPI app provided health, backend admin login/session, dashboard summary, Flipkart order and return listings, and a Flipkart connection check. Its `/api/orders` data represented Flipkart marketplace orders only.

## 4. Missing backend endpoints

The backend had no customer, website order, payment, payment attempt, webhook, refund, inventory reservation, catalog-sync, or secure customer order-lookup routes. These have now been added; see [PAYMENT_API_DOCUMENTATION.md](./PAYMENT_API_DOCUMENTATION.md).

## 5. Database changes required

The repository already had PostgreSQL `business_products` and `inventory` tables for backend business data, but the public Firebase catalog was separate. There were no website customers, addresses, website orders/items, payments/attempts, webhook event records, reservations, or refunds.

The implementation adds those records and catalog mapping/stock/image columns to `business_products`. Existing backend products are not deleted or replaced. Apply the migration in `backend/migrations/versions/20261107_01_website_checkout.py`.

## 6. Integration plan

1. Keep the existing GitHub Pages storefront and Firebase product administration.
2. Use Firebase ID-token signature, project audience, issuer, and admin claim/allowlisted UID checks before syncing catalog data to PostgreSQL.
3. Use PostgreSQL prices and stock as checkout authority; the browser sends SKUs and quantities only.
4. Reserve inventory transactionally and protect repeated order creation with an idempotency key.
5. Keep order and payment states separate; confirm only a verified mock test result in non-production or a verified Razorpay event/provider status.
6. Merge website orders into the existing backend admin Orders page while retaining Flipkart orders.
7. Leave GitHub Pages static and deploy the API separately.

## 7. Security issues and controls

- **Browser-controlled price/quantity/total:** prices and totals are recomputed server-side; stock is checked and reserved from PostgreSQL.
- **Unrelated Firebase/PostgreSQL catalogs:** an authenticated Firebase-admin sync is used; an initial sync is required before existing products can be bought online.
- **Predictable order lookup:** generated UUID order references are protected by a separate high-entropy access token. The token is returned once and stored in the browser session; order requests send it in a header, not a URL.
- **Repeated requests and inventory races:** order idempotency fingerprints and PostgreSQL row locks prevent duplicate orders and overselling.
- **Mock payments:** only available outside production and prominently labelled as simulation; it never represents a bank transaction.
- **Provider secrets and card data:** Razorpay secrets stay in backend environment settings; no card, CVV, UPI PIN, or other payment credentials are collected by this site.
- **Webhook trust:** Razorpay webhook signatures are checked against the raw body before JSON processing; event IDs are unique and duplicate events are idempotent.
- **Public abuse:** checkout routes have per-IP rate limits and strict input bounds. The configured limiter is process-local; use shared rate limiting at the edge or a shared store before scaling multiple API workers.
- **Deployment:** production must use HTTPS, a strong random `SESSION_SECRET`, correct API CORS origins, database backups, and business-reviewed privacy/terms copy. The deployed backend/API origin is not configured in this repository.
