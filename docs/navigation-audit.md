# Navigation foundation audit

This is the historical Phase 1 audit. Phase 2 changes the version 2 geometry
workflow; see [current architecture and limitations](architecture.md). Legacy
waypoint-array behavior remains compatible with the foundation regressions.

Scope: `engine.js`, `render.js`, `preflight.js`, `log.js`, `record-route.html` and
`test-engine.html`, inspected against main commit `3db349d`. Fixes preserve the
existing interface, recorded route JSON shape, local log keys, event record fields,
and browser-only application. Added `route.js` shares validation across recorder,
import and engine boundaries. Node/Playwright are development tools only.

## Findings addressed in this branch

| Priority | Previous behavior / trigger | Change and regression coverage |
| --- | --- | --- |
| P0 | A waypoint was reached only inside the GPS accuracy radius: perfect accuracy could never hit, poor accuracy could prematurely hit, sparse sampling could skip a point forever. | Candidate zone capped at 10m (one third of leg length for short legs) with two reliable fixes at least 1s apart. Intermediate waypoint passage can use an 8m swept corridor only when the current fix follows the outgoing leg within 10m. Final arrival cannot use swept passage. Tests cover exact, skipped, missed-turn and stationary arrival. |
| P0 | Timer advanced even after bad GPS, error, stop or queued old watch callbacks. | Generation guards on watches, cancel confirmation on broken continuity or departure from the candidate/outgoing corridor. Confirmation retains the existing 1.2s visual hold and requires the last fix still be fresh. Tests cover stop/restart, poor fix, error and movement away. |
| P0 | NaN/out-of-range coordinates, stale/duplicate timestamps, negative speed and jumps could corrupt distances, dwell and route progress. | Validate finite coordinates/accuracy/time; reject duplicate, old (>5s), far-future (>1s), and implausible displacement (>25m/s plus both fixes' accuracy bounds). Speed fallback rejects negative/nonfinite device values. Explicit tests. |
| P0 | Rejected fixes returned without rendering weak GPS; total loss of callbacks never warned. | Existing signal glyph shown after five poor fixes or 5s without a reliable fix; errors/jumps warn immediately. `gps_recovered` added. No progression/dwell bridges signal gaps. |
| P0 | Elapsed time across GPS outages counted as stopped/moving; stationary state blocked reaching the destination. | Reset continuity on invalid fixes, errors and gaps; require continuous dwell evidence. Arrival remains active while stationary. Current fix is stored before transition logging. |
| P0 | Loading a malformed route could crash rendering; stored distances could be NaN/negative; starting near a later crossing could finish unexpectedly. | Shared route validation, allowlisted cue/segment, finite rotation, derived leg lengths, adjacent points >=1m, 2–10000 waypoints; require start acquisition within min(25m, half first-leg length). Imports are limited to 2MB. |
| P1 | Off-route display claimed “Finding a new route” / “Route updated” purely on elapsed time. | Retain caution until actual corridor recovery. No fabricated route update. Live stationary caution removes invented distance/confidence/control data. Possible missed turn is logged after leaving an outgoing corridor. |
| P1 | Preflight stayed green after timeout/unavailable GPS, reused old state and leaked watches on repeat starts. Wake-lock API absence blocked usable browsers. | Every GPS error invalidates accuracy; a 5s freshness timer and watch generations invalidate cached state. Wake-lock availability remains visible but is optional. |
| P1 | Fullscreen covered only the phone display, hiding End controls; late wake-lock resolution could keep the device awake after End. | Fullscreen encompasses controls; End/completion releases wake lock, fullscreen and orientation and restores viewport. Orientation attempted after fullscreen settles; asynchronous wake-lock acquisitions are released if obsolete. |
| P1 | Duplicate session labels overwrote research data; duration kept growing after End; completion lacked a lifecycle event. | Suffix conflicting labels; freeze ended duration; add `session_started`, `session_ended`, `route_started`, `route_completed`, `gps_error`, `gps_recovered`, and possible `turn_missed` events without removing original event fields. Completion finalizes harness resources and summary. |
| P1 | Local storage quota failures were console-only; saved landmarks/route names could inject markup; retry GPS callbacks could revive a cancelled waypoint. | Persistence warning with memory/export fallback; escape content at HTML boundaries; recorder capture generations, fresh-fix checks and poor-accuracy save rejection. Route overwrite confirmation and portable JSON import added. |
| P2 | Progress could be negative, right-turn text said left, stationary render could dereference a missing leg after completion. | Clamp progress, mirror directional copy for opposite rotation, render a completed route safely. Test both script-level rendering and complete browser workflows. |

## Behavior and limits retained deliberately

- Geometry is a straight segment from one recorded waypoint to the next. Curved
  roads can falsely trigger off-route; crossing, parallel streets, bridges and
  hairpins are not reliably distinguishable. Do not increase thresholds to hide
  this: collect full route geometry and ordered map matching next.
- Corridor hysteresis remains 25m to enter and 15m to leave, requiring three
  consecutive accepted fixes. Frequency changes detection latency; 1Hz takes
  roughly 3s. A short period without GPS cannot prove where a rider travelled.
- Reaching a turn means proximity or conservative sampled passage, not proof the
  maneuver was executed. A rider stopping within 10m can confirm a turn, then be
  marked off-route after riding straight. A skipped corner too far from the swept
  corridor remains unconfirmed. `turn_missed` is a hypothesis following a confirmed
  turn, not a road-network diagnosis. No automatic jumping to later legs.
- Two plausible but inaccurate fixes can still resemble arrival. The radius capped at 10m,
  20m accuracy cutoff, 5s freshness window, 25m/s displacement bound, and 3s/2s dwell
  thresholds are research defaults, not validated universal cycling settings.
  Zero/negative/NaN accuracy and timestamps are tested according to the validation
  contract (zero accuracy is accepted, negative/NaN are rejected).
- Device speed is preferred; without it, movement within the larger accuracy
  radius is treated as jitter. This can classify slow rolling as stationary.
  Dwell uses sampled interval evidence rather than continuous physical sensing.
- Confirm holds may advance using a reliable fix received <5s ago, even if no
  further callback arrives during the 1.2s hold. Longer silence cancels pending
  candidates; timer throttling is constrained by the freshness check on resume.
- Recovery re-acquires a fix without inferring travel during the outage. It does
  not replay missed turns or automatically resume after reload. Start acquisition
  is conservative for very short first legs; record well-separated points.
- `render.js` still uses illustrative SVG maps. Roundabout copy uses the original
  fixed “2nd exit”; the recorded schema cannot describe arbitrary exit numbers.
  Stationary Reroute/Report and interaction stubs are not functioning navigation
  features. Do not present them as real route generation or incident reporting.
- Research logs remain synchronous localStorage snapshots on meaningful events,
  not a full sampled GPS trace. Abrupt termination may omit the final event;
  quota/private browsing can prevent persistence. No automatic upload occurs.
- Mobile viewport browser tests are Chromium emulation, not physical Android/iOS
  validation. Background GPS, battery effects, OS permissions and wake-lock
  reliability need the device matrix in the roadmap.

## Evidence

`npm test` exercises deterministic simulated traces and clocks against the actual
scripts, with browser globals simulated at their boundary. `npm run test:browser`
exercises real pages/rendering/storage/downloads on desktop and mobile viewports;
only GPS is simulated. Browser errors and failed application assets fail the run.
The development server's HTTP startup and HTTPS certificate verification are also
checked locally. No routing provider, field ride, physical mobile device or
production deployment was tested.
