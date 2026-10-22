/* Provider adapter and request lifecycle; no UI, GPS, credentials storage or paid calls on load. */
const MapboxRoutes = (() => {
  function point(p) {
    if (!Array.isArray(p) || p.length !== 2 || !validCoordinate(p[1], p[0]))
      throw Error("Invalid location");
    return p;
  }
  function convert(response, { id = "mapbox-route", revision = "1" } = {}) {
    if (
      response.code !== "Ok" ||
      !Array.isArray(response.routes) ||
      !response.routes.length
    )
      throw Error("No cycling route found");
    return response.routes.map((r, routeIndex) => {
      if (!Array.isArray(r.geometry?.coordinates))
        throw Error("Missing route geometry");
      const geometry = [];
      for (const p of r.geometry.coordinates) {
        point(p);
        if (
          !geometry.length ||
          RouteGeometry.distance(p, geometry.at(-1)) >= 0.1
        )
          geometry.push([...p]);
      }
      if (!Number.isFinite(r.duration) || r.duration < 0)
        throw Error("Invalid route duration");
      const steps = r.legs?.flatMap((l) => l.steps ?? []);
      if (!steps?.length) throw Error("Missing route instructions");
      const maneuvers = [];
      let previous = 0;
      for (const step of steps) {
        const m = step.maneuver;
        if (!m) throw Error("Missing maneuver");
        point(m.location);
        if (m.type === "depart") continue;
        let index =
          m.type === "arrive"
            ? geometry.length - 1
            : geometry.findIndex(
                (p, i) =>
                  i >= previous && RouteGeometry.distance(p, m.location) < 2,
              );
        if (index < 0) throw Error("Maneuver is not on the route geometry");
        if (index === previous) continue;
        previous = index;
        const modifier = m.modifier ?? "",
          right = modifier.includes("right"),
          left = modifier.includes("left");
        const cue =
          m.type === "arrive"
            ? "arrive"
            : modifier === "uturn"
              ? "reverse"
              : m.type.includes("roundabout") || m.type === "rotary"
                ? "roundabout"
                : m.type === "fork"
                  ? "fork"
                  : m.type === "merge"
                    ? "merge"
                    : m.type === "off ramp"
                      ? "exit"
                      : modifier.includes("sharp")
                        ? "sharp"
                        : modifier.includes("slight")
                          ? "bear"
                          : right || left
                            ? "turn"
                            : "continue";
        const rotation = right
          ? Math.abs(ROUTE_ROTATIONS[cue])
          : left
            ? -Math.abs(ROUTE_ROTATIONS[cue])
            : ROUTE_ROTATIONS[cue];
        maneuvers.push({
          geometryIndex: index,
          cue,
          rot: rotation,
          seg: "unknown",
          instruction: m.instruction ?? "",
          exitNumber: cue === "roundabout" ? (m.exit ?? null) : null,
        });
      }
      if (maneuvers.at(-1)?.cue !== "arrive")
        throw Error("Missing final arrival instruction");
      const route = normalizeRoute({
        schemaVersion: 2,
        id: id + "-" + routeIndex,
        revision,
        geometry,
        maneuvers,
        source: {
          provider: "Mapbox",
          profile: "cycling",
          attribution: "© Mapbox © OpenStreetMap",
        },
      });
      return {
        route,
        duration: r.duration,
        distance: RouteGeometry.compile(route).length,
      };
    });
  }
  class Client {
    constructor(
      token,
      {
        fetcher = (...args) => globalThis.fetch(...args),
        timeout = 10000,
      } = {},
    ) {
      if (!token?.startsWith("pk."))
        throw Error("Use a restricted public Mapbox token (pk.)");
      this.token = token;
      this.fetcher = fetcher;
      this.timeout = timeout;
    }
    async request(path, parameters, signal) {
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeout);
      try {
        const url = new URL("https://api.mapbox.com" + path);
        for (const [k, v] of Object.entries({
          ...parameters,
          access_token: this.token,
        }))
          url.searchParams.set(k, v);
        const response = await this.fetcher(url.toString(), {
          signal: controller.signal,
          referrerPolicy: "strict-origin-when-cross-origin",
        });
        if (!response.ok)
          throw Error(
            response.status === 429
              ? "Mapbox rate limit reached; retry later"
              : response.status === 401 || response.status === 403
                ? "Mapbox token or URL restriction rejected"
                : "Mapbox service unavailable",
          );
        const body = await response.text();
        if (body.length > 5000000) throw Error("Provider response too large");
        return JSON.parse(body);
      } catch (e) {
        if (timedOut) throw Error("Mapbox request timed out");
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        if (e instanceof SyntaxError) throw Error("Invalid Mapbox response");
        if (e instanceof TypeError)
          throw Error("Network unavailable; check connection");
        throw e;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
    async search(query, signal) {
      if (query.trim().length < 3) return [];
      const data = await this.request(
        "/search/geocode/v6/forward",
        { q: query.trim(), autocomplete: "true", limit: 5 },
        signal,
      );
      if (!Array.isArray(data.features)) throw Error("Invalid search response");
      return data.features.map((f) => ({
        coordinate: point(f.geometry?.coordinates),
        label:
          f.properties?.full_address ?? f.properties?.name ?? "Selected place",
      }));
    }
    async routes(origin, destination, signal) {
      point(origin);
      point(destination);
      if (RouteGeometry.distance(origin, destination) < 10)
        throw Error("Choose a destination at least 10m away");
      const data = await this.request(
        "/directions/v5/mapbox/cycling/" +
          origin.join(",") +
          ";" +
          destination.join(","),
        {
          geometries: "geojson",
          overview: "full",
          steps: "true",
          alternatives: "true",
        },
        signal,
      );
      const choices = convert(data, { id: "mapbox-" + Date.now() });
      for (const choice of choices) {
        if (
          RouteGeometry.distance(choice.route.geometry[0], origin) > 100 ||
          RouteGeometry.distance(choice.route.geometry.at(-1), destination) >
            100
        )
          throw Error(
            "Provider endpoints are too far from the selected locations",
          );
      }
      return choices;
    }
  }
  return { Client, convert, point };
})();
class RoutingController {
  constructor(provider, onChange = () => {}) {
    this.provider = provider;
    this.onChange = onChange;
    this.status = "idle";
    this.generation = 0;
    this.pending = null;
    this.choices = [];
  }
  emit(status) {
    this.status = status;
    this.onChange(status);
  }
  cancel() {
    this.generation++;
    this.abort?.abort();
    this.pending = null;
    this.choices = [];
    this.emit("idle");
  }
  async request(origin, destination) {
    this.cancel();
    const generation = this.generation,
      abort = (this.abort = new AbortController());
    this.emit("requesting");
    try {
      const choices = await this.provider.routes(
        origin,
        destination,
        abort.signal,
      );
      if (generation !== this.generation) return null;
      if (!Array.isArray(choices) || !choices.length)
        throw Error("No cycling route found");
      for (const choice of choices) RouteGeometry.compile(choice.route);
      this.choices = choices;
      this.pending = choices[0];
      this.emit("preview");
      return choices;
    } catch (e) {
      if (generation !== this.generation) return null;
      this.pending = null;
      this.emit("failed");
      throw e;
    }
  }
  select(index) {
    if (!this.choices[index]) throw Error("Select a valid route");
    this.pending = this.choices[index];
    return this.pending;
  }
  accept(activate) {
    if (!this.pending || this.status !== "preview")
      throw Error("No validated route to accept");
    const selected = this.pending;
    activate(selected);
    this.pending = null;
    this.emit("accepted");
    return selected;
  }
}
