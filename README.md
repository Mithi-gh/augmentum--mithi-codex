# Augmentum

A cycling navigation research prototype: an existing motion/stationary interface,
GPS navigation engine, route recorder, and local research logs. Vanilla HTML,
CSS, and JavaScript; no application framework, bundler, backend, or runtime npm
dependencies. The map graphic is an illustration, not a road map. Rerouting is
not implemented.

## Run locally

Requires Python 3.10+ (server). Node 22+ is needed only for tests and npm shortcuts.
From the repository root:

```sh
python3 tools/serve.py
# Equivalent: npm run dev
```

Open the address for port 8000 on your own localhost in a browser. Start at
`index.html`, record at least two waypoints in `record-route.html`, then select
the saved route in `test-engine.html`. Alternatively import a recorded JSON backup
using **Import route JSON**. Allow location access and wait for accuracy under
20m. Go near the recorded start before expecting progression. Start/End controls
remain available in fullscreen. Wake lock and orientation are optional and their
actual status is displayed.

Routes/logs belong to the current browser **origin**: changing host, port, HTTP
versus HTTPS, device, or browser changes storage. Export before switching origins;
use the JSON import to transfer routes. Logs are sensitive location data: retain
and share them deliberately. Storage failure is displayed; in-memory logs remain
downloadable until the page is closed. This prototype does not resume sessions
after reload and does not track reliably while backgrounded.

## Test without a ride

```sh
npm test                          # deterministic GPS/unit tests; no npm install needed
npm ci                            # only browser-test tooling
npx playwright install chromium  # browser download; Linux may need install --with-deps
npm run test:browser              # starts/stops its own development server
```

To use an already installed Chromium, set `CHROMIUM_PATH` to its executable, e.g.
`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. Node tests use simulated
coordinates, fake time, GPS errors, and the real engine/render/log scripts.
Browser checks run complete recorder and harness workflows at desktop and mobile
viewport sizes using a simulated sensor boundary. They cover route recording,
JSON download/import, stationary/motion transitions, arrival, device cleanup, log
export, stale preflight and escaped user content. No hardware GPS is required.
A separate desktop regression deliberately delays fullscreen exit to verify that
cleanup checks await browser completion. Browser failures include the scenario
name and browser/runtime versions. CI runs these checks without deployment.

## Use a phone on the same LAN

A phone opening a computer's plain HTTP LAN address usually cannot use geolocation.
Use a certificate trusted by **both** the computer and phone; do not disable TLS
verification. One option for a private development LAN is mkcert:

1. Install mkcert using its official instructions, run `mkcert -install` on the
   computer, and find the development CA public certificate with `mkcert -CAROOT`.
2. Install/trust **rootCA.pem only** on the phone following its OS instructions
   (iOS also needs full trust enabled under Certificate Trust Settings). Keep the
   CA private key on the computer; never distribute `rootCA-key.pem`.
3. Substitute the computer's current LAN IP for `192.168.1.50` below:

```sh
mkdir -p .local
mkcert -cert-file .local/dev.pem -key-file .local/dev-key.pem localhost 127.0.0.1 192.168.1.50
python3 tools/serve.py --host 0.0.0.0 --port 8443 --cert .local/dev.pem --key .local/dev-key.pem
```

Open the HTTPS address for that LAN IP and port 8443 on the phone, including
`/test-engine.html` or `/record-route.html`. Allow inbound access only on your
private LAN as needed. Both devices must be on the same network. Regenerate the
certificate if the IP changes. `.local/` is ignored; never commit certificates or
keys. The server serves the checkout for development and must not be exposed as a
production service. Stop it with Ctrl-C. No deployment is required.

If GPS stays red, check trusted HTTPS, site and OS location permissions, browser
foreground state, and outdoor accuracy. Mobile browser wake lock, fullscreen,
orientation and file sharing vary by browser. Keep the tab visible for research
sessions; a successful desktop simulation does not prove mobile reliability.

## Full geometry routes (Phase 2)

The harness imports both original waypoint arrays and version 2 polyline JSON.
Version 2 separates dense route coordinates from maneuver indices, uses actual
along-route distance, and requires outgoing evidence at turns. Existing recorded
arrays still work in compatibility mode; adding a format wrapper cannot recover
curves that were never recorded. The recorder continues to export the original
format.

Use **Import route JSON** in `test-engine.html` to select a version 2 file. See
[the schema and matching architecture](docs/architecture.md) and
[synthetic example](examples/geometry-route.json). The example is near the equator
and is a test artifact, not a real cycling route. To exercise navigation without
riding, run the automated simulated GPS suites; importing an example does not
simulate live GPS by itself.

The debug panel now shows matching status and cumulative progress. “Position
uncertain” pauses geometry guidance; 20m/50m accuracy readings freeze progress.
After interrupted GPS, three reliable local fixes are needed to resume. There is
no global snap after long outages, real map, provider connection or automatic
reroute. Research exports add route identity, revision and matched progress while
preserving the original fields.

The browser suite covers both legacy and geometry formats at desktop/mobile sizes;
the script suite includes curves, crossings, parallel paths, loops, U-turns,
stationary jitter, walking/cycling speeds, 5m/10m/20m/50m accuracy, signal recovery
and premature-arrival protection.

See [navigation audit](docs/navigation-audit.md) and [prioritized roadmap](docs/roadmap.md).
