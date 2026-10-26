# AIG TECHNOLOGY website

A lightweight HTML, CSS, and vanilla JavaScript site designed for GitHub Pages. The original brand logo is stored at `assets/images/aig-technology-logo.jpeg`. Product inventory and public business contact details are intentionally not fabricated; the catalogue and enquiry flow become live after Firebase is configured.

## Pages and functionality

- Public home, catalogue, product detail, About, Services, Contact, Privacy, Terms, and branded 404 pages.
- Responsive mobile navigation, shared AIG color tokens, accessible forms, and product catalogue filtering.
- The homepage hero uses a local video at `assets/videos/aig-technology-hero.mp4` when supplied and otherwise falls back to the included poster illustration. Reduced-motion settings skip video playback.
- Firebase-backed product listings and enquiries, with an authenticated admin area for products, enquiries, and public settings.
- Cloudinary multi-image uploads using a browser-only unsigned preset; admins can select and upload multiple product images in one action. This keeps the website static but means the preset is public.
- Admin-managed product categories shared by the product form, catalogue filters, homepage category cards, and navigation; announcement banner, WhatsApp product enquiry links, and a service-enquiry workflow managed alongside existing admin enquiries.

## Local preview

This site uses ES modules and remote Firebase SDK modules, so serve the project over HTTP rather than opening HTML files directly. For example, from this folder run `python -m http.server 8000`, then open `http://localhost:8000`. No Node.js build step is required.

## Configuration before launch

1. Configure Firebase by following [firebase/README.md](./firebase/README.md). Until the Firebase web app values are filled in, product and enquiry features show setup guidance rather than fake listings.
2. Publish the Firestore rules from the Firebase Console. Client-side admin UI checks do not replace Security Rules.
3. In the admin panel, add verified product data and public contact details.
4. Cloudinary uploads use cloud `ndsxq0c2` and unsigned preset `ml_default`, previously supplied for this project. A live smoke test returned Cloudinary's error: `Upload preset must be whitelisted for unsigned uploads`. In Cloudinary Console, open the upload preset settings for `ml_default` and enable unsigned uploads/whitelist it. Restrict formats to JPEG/PNG/WebP, set an 8 MB limit, and restrict its folder to `aig-technology/products`. Retest from Admin → Products. Unsigned presets are public and can be abused, so monitor usage. Never enter a Cloudinary API secret in this site.
5. Product WhatsApp buttons use the configured `+91 8511693405` number to start product enquiries. They do not complete payment or send messages automatically.
6. Service enquiries use the existing private `enquiries` collection and appear in the admin Enquiries page. Publish the current Firestore rules before enabling the updated service form and announcement settings.
7. Replace the draft privacy and terms copy with business-reviewed details before launch. Confirm privacy contact, data retention, sales terms, applicable jurisdiction, and product-specific warranties.

Firebase web configuration, Cloudinary cloud name, and unsigned upload preset are public browser values. Do not add Firebase service-account credentials, Firebase Admin SDK secrets, or Cloudinary API secrets to this repository. Rotate the Cloudinary API secret previously shared in chat before using the account.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for GitHub Pages, custom-domain DNS, HTTPS, and verification steps. The `CNAME` file expresses the intended domain; it does not prove DNS or Pages has been configured.
