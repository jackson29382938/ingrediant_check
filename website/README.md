# Ingredient Check website

Static site for the Ingredient Check extension, prepared for Vercel. No build step.
The folder is directly inside the repository root, next to `manifest.json` and `src/`.
It is on `main`: https://github.com/jackson29382938/ingrediant_check/tree/main/website.

- `index.html` landing page and install steps
- `privacy.html` privacy summary (full policy: `docs/PRIVACY.md`)
- `vercel.json` clean URLs and security headers

Preview locally from the repository root: `python3 -m http.server 8000 --directory website`.

Deploy from the Vercel dashboard:

1. In the team where you have project-creation access, choose **Add New → Project**.
2. Import `jackson29382938/ingrediant_check` and use `main` as the production branch.
3. Set **Root Directory** to `website` and framework preset to **Other**.
4. Leave the build command empty and set the output directory to `.`. `vercel.json` also defines these choices.
5. Deploy. The landing page is `/`; the privacy policy is `/privacy` (clean URLs are enabled).

Use the live `/privacy` URL for extension listings. No Vercel account credentials belong in this
folder. A 403 when creating projects must be resolved through the selected team's permissions;
installing a CLI does not grant team access. If an existing project still cannot find the site,
check its Git repository, production branch and Root Directory, then redeploy the newest `main`.


Validation (with the pinned Playwright development tooling installed): `npm run website:check`.
CI checks both pages, navigation, mobile/desktop themes and production security headers. To verify
the actual deployment, run `npm run website:check -- --url https://YOUR-PRODUCTION-DOMAIN`.
Set the GitHub repository variable `WEBSITE_URL` to that HTTPS origin to enable the deployed check
in CI and release validation. Use a public production deployment with deployment protection off.
Once the final domain is chosen, use its `/privacy` URL in both browser listings and configure the
extension homepage and canonical/social metadata for that same domain. No live URL is invented
or claimed by this source-only setup.
