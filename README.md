# AIG TECHNOLOGY website

A lightweight HTML, CSS, and vanilla JavaScript site designed for GitHub Pages, integrated with a FastAPI/PostgreSQL backend for order checkout. The original brand logo is stored at `assets/images/aig-technology-logo.jpeg`.

## Pages and functionality

- Public home, catalogue, product detail, About, Services, Contact, Privacy, Terms, and branded 404 pages.
- Shopping cart, delivery checkout, order confirmation, test-mode mock payment flow, and Razorpay Checkout integration points.
- Responsive mobile navigation, shared AIG color tokens, accessible forms, and product catalogue filtering.
- The homepage hero uses a local video at `assets/videos/aig-technology-hero.mp4` when supplied and otherwise falls back to the included poster illustration. Reduced-motion settings skip video playback.
- Firebase-backed product listings and enquiries, with an authenticated admin area for products, enquiries, and public settings.
- Cloudinary multi-image uploads using a browser-only unsigned preset; admins can select and upload multiple product images in one action. This keeps the website static but means the preset is public.
- Admin-managed product categories shared by the product form, catalogue filters, homepage category cards, and navigation; announcement banner, WhatsApp product enquiry links, and a service-enquiry workflow managed alongside existing admin enquiries.
- Firebase admin product updates can be synced into PostgreSQL. Checkout prices and available stock are read from PostgreSQL, not trusted from browser storage or page markup. Use Admin → Products → **Sync current catalog to checkout backend** to sync existing products.

## Local preview

This site uses ES modules and remote Firebase SDK modules, so serve it over HTTP rather than opening HTML files directly. From the repository root, run `python -m http.server 5500` and open `http://localhost:5500`. The FastAPI backend uses port 8000. Set the public API origin in `assets/js/api-config.js`; its default is for local development. No Node.js build step is required.

## Checkout and payments

- The mock provider is for local development only and is clearly labelled **TEST MODE**. Its simulated success is not a bank transaction. Mock checkout is rejected when `APP_ENV=production`.
- Before checkout, add a unique SKU, positive price, and stock quantity to each Firebase product. Run the catalog sync action from the signed-in Firebase admin panel. Website orders then reserve backend inventory and appear alongside Flipkart orders in the backend admin Orders page.
- `backend/` must be deployed separately from GitHub Pages. Configure the API CORS origins, database migration, and the production API URL in `assets/js/api-config.js` before enabling public checkout.
- Live Razorpay requires server-only `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` settings and `PAYMENT_PROVIDER=razorpay`. Configure Razorpay webhooks and complete authorized test-mode transactions before considering production activation. No live payment account is configured or verified by this code change.
- See [PAYMENT_FRONTEND_AUDIT.md](./PAYMENT_FRONTEND_AUDIT.md), [PAYMENT_IMPLEMENTATION_REPORT.md](./PAYMENT_IMPLEMENTATION_REPORT.md), and [PAYMENT_API_DOCUMENTATION.md](./PAYMENT_API_DOCUMENTATION.md) for audit, status, endpoints, and setup.

## Local backend and test setup

1. Create a PostgreSQL database and copy `backend/.env.example` to `backend/.env`. Set a long random `SESSION_SECRET`; leave Razorpay secrets empty for mock mode.
2. From `backend/`, install `pip install -r requirements-dev.txt`.
3. Initialize the schema and apply migrations with `python scripts/init_database.py` followed by `alembic upgrade head`.
4. Start the API from `backend/` with `uvicorn app.main:app --reload --port 8000`.
5. In another terminal, serve the repository root on port 5500 as described above. For admin API requests, create a backend admin with `python scripts/create_admin.py`.
6. Run backend checks from `backend/`: `python -m pytest -q tests`.

## Configuration before launch

1. Configure Firebase by following [firebase/README.md](./firebase/README.md). Until the Firebase web app values are filled in, product and enquiry features show setup guidance rather than fake listings.
2. Publish the Firestore rules from the Firebase Console. Client-side admin UI checks do not replace Security Rules.
3. In the admin panel, add verified product data and public contact details.
4. Cloudinary uploads use cloud `ndsxq0c2` and unsigned preset `ml_default`, previously supplied for this project. A live smoke test returned Cloudinary's error: `Upload preset must be whitelisted for unsigned uploads`. In Cloudinary Console, open the upload preset settings for `ml_default` and enable unsigned uploads/whitelist it. Restrict formats to JPEG/PNG/WebP, set an 8 MB limit, and restrict its folder to `aig-technology/products`. Retest from Admin → Products. Unsigned presets are public and can be abused, so monitor usage. Never enter a Cloudinary API secret in this site.
5. Product WhatsApp buttons use the configured `+91 8511693405` number to start product enquiries. They do not complete payment or send messages automatically.
6. Service enquiries use the existing private `enquiries` collection and appear in the admin Enquiries page. Publish the current Firestore rules before enabling the updated service form and announcement settings.
7. Replace the draft privacy and terms copy with business-reviewed details before launch. Confirm privacy contact, data retention, sales terms, applicable jurisdiction, and product-specific warranties.
8. Configure and verify the backend deployment and database. Add a unique SKU, positive price, and stock for online-sale items, then run the initial catalog sync from Admin → Products. Products without those fields remain enquiry-only for checkout.

Firebase web configuration, Cloudinary cloud name, and unsigned upload preset are public browser values. Do not add Firebase service-account credentials, Firebase Admin SDK secrets, or Cloudinary API secrets to this repository. Rotate the Cloudinary API secret previously shared in chat before using the account.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for GitHub Pages, custom-domain DNS, HTTPS, and verification steps. The `CNAME` file expresses the intended domain; it does not prove DNS or Pages has been configured.
