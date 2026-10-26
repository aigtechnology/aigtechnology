# Firebase setup

The site is a static GitHub Pages application. Firebase web configuration is public by design; Firestore Security Rules, not hidden JavaScript or API-key secrecy, enforce access.

1. Create or select the owner's Firebase project and register a Web app.
2. Copy the web app's `apiKey`, `authDomain`, `projectId`, and `appId` into `assets/js/firebase-config.js`. Do not put service-account keys or other private credentials there.
3. Enable **Email/Password** in Firebase Authentication and create administrator accounts manually. There is no public registration.
4. Firestore rules currently authorize the explicitly allowlisted UID `yZlWYVacbThKYgPnKgGJxAYCJIi2` and accounts with the `admin: true` custom claim. Publish the rules to activate this UID grant. For additional administrators, prefer assigning a custom claim from a trusted, private environment using the Firebase Admin SDK; never ship the Admin SDK or a service-account key to GitHub Pages. Firestore rules remain the security boundary.
5. Publish `firestore.rules` in Firebase Console → **Firestore Database → Rules**. Use Firestore Console → **Indexes** for any future indexes; the current catalogue queries do not require an additional composite index.
6. Create products in the admin panel. A product is public only when `published` is enabled. Add no inventory until its details and images are verified.
7. Cloudinary uploads use the unsigned preset name `ml_default` and cloud name `ndsxq0c2`, previously supplied for this project. A live 1×1 PNG smoke test confirmed the Cloudinary endpoint responds for this cloud and returned `Upload preset must be whitelisted for unsigned uploads`; no asset was created. In Cloudinary Console, edit `ml_default` and enable unsigned uploads/whitelist the preset. Allow only JPEG/PNG/WebP, set an 8 MB limit, and restrict the upload folder to `aig-technology/products`, then retry from Admin → Products. The preset is public and may be used by anyone who discovers it; monitor usage and do not treat it as a secret or a substitute for server-side authorization. Never place a Cloudinary API secret in the website. Rotate the API secret previously shared in chat.
8. The public announcement text and visibility are editable in Admin → Settings. Product and service enquiry forms use the existing private `enquiries` collection. Publish the updated Firestore rules before accepting service enquiries or saving the new announcement settings.

## Collections

- `products/{productId}`: catalogue entries; public reads are limited to published items.
- `enquiries/{enquiryId}`: public create only with bounded fields; reads and changes are admin-only. Internal notes are never exposed to public clients.
- `settings/publicSite`: public contact, footer, and product category settings. Product categories are shared with the public navigation, homepage category cards, and catalogue filter; rules allow up to 30 unique category names, each 1–80 characters. Do not place private settings in this document; all its fields can be read by visitors.

Public enquiry writes are constrained by Firestore rules, but a static site cannot provide robust rate limiting or bot detection. The honeypot and input validation are only basic abuse mitigations. Consider a server-side function or other abuse-protection layer before broad public use.

The site provides WhatsApp click-to-chat via `https://wa.me/918511693405`. It opens WhatsApp with a prefilled enquiry message; it is not the WhatsApp Business Platform API and does not send a message until the visitor chooses to send it.

## Verify Firestore permissions

The site does not require Node.js or a build step. Review the rules in `firebase/firestore.rules` and publish them in Firebase Console → **Firestore Database → Rules**. Use Firebase Console's rules playground or a dedicated test project to verify that public users can read published products and cannot create, change, or delete products; non-admins cannot read enquiries; and the authorized administrator can manage products, enquiries, public settings, and the bounded product category list. Do not weaken the rules to make an operation succeed.

## Assign administrator access

The UID `yZlWYVacbThKYgPnKgGJxAYCJIi2` is explicitly allowlisted by `firebase/firestore.rules` and recognized by the admin UI. To activate this access, publish the updated Firestore rules from Firebase Console → **Firestore Database → Rules**. No Firebase Admin SDK claim change is needed for this UID.

For additional administrators, use a trusted private identity-management backend to assign or revoke the `admin: true` custom claim. Never put Admin SDK credentials in this static website. The administrator must sign in again or refresh their ID token after a claim change.
