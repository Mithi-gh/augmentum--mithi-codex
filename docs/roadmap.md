# Prioritized implementation roadmap

Phase 3 now adds a consumer planner, Mapbox search/cycling adapter, Leaflet map,
route selection, pause/resume and genuine replacement-route lifecycle. These are
mock-validated; live provider/account and field validation are still required.
See [Phase 3 configuration and limitations](phase3.md).

Phase 2 supplies full polyline geometry, a versioned wire format, ordered
matching, uncertainty/reacquisition states, along-route maneuvers and regression
coverage. See [the implementation contract and limits](architecture.md). Legacy
arrays retain foundation compatibility behavior. Thresholds are conservative
research defaults and still require physical-device/field validation.

The current browser code and navigation interface remain the foundation. A map
library and routing provider can be integrated without a framework rewrite. Each
phase should remain reviewable and pass the simulated GPS suite before field use.

| Order | Deliverable | Completion criteria |
| --- | --- | --- |
| Phase 1 · complete | Validated route/GPS inputs, conservative progress and arrival, continuity-aware dwell, honest off-route state, session cleanup, preserved logs, local/HTTPS server, deterministic and browser tests. | Tests and local server checks pass; audit records remaining geometry limitations. |
| Phase 2 · implemented | Versioned route model with dense geometry, maneuver indices, route ID/version and distance along the path. Keep an adapter for existing recorded JSON arrays. Separate maneuver semantics from display copy. | Synthetic tests cover curves, loops/crossings, parallel paths, U-turns, reverse travel, roundabout copy and start-away protection. Physical streets, grade separation and closely spaced maneuvers still require field validation. |
| Phase 2 · implemented, field validation pending | Ordered projection/map matching onto the full polyline; bounded forward/backward search, accuracy-aware hysteresis, heading when credible, explicit lost/reacquiring state, elapsed-time off-route evidence. | Deterministic traces cover seeded GPS noise, interrupted signals, skipped turns and local recovery. Match ambiguity freezes progress; distant rejoining has no automatic global snap. Real urban-canyon/tunnel traces remain outstanding. |
| P1 | Replayable, consented location fixtures and device validation matrix. Include browser visibility loss, clock/timer throttling, OS permission revocation and low battery. | Android Chrome and iOS Safari tested outdoors and while stopped; compare logs with ground truth, measure false off-route/arrival and transition latency before changing thresholds. |
| Phase 3 · implemented; live validation pending | Real stationary/fullscreen maps; keep the motion glyph view. | Real road tiles, route polyline, location and uncertainty circle; attribution visible, rendering remains smooth, tile failure does not stop navigation. |
| Phase 3 · implemented; live validation pending | Cycling route generation adapter plus deliberate rerouting. | Start/destination produces validated geometry and maneuvers; rate limit, timeout, no-route and provider error paths pass; rerouting claims only appear after a new route is accepted. |
| P2 | Route-session lifecycle and research data durability. | Explicit started/paused/lost/completed/ended reasons, versioned event envelope, optional sampled trace with consent, IndexedDB writes/bounded retention and visible persistence/export recovery. Preserve existing JSON log export or supply an adapter. |
| P3 | Usable stationary controls, accessible settings and route import/export UX. | Implement or visibly disable existing Reroute/Report stubs; accessible status, directional/roundabout copy, responsive layouts tested on device. No silent start without reliable positioning. |
| P3 | Offline/PWA and operational design, only after route fidelity is proven. | Cache policy honors provider licences; offline status and stale data are explicit, service-worker upgrades preserve sessions. Evaluate native background-location support only if measured browser limits prevent the required ride workflow. |

## Real map integration

Start with Leaflet in the existing stationary map container for a lightweight
raster-map/GeoJSON prototype. If vector styling, tilt or larger route datasets
become requirements, evaluate MapLibre GL JS against device/GPU budgets. Both can
be used from vanilla JavaScript; no React or application framework is needed.
Pin the selected library and manage its lifetime outside `innerHTML` updates:
create once, update its location/route layers, and resize when the card/fullscreen
changes. Never recreate the whole map on each GPS fix.

Choose a tile provider with an appropriate usage policy and visible attribution.
OpenStreetMap is a data source; the community tile service is not an unrestricted
production/offline CDN. Account for tile costs, region coverage, cache licensing,
failure behavior and public browser-token restrictions. Maintain navigation and
logging when map requests fail. Do not map “protected lane” confidence from
unknown provider metadata as if it had been field surveyed.

## Cycling routing integration

Evaluate openrouteservice cycling profiles, GraphHopper bike profiles and Valhalla
bicycle costing using representative local corridors. Compare cycleway preference,
one-way/access restrictions, surface/gradient data, turn instructions, roundabouts,
ferries and stairs. Provider availability, current contracts and costs must be
verified before selection; this PR makes no live API integration or subscription.

Use the implemented version 2 provider boundary (see architecture.md for validation) returning a neutral model:

```js
{
  schemaVersion: 2,
  id: 'route-id',
  revision: '1',
  geometry: [[longitude, latitude], /* full ordered path */],
  maneuvers: [{ geometryIndex: 42, cue: 'turn', rot: 90, instruction: 'Turn right' }],
  // Distances are recomputed from geometry by the client.
  source: { provider: 'chosen-provider', profile: 'cycling', attribution: '...' }
}
```

Keep latitude/longitude order explicit: GeoJSON uses longitude first, whereas the
recorder uses named lat/lng fields. Validate coordinates, distances and maneuver
indices before activation. Retain provider instruction/exit number separately from
the engine's semantic cue. The implemented matcher advances along geometry; maneuver
confirmation uses ordered outgoing-leg evidence. Validate provider geometry and
instruction adapters against this behavior before any real routing integration. The renderer consumes a
stable view model, not provider-specific responses.

Use a small server-side proxy only if the chosen provider requires a confidential
key or quota enforcement. Restrict request bounds, rate limits and timeouts; keep
secrets out of HTML, repository files and research logs. A provider that explicitly
supports restricted public browser keys can retain static delivery. This is a
justified incremental service boundary, not a replacement stack.

Rerouting must be an explicit state machine: off-route -> requested -> response
validated -> route accepted (new version logged), or failed/retry/rejoin. Cancel
obsolete requests and debounce GPS noise; preserve the original route and active
session until replacement is accepted. Never mark a route updated merely because
time elapsed. Freeze navigation if location confidence is insufficient to choose
a new route. Log route version/reason/provider errors without credentials.


## Phase 4 — prove real-world reliability

1. Configure a restricted Mapbox public token; verify real search, origin/destination
   snapping, route alternatives, Mapbox instruction/geometry alignment and tile
   attribution/cycling coverage on representative local corridors. Check current
   provider billing, privacy and terms before public staging or paid usage.
2. Run consenting Android Chrome/iPhone Safari field sessions and record replayable
   traces. Quantify false off-route, missed maneuvers, arrival and recovery latency.
   Tune matching only from evidence, particularly after long gaps and near crossings.
3. Add a deliberate recovery flow for rejoining beyond the matcher window, durable
   session restoration/IndexedDB and optional sampled traces with consent. Evaluate
   native background support only if measured browser limitations require it.
4. Test accessibility with real assistive technology, battery use and memory over
   multi-hour rides. Consider offline tiles only with provider licensing and a
   clear stale-map policy. Keep accounts/social/monetization out of scope.
