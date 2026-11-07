# GitHub Pages deployment

1. Push this project to a GitHub repository. Confirm `index.html`, `404.html`, and `assets/` are at the repository root.
2. Configure Firebase and Firestore before accepting real enquiries. Review [firebase/README.md](./firebase/README.md), then publish the restrictive rules from Firebase Console.
3. On GitHub, open **Settings → Pages**. Select **Deploy from a branch**, choose the production branch and `/ (root)`, then save. GitHub Pages will publish the static files without a server-side runtime.
4. For a repository subpath URL, test every page and admin link. This site uses relative file links, which remain relative to the published repository path.
5. The project includes a `CNAME` for `aigtechnology.in`. In **Settings → Pages**, configure `aigtechnology.in` as the custom domain after verifying you control it. At your DNS provider, configure the apex records to GitHub Pages' current published IP addresses and optionally a `www` CNAME to `<account>.github.io`. Follow GitHub's current DNS instructions for the account and confirm DNS propagation before enabling enforcement.
6. Wait until GitHub Pages reports the domain as verified and the TLS certificate as ready, then enable **Enforce HTTPS**. Do not assume the domain is active until GitHub and DNS both verify it.
7. Visit the Pages URL and verify the home page, navigation, 404 page, logo, mobile layout, Firebase reads/writes, administrator authorization, and console/network output.

## Checkout API deployment

GitHub Pages remains static and cannot host the FastAPI service. Deploy `backend/` separately to a trusted HTTPS host with PostgreSQL. Do not put database, session, Firebase service-account, or Razorpay secrets in GitHub Pages or a public JavaScript file.

1. Configure backend environment values from `backend/.env.example`, including `DATABASE_URL`, a strong random `SESSION_SECRET`, the allowed admin/storefront origins, and Firebase project ID.
2. Initialize the backend schema and apply migrations using the setup in `backend/README.md`.
3. Keep `PAYMENT_PROVIDER=mock` only for local/non-production usage. Configure Razorpay test credentials and webhook signature secret on the backend, then verify test transactions before changing the provider to production.
4. Set `PRODUCTION_API_BASE_URL` in `assets/js/api-config.js` to the public HTTPS API base ending in `/api`. This URL is public configuration, never a secret.
5. In Firebase Admin → Products, download the mapping report/template, approve SKUs and enter verified numeric inventory, run the read-only dry run, review all rows, then explicitly confirm the import. Retain the generated audit log. No stock is inferred from availability text.
6. Configure backend CORS with only exact HTTPS storefront/admin origins. Confirm that checkout totals match PostgreSQL prices, inventory reservation/release behaves correctly, failed payments remain unpaid, signed webhooks are accepted once, and website orders appear in backend Admin → Orders.
7. Configure the private Redis rate-limit store and monitoring before running multiple API workers. Production startup requires PostgreSQL, the expected Alembic revision, Redis storage, a strong session secret, HTTPS origins, and non-mock payment configuration.
8. For Windows API hosting, backup and rehearse migrations first, run Uvicorn as a service bound to `127.0.0.1`, and place it behind an HTTPS reverse proxy. Keep PostgreSQL, Redis, and the API's private port off the public internet. See `PRE_DEPLOYMENT_REPORT.md` for the detailed checklist.

For the prepared laptop-to-Xeon transfer package, file exclusions, host preflight, service account, verified backup restore, and rollback sequence, see [XEON_DEPLOYMENT_GUIDE.md](./XEON_DEPLOYMENT_GUIDE.md) and [TRANSFER_MANIFEST.md](./TRANSFER_MANIFEST.md). These instructions do not authorize deployment or change existing public website/DNS records.

The canonical links and sitemap use `https://aigtechnology.in`. Update them if the production domain changes. A domain's presence in `CNAME` does not configure DNS, prove ownership, or activate HTTPS.

## Release checklist

- [ ] Replace Firebase placeholders and deploy Firestore rules/indexes.
- [ ] Verify anonymous, non-admin, and admin permissions in Firebase Console or a dedicated test project.
- [ ] Assign admin custom claims privately; do not commit credentials.
- [ ] Add only verified product information and contact details.
- [ ] Confirm Cloudinary's unsigned preset restrictions and monitor upload usage.
- [ ] Review privacy and terms for the business's actual practices.
- [ ] Verify mobile and desktop pages and GitHub Pages paths.
- [ ] Deploy the HTTPS checkout API, set its CORS origins and production API URL, apply migrations, and sync eligible products.
- [ ] Test only with Razorpay test credentials; do not enable live payments until verified and authorized.
- [ ] Verify DNS and certificate state before enforcing HTTPS.
