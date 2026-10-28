# Tester-ready staging

The site owner configures Mapbox once. Testers open `navigate.html`; they do not
need a Mapbox account, token, or developer settings. No backend is required.

## Owner setup (once)

1. In Mapbox, create a **public `pk.` browser token** for this prototype. Restrict
   allowed URLs to your GitHub Pages site (`https://mithi-gh.github.io`), plus
   localhost only if needed. Confirm the allowed URL format in Mapbox's dashboard.
   Keep usage limits/alerts appropriate for a shared prototype.
2. In GitHub repository **Settings → Secrets and variables → Actions → Variables**,
   choose **New repository variable**. Name it `MAPBOX_PUBLIC_TOKEN` and paste the
   public token as its value. Never use a secret `sk.` token.
3. Merge this change, then manually run **Deploy staging to GitHub Pages** on
   `main`. The build now refuses to publish without a valid public-token format.
4. Open the staging link in a fresh/private browser. It should say “Ready to ride”
   and hide developer connection settings. Test on a phone before sharing.

The token is intentionally visible in the generated public `config.js` and browser
network requests. A GitHub secret would not make a browser token confidential.
URL restrictions and account limits protect usage; there is no backend quota or
access control. Rotate the token in the repository variable and redeploy if needed.
The workflow stays manual and runs all test suites before publishing. It accepts either a repository variable or secret named MAPBOX_PUBLIC_TOKEN (the variable takes precedence). This change does not publish the site automatically.

## Local development

Run `npm ci`, then `npm run dev`; open `/navigate.html`. The checked-in `config.js`
contains no credentials. Developer connection settings still allow a public token
for one tab, with explicit online-request authorization.

For the same automatic setup locally, run:

```sh
MAPBOX_PUBLIC_TOKEN='pk.YOUR_PUBLIC_TOKEN' node tools/configure-staging.cjs .local
```

Copy the generated `.local/config.js` over root `config.js` temporarily, ensuring
localhost is allowed by the token. Restore root `config.js` with `git restore
config.js` before committing. Do not commit a personal token. Never share `.local`
certificates or private keys.

## Search behavior and limits

Hosted configuration defaults to address geocoding with a Pune-area proximity
bias (73.8567, 18.5204), based on the current test location. Selecting an origin
replaces that bias; this is ranking, not a hard geographic boundary. Pan the map
and use **Choose start/destination on map** for missing addresses or landmarks.

Search Box regional coverage does not reliably include Indian POIs. Keep it off
for Pune. For a supported region, the owner may set repository variable
`MAPBOX_SEARCH_BOX` to `true` and redeploy; this enables suggestions for businesses,
landmarks and addresses plus the Addresses only switch. Suggestions are retrieved on selection using the same
session token; a new session starts after selection. Ten suggestions are requested.
The selected origin (or destination when no origin exists) biases nearby results;
**Use current location** can establish that bias without typing an address.
Location permission is requested only when tapped. No automatic GPS permission
prompt is added. Before selecting either location, include a town or postcode.

**Addresses only** uses Geocoding v6, which does not provide general POI search.
Empty Search Box results also try address geocoding. Search Box availability and
coverage vary by country and account; on service/access errors, choose Addresses
only. No automatic fallback hides billing, authorization or network errors.
Spelling, informal local names, missing street numbers and provider data gaps can
still prevent matches. The application cannot repair missing provider addresses.

Search and map calls disclose queries/coordinates to Mapbox under its terms.
Requests use the browser language and Pune/selected-location bias without a country
restriction. Search results are transient and are not written to research logs.
Live coverage, account permissions and current session billing must be checked
with the owner's Mapbox account; automated checks use fixtures, not paid requests.

## Validation

Run `npm test`, `npm run test:browser`, `npm run test:journey` and
`npm run test:visual`. Browser suites require Playwright Chromium, or set
`CHROMIUM_PATH` to an installed Chromium binary. Tests cover manual and configured
onboarding, refresh without token entry, nearby place selection, address searches,
provider errors and the approved navigation reference screens.

## Welcome screen

The home page introduces the ride with a responsive illustrated route and a single
Let’s ride link. Research tools are tucked into the footer. The planner shares its
palette while the approved in-ride display remains unchanged. The illustration is
explicitly labelled; it is not a live route or a preview of provider coverage.

Hosted visitors never see token-entry fields. Without configured access, the
planner displays an unavailable message and disables route-planning controls.
Localhost development retains the optional per-tab connection panel. The release
build still refuses to publish without a public token, so missing configuration
cannot overwrite a working live deployment.
