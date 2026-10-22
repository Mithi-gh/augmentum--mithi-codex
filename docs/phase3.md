# Phase 3: maps, planning and live navigation

Base: main `1e880979e0f06373990399c0b8fa8b7e3e0a07d2`, containing Phase 2 and
fullscreen fix `d44cf2c`. Development branch: `feature/phase3-maps-routing`.

## Provider and dependency choice

The user selected **Mapbox**. It supplies cycling directions, alternatives when
available, address/place search and styled road tiles using a restricted public
browser token. This supports one client-side provider boundary and avoids a proxy
for confidential keys. Leaflet 1.9.4 is the sole new runtime dependency: it displays
Mapbox raster tiles plus the existing engine's geometry and GPS, without replacing
navigation with a provider SDK UI. No frontend framework or backend was added.

Alternatives considered: openrouteservice/GraphHopper can provide cycling routes
but confidential-key handling may need a proxy and a separately chosen tile
service. MapLibre GL would add vector styling/rotation/GPU overhead; it can replace
only the map view later if those capabilities justify it. Mapbox GL JS is also an
option for vector styles, but was unnecessary for this retained raster map.
Maps stay north-up. Credible device bearing is shown as a heading marker; the
existing maneuver arrows remain unchanged. This avoids rotating labels and adding
a map-rotation plugin to the approved interface.

Current provider documentation was not retrievable in this environment (HTTP 403).
The integration follows the Directions v5 GeoJSON/steps and Geocoding v6 forward
contracts, verified against controlled fixtures. **Live API compatibility, account
entitlements, token restrictions and local routing quality remain to be verified
with an actual account.** No live paid request was made.

## Configuration and privacy

Use a Mapbox account and a public `pk.` token with appropriate public read access
for Maps styles/tiles, cycling Directions and Geocoding. Follow current Mapbox
settings to restrict allowed URLs to the development origins actually used on the
computer and phone (including correct scheme/port). A token rejected with 401/403
must be checked in the account; do not remove URL restrictions just to bypass it.
Never paste private keys into the application or chat. No private key is required
by this client-only implementation.

Enter the public token in `navigate.html` and explicitly authorize online requests.
It remains in memory, the field is cleared after enabling, and the token is never
saved in localStorage, source or research logs. A reload requires re-entry. Public
browser tokens necessarily appear in network requests; URL restrictions, least
privilege, usage monitoring and revocation are essential. There is no server-side
environment injection because no confidential credential is needed. The local
server blocks private dot paths, symlink escapes and directory listings so ignored
certificate keys cannot be downloaded through it.

Mapbox receives search text and planned origin/destination; live GPS is sent only
when explicitly setting the origin or requesting a replacement. Map tiles reveal
the viewed area. The user must authorize provider usage/billing in the planner.
No telemetry SDK, user account, upload service or subscription was introduced.
Search is debounced and cancelled; autocomplete requests and tiles may still be
billable according to current provider terms. The local research event log remains
sensitive location data and should be handled deliberately.

Enable outbound browser access to `api.mapbox.com` when using a restricted testing
network. Leaflet is served locally by `npm ci`; there is no CDN JavaScript. Maps
include Mapbox and OpenStreetMap attribution. Confirm current Mapbox logo and
feedback-link requirements as part of the live-account review before staging. This is not an offline tile cache;
provider results are held in memory. Review current provider terms before adding
persistent geocoding, tile caching or public staging.

## Modules and data flow

- `navigate.html`, `navigation.css`, `navigation.js`: new dark, mobile-first planner
  and session controls. Search origin/destination, current GPS origin, preview,
  alternatives, start, pause/resume, end, recenter and research export.
- `routing.js`: UI-independent `MapboxRoutes.Client`, strict adapter and
  `RoutingController`. HTTPS fetches have a 10s timeout and abort support. Errors
  distinguish authentication/restriction, rate limit, network, invalid payload and
  no route, without logging URLs or credentials. Search results use named labels
  and validated coordinates. Directions use `mapbox/cycling`, full GeoJSON, steps
  and alternatives.
- The adapter recalculates distance, assigns strictly ordered maneuver geometry
  indices, maps directions/rotations/roundabout exits, rejects missing geometry or
  arrival, and always uses infrastructure `unknown`. Provider duration supplies
  an ETA estimate proportional to remaining matched distance; it is not a live
  speed/traffic/gradient prediction. Provider endpoints over 100m from selected
  origin/destination are rejected. Within that limit the engine still requires
  acquisition near the snapped route start; it does not trust planning origin as GPS.
- `map-view.js`: one retained Leaflet instance and route line, current raw GPS dot,
  uncertainty circle, heading indicator, maneuver/destination markers. It moves
  between preview, stationary map and full map; it is not rebuilt on GPS updates.
  Panning disables follow until Recenter. Tile/GPS failures have separate truthful
  notices. No map is introduced into the approved moving glyph screen.
- `engine.js`: unchanged Phase 2 matching plus pause/resume that retains the route
  and matcher anchor. Watch generations reject queued callbacks; resume requires
  local reacquisition. Existing event fields/local log/export remain compatible.

## Route replacement

The state machine is idle -> requesting -> preview (validated choices) -> accepted,
or failed/cancelled. A stale or cancelled request cannot supply an active route.
The original route remains active while requesting and after failure.

During a navigation session, off-route evidence from Phase 2 triggers a request
only with a <=5s-old fix, accuracy <=10m, and no weak GPS flag. There is at most one
automatic attempt per off-route episode, with a 15s cooldown even for manual retry.
Success validates before activation, increments route revision, resets matching
against the new geometry and continues the **same research session**. A replacement
is not reported as activated until it has actually been installed in the engine;
its position must then be acquired normally. No elapsed timer fabricates success.
Failure keeps the old route and warns the user to rejoin or retry safely. Pause,
end, destination changes and obsolete requests prevent stale activation.

Logs add `route_replacement_requested`, `route_replacement_failed`, `route_replaced`,
`session_paused`, `session_resumed` while retaining Phase 1/2 fields and storage.
Session duration remains wall-clock research duration including pauses; navigation
progress freezes while paused. No continuous GPS trace upload occurs.

## Approved interface preservation

`style.css` and `glyphs.js` are unchanged. `render.js` only adds optional map-attachment
hooks and hides an old full map on motion transition. Cards, typography, colors,
glyphs, progress bands, stationary/motion hierarchy and animations are preserved.
The new planner has its own stylesheet using existing tokens; map-only overlays,
attribution and zoom controls are contained in the existing map region. Additional
pause/end/recenter controls sit outside the navigation display. No visual redesign
was needed. Report remains a truthful unsupported research control.

Before editing the interface, 390px and 1200px viewport references were captured for
normal, prepare, act, stationary and off-route states in `tests/visual/baseline`.
The visual runner compares actual pixels to those references, masking only the
map region deliberately being replaced. Small anti-aliasing differences between
browser builds are tolerated (<1.5% pixels at a 0.1 color threshold). CI's Chromium
151 measured up to 1.05% raster variance against the Chromium 154 references.
Exact rendered markup/glyph/copy hashes, stylesheet/font source hashes and computed
color/typography/spacing checks independently protect the approved design. Negative
controls verify that changed glyphs and font sizes fail, even within the pixel budget.
Baselines are never automatically regenerated. Failed comparisons upload actual,
expected and diff images plus browser metadata as CI artifacts. Local results were 0% change in all ten views.

## Running and validation

`npm ci`, then `npm run dev`. Open `navigate.html`, configure the restricted public
token and opt in to online services. For a phone use the README's trusted HTTPS
LAN certificate steps; trust the development CA on the phone and configure the
matching token origin. Do not expose this development server to the public Internet.
This is the delivered local demo; no staging or production deployment was performed.
A cloud worker loopback address is not the phone’s localhost. For LAN testing,
clone this feature branch onto a computer on the same private Wi-Fi as the phone,
run `npm ci`, and start the trusted HTTPS server there using the README steps.

Run `npm test`, `npm run test:browser`, `npm run test:journey` and
`npm run test:visual`. All browser commands accept `CHROMIUM_PATH`; otherwise
install the pinned Playwright Chromium with `npx playwright install chromium`.
Tests intercept all Mapbox requests and never require a paid account. They cover
search/selection, alternatives, geometry adaptation, HTTP/rate/timeout failures,
stale requests, the retained map/full-map view, tile outages, GPS loss, original
matching, pause/resume, failed and accepted replacement, arrival, ending a new
session and desktop/mobile widths. Original tests remain unchanged.

## Remaining limitations and Phase 4

Physical iPhone Safari/Android Chrome GPS, permissions, wake lock, battery usage,
background suspension and actual cycling instructions are **unverified**. Closing
the tab ends in-memory navigation; no active-session restoration is promised.
Returning to foreground invalidates continuity and requires reliable matching.
Long-gap recovery remains limited to Phase 2's local matcher window. Lane-level,
altitude/bridge separation and cycling safety ratings are not inferred.

With no Mapbox token, the legacy recorder/harness and all mocked tests still run,
but live search, real road tiles and route generation require account setup.
Phase 4 should prioritize real API/account validation and consenting device traces,
then durable sessions/recovery, accessibility and measured battery/performance.
Do not expand accounts, social features, monetization or offline caching first.


Validation recorded on Node 22 with system Chromium 154: all 63 script tests
passed (including the original 51 unchanged tests), legacy browser workflows
including delayed fullscreen cleanup passed, desktop/mobile consumer journeys
passed, and all ten approved reference comparisons showed 0% changed pixels.
Hosted CI and the Playwright-downloaded Chromium build have not been verified;
this environment blocks that browser download. Tests use mocked provider data,
not a live Mapbox account.
