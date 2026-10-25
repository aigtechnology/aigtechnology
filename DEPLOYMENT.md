# GitHub Pages deployment

1. Push this project to a GitHub repository. Confirm `index.html`, `404.html`, and `assets/` are at the repository root.
2. Configure Firebase and Firestore before accepting real enquiries. Review [firebase/README.md](./firebase/README.md), then publish the restrictive rules from Firebase Console.
3. On GitHub, open **Settings → Pages**. Select **Deploy from a branch**, choose the production branch and `/ (root)`, then save. GitHub Pages will publish the static files without a server-side runtime.
4. For a repository subpath URL, test every page and admin link. This site uses relative file links, which remain relative to the published repository path.
5. The project includes a `CNAME` for `aigtechnology.in`. In **Settings → Pages**, configure `aigtechnology.in` as the custom domain after verifying you control it. At your DNS provider, configure the apex records to GitHub Pages' current published IP addresses and optionally a `www` CNAME to `<account>.github.io`. Follow GitHub's current DNS instructions for the account and confirm DNS propagation before enabling enforcement.
6. Wait until GitHub Pages reports the domain as verified and the TLS certificate as ready, then enable **Enforce HTTPS**. Do not assume the domain is active until GitHub and DNS both verify it.
7. Visit the Pages URL and verify the home page, navigation, 404 page, logo, mobile layout, Firebase reads/writes, administrator authorization, and console/network output.

The canonical links and sitemap use `https://aigtechnology.in`. Update them if the production domain changes. A domain's presence in `CNAME` does not configure DNS, prove ownership, or activate HTTPS.

## Release checklist

- [ ] Replace Firebase placeholders and deploy Firestore rules/indexes.
- [ ] Verify anonymous, non-admin, and admin permissions in Firebase Console or a dedicated test project.
- [ ] Assign admin custom claims privately; do not commit credentials.
- [ ] Add only verified product information and contact details.
- [ ] Confirm Cloudinary's unsigned preset restrictions and monitor upload usage.
- [ ] Review privacy and terms for the business's actual practices.
- [ ] Verify mobile and desktop pages and GitHub Pages paths.
- [ ] Verify DNS and certificate state before enforcing HTTPS.
