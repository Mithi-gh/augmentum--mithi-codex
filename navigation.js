/* Consumer entry point. Existing engine and research harness remain independently usable. */
const element = (id) => document.getElementById(id);
const journeyMap = new NavigationMap();
journeyMap.attach(element("previewMap"));
let client = null,
  routing = null,
  origin = null,
  destination = null,
  activeChoice = null,
  paused = false,
  sessionActive = false;
let attemptedReroute = false,
  rerouting = false,
  lastRerouteAt = -Infinity,
  searchEpoch = 0;
const searches = new Map();
function status(message) {
  element("journeyStatus").textContent = message;
}
function invalidatePlan() {
  routing?.cancel();
  element("startNavigation").disabled = true;
  element("routeChoices").replaceChildren();
  activeChoice = null;
}
function cancelSearches() {
  searchEpoch++;
  for (const value of searches.values()) {
    clearTimeout(value.timer);
    value.abort.abort();
  }
  searches.clear();
}
function selectLocation(kind, result) {
  invalidatePlan();
  if (kind === "origin") origin = result.coordinate;
  else destination = result.coordinate;
  element(kind + "Search").value = result.label;
  element(kind + "Results").replaceChildren();
  if (journeyMap.map) {
    journeyMap.map.setView([result.coordinate[1], result.coordinate[0]], 14);
    L.circleMarker([result.coordinate[1], result.coordinate[0]], {
      color: "#FFF86A",
      radius: 7,
    })
      .bindTooltip(kind === "origin" ? "Start" : "Destination")
      .addTo(journeyMap.markers);
  }
}
element("connect").onclick = () => {
  try {
    if (!element("onlineConsent").checked)
      throw Error("Authorize online requests before enabling Mapbox");
    const token = element("mapToken").value.trim();
    const next = new MapboxRoutes.Client(token);
    cancelSearches();
    invalidatePlan();
    client = next;
    routing = new RoutingController(client);
    journeyMap.enable(token);
    element("mapToken").value = "";
    status("Mapbox enabled. Choose a starting point and destination.");
  } catch (e) {
    status(e.message);
  }
};
for (const kind of ["origin", "destination"])
  element(kind + "Search").addEventListener("input", () => {
    if (kind === "origin") origin = null;
    else destination = null;
    invalidatePlan();
    element(kind + "Results").replaceChildren();
    const prior = searches.get(kind);
    if (prior) {
      clearTimeout(prior.timer);
      prior.abort.abort();
    }
    const query = element(kind + "Search").value,
      epoch = searchEpoch,
      abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        if (!client) {
          status("Enable Mapbox to search");
          return;
        }
        const results = await client.search(query, abort.signal);
        if (abort.signal.aborted || epoch !== searchEpoch) return;
        const host = element(kind + "Results");
        host.replaceChildren();
        for (const result of results) {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("role", "option");
          button.textContent = result.label;
          button.onclick = () => selectLocation(kind, result);
          host.append(button);
        }
        if (!results.length && query.length >= 3)
          status("No matching places found");
      } catch (e) {
        if (e.name !== "AbortError") status(e.message);
      }
    }, 350);
    searches.set(kind, { timer, abort });
  });
element("useGps").onclick = () => {
  if (!navigator.geolocation) {
    status("Location unavailable. Search for a starting point.");
    return;
  }
  status("Requesting current location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (
        !validCoordinate(pos.coords.latitude, pos.coords.longitude) ||
        pos.coords.accuracy >= 20 ||
        Date.now() - pos.timestamp > 5000
      ) {
        status(
          "GPS accuracy is insufficient. Retry outdoors or choose a starting point.",
        );
        return;
      }
      selectLocation("origin", {
        coordinate: [pos.coords.longitude, pos.coords.latitude],
        label: "Current location",
      });
      status("Starting point set");
    },
    () =>
      status(
        "Location permission or signal unavailable. Choose a starting point manually.",
      ),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
};
element("generate").onclick = async () => {
  try {
    if (!routing) throw Error("Enable Mapbox first");
    if (!origin || !destination)
      throw Error("Choose both starting point and destination");
    status("Finding cycling routes…");
    const choices = await routing.request(origin, destination);
    if (!choices) return;
    const host = element("routeChoices");
    host.replaceChildren();
    choices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.textContent = `Route ${index + 1}: ${(choice.distance / 1000).toFixed(1)} km · ${Math.ceil(choice.duration / 60)} min`;
      button.onclick = () => {
        routing.select(index);
        journeyMap.showRoute(choice.route);
        for (const child of host.children)
          child.setAttribute("aria-pressed", String(child === button));
      };
      host.append(button);
    });
    host.firstChild.click();
    element("startNavigation").disabled = false;
    status(
      "Select a route and start when ready. Location permission is needed for navigation.",
    );
  } catch (e) {
    status(e.message);
  }
};
element("startNavigation").onclick = () => {
  try {
    if (!navigator.geolocation) throw Error("Geolocation unavailable");
    routing.accept((choice) => {
      activeChoice = choice;
      sessionActive = true;
      paused = false;
      attemptedReroute = false;
      startSession(new Date().toISOString());
      element("planner").hidden = true;
      element("previewMap").hidden = true;
      element("ride").hidden = false;
      armDeviceReliability(document.documentElement);
      startTest(choice.route);
      journeyMap.showRoute(choice.route);
      status(
        "Navigation started. Go near the route start to acquire position.",
      );
    });
  } catch (e) {
    status(e.message);
  }
};
function syncNavigationMap() {
  if (!sessionActive) return;
  const target = state.showFullMap
    ? element("fullmapview")
    : document.querySelector("#scr .map");
  if (target) {
    target.querySelector("svg.m")?.remove();
    journeyMap.attach(target);
    const expand = target.querySelector(".expand");
    if (expand)
      expand.onclick = (e) => {
        e.stopPropagation();
        tapMap();
      };
  }
  journeyMap.update(state);
}
async function requestReroute(manual = false) {
  if (!sessionActive || paused || rerouting) return;
  if (
    !state.lastFix ||
    state.gpsWeak ||
    Date.now() - state.lastFix.t > 5000 ||
    state.lastFix.accuracy > 10
  ) {
    status("Reliable current GPS is needed before rerouting");
    return;
  }
  if (Date.now() - lastRerouteAt < 15000) {
    if (manual) status("Please wait before requesting another route");
    return;
  }
  if (!manual && attemptedReroute) return;
  attemptedReroute = true;
  lastRerouteAt = Date.now();
  rerouting = true;
  const previousId = routeModel.id,
    previousRevision = routeModel.revision;
  logEvent("route_replacement_requested", "Cycling route requested");
  status("Finding a replacement cycling route…");
  try {
    const choices = await routing.request(
      [state.lastFix.lng, state.lastFix.lat],
      destination,
    );
    if (!choices || !sessionActive || paused || routeModel.id !== previousId)
      return;
    routing.select(0);
    routing.accept((choice) => {
      choice.route.revision = String((Number(previousRevision) || 0) + 1);
      RouteGeometry.compile(choice.route);
      activeChoice = choice;
      startTest(choice.route);
      journeyMap.showRoute(choice.route);
      logEvent(
        "route_replaced",
        "Replaced " + previousId + " revision " + previousRevision,
      );
      status("Replacement route activated. Acquiring route position.");
    });
  } catch (e) {
    logEvent("route_replacement_failed", e.message);
    status(
      "Rerouting failed: " +
        e.message +
        ". Rejoin safely or use Reroute to retry.",
    );
  } finally {
    rerouting = false;
  }
}
element("retryRoute").onclick = () => requestReroute(true);
function endJourney(reason = "ended") {
  routing?.cancel();
  cancelSearches();
  stopTest();
  endSession(reason);
  disarmDeviceReliability();
  sessionActive = false;
  paused = false;
  element("locationStatus").textContent = "";
  element("ride").hidden = true;
  element("planner").hidden = false;
  element("previewMap").hidden = false;
  journeyMap.attach(element("previewMap"));
  element("pauseNavigation").hidden = false;
  element("resumeNavigation").hidden = true;
  element("startNavigation").disabled = true;
  status(
    reason === "completed"
      ? "You have arrived. Session saved locally."
      : "Navigation ended. Session saved locally.",
  );
}
element("endNavigation").onclick = () => endJourney();
element("pauseNavigation").onclick = () => {
  if (!sessionActive || paused) return;
  paused = true;
  routing?.cancel();
  pauseNavigation();
  disarmDeviceReliability();
  element("pauseNavigation").hidden = true;
  element("resumeNavigation").hidden = false;
  element("eta").textContent = "Paused";
  status("Navigation paused. Resume when ready.");
};
element("resumeNavigation").onclick = () => {
  if (!sessionActive || !paused) return;
  paused = false;
  armDeviceReliability(document.documentElement);
  resumeNavigation();
  element("pauseNavigation").hidden = false;
  element("resumeNavigation").hidden = true;
  status("Resuming; reacquiring a reliable route match.");
};
element("recenter").onclick = () => journeyMap.recenter();
element("exportLog").onclick = () => downloadLog();
setEngineUpdateHandler((s) => {
  syncNavigationMap();
  if (!sessionActive) return;
  element("locationStatus").textContent = s.gpsWeak
    ? "Location unavailable. Check permissions and keep this page visible."
    : !s.routeStarted
      ? "Go near the selected route start."
      : s.matchUncertain
        ? "Matching your position to the route…"
        : "";
  if (s.finished) {
    endJourney("completed");
    return;
  }
  if (!s.offRouteActive) attemptedReroute = false;
  if (s.offRouteActive && !s.gpsWeak) requestReroute();
  const remaining = activeChoice
    ? activeChoice.duration *
      Math.max(0, 1 - s.progressAlongRoute / TOTAL_ROUTE_DIST)
    : 0;
  element("eta").textContent = paused
    ? "Paused"
    : `${Math.ceil(remaining / 60)} min estimated · ${(Math.max(0, TOTAL_ROUTE_DIST - s.progressAlongRoute) / 1000).toFixed(1)} km remaining`;
  if (logPersistenceError)
    status("Research log could not be saved; download before leaving.");
});
// These existing interactions now work without changing their visual design.
tapMap = function () {
  if (state.context === "stationary") {
    state.showFullMap = true;
    render();
  }
};
ctrlTap = function (action) {
  if (action === "Reroute") requestReroute(true);
  else status("Reporting is not available in this research build");
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && sessionActive && !paused)
    flagWeakSignal("Browser returned to foreground; reacquiring GPS");
});

window.addEventListener("offline", () =>
  status(
    "Offline. Navigation and logging continue; maps and routing need a connection.",
  ),
);
window.addEventListener("online", () =>
  status("Connection restored. Retry search or routing when ready."),
);

window.addEventListener("online", () => journeyMap.tiles?.redraw());
