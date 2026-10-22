/* A single retained Leaflet map: DOM may move between preview, card and full map. */
class NavigationMap {
  constructor() {
    this.node = document.createElement("div");
    this.node.className = "live-map";
    this.notice = document.createElement("div");
    this.notice.className = "map-notice";
    this.node.append(this.notice);
    this.canvas = document.createElement("div");
    this.canvas.className = "map-canvas";
    this.node.append(this.canvas);
    if (!globalThis.L) {
      this.notice.textContent = "Install dependencies to enable the map";
      return;
    }
    this.map = L.map(this.canvas, {
      zoomControl: true,
      attributionControl: false,
    }).setView([20, 0], 2);
    this.line = L.polyline([], { color: "#3EA8FF", weight: 5 }).addTo(this.map);
    this.position = L.circleMarker([0, 0], {
      radius: 7,
      color: "#fff",
      fillColor: "#3EA8FF",
      fillOpacity: 1,
    });
    this.accuracy = L.circle([0, 0], {
      radius: 0,
      color: "#3EA8FF",
      weight: 1,
      fillOpacity: 0.1,
    });
    this.markers = L.layerGroup().addTo(this.map);
    L.control.attribution({ prefix: false }).addTo(this.map);
    this.map.on("dragstart", () => {
      this.follow = false;
    });
    this.refreshNotice();
    this.node.addEventListener("click", (e) => e.stopPropagation());
    this.follow = true;
  }
  refreshNotice() {
    this.notice.textContent = this.gpsLost
      ? "GPS signal lost; showing last reliable position"
      : this.tileFailed
        ? "Map tiles unavailable; navigation continues"
        : !this.enabled
          ? "Enable Mapbox to load streets. Route geometry works offline."
          : "";
  }
  enable(token) {
    if (!this.map) return;
    this.enabled = true;
    this.tileFailed = false;
    this.refreshNotice();
    if (this.tiles) this.tiles.remove();
    this.tiles = L.tileLayer(
      "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=" +
        encodeURIComponent(token),
      {
        maxZoom: 20,
        attribution:
          '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    ).addTo(this.map);
    this.tiles.on("tileerror", () => {
      this.tileFailed = true;
      this.refreshNotice();
    });
    this.tiles.on("loading", () => {
      this.tileFailed = false;
    });
    this.tiles.on("load", () => {
      this.refreshNotice();
    });
  }
  attach(host) {
    if (!host) return;
    host.append(this.node);
    if (this.map) requestAnimationFrame(() => this.map.invalidateSize());
  }
  showRoute(route) {
    if (!this.map) return;
    const model = RouteGeometry.compile(route);
    this.route = model;
    this.line.setLatLngs(model.geometry.map(([lng, lat]) => [lat, lng]));
    this.markers.clearLayers();
    for (const maneuver of model.maneuvers) {
      const p = model.geometry[maneuver.geometryIndex];
      L.circleMarker([p[1], p[0]], {
        radius: maneuver === model.maneuvers.at(-1) ? 8 : 4,
        color: maneuver === model.maneuvers.at(-1) ? "#FFF86A" : "#fff",
      })
        .bindTooltip(
          maneuver.cue === "arrive" ? "Destination" : "Route maneuver",
        )
        .addTo(this.markers);
    }
    this.map.fitBounds(this.line.getBounds(), {
      padding: [20, 20],
      maxZoom: 17,
    });
  }
  update(state) {
    if (!this.map || !state.lastFix) return;
    const f = state.lastFix,
      latLng = [f.lat, f.lng];
    this.position
      .setLatLng(latLng)
      .setStyle({ fillColor: state.gpsWeak ? "#888" : "#3EA8FF" })
      .addTo(this.map);
    this.accuracy.setLatLng(latLng).setRadius(f.accuracy).addTo(this.map);
    this.gpsLost = state.gpsWeak;
    this.refreshNotice();
    if (Number.isFinite(state.lastHeading) && state.lastSpeedMps >= 1) {
      if (!this.heading)
        this.heading = L.marker(latLng, {
          interactive: false,
          icon: L.divIcon({
            className: "heading-marker",
            html: "<span>▲</span>",
            iconSize: [18, 18],
            iconAnchor: [9, 20],
          }),
        });
      this.heading.setLatLng(latLng).addTo(this.map);
      this.heading.getElement().firstChild.style.transform =
        "rotate(" + state.lastHeading + "deg)";
    } else if (this.heading) this.heading.remove();
    if (this.follow) this.map.panTo(latLng, { animate: false });
  }
  recenter() {
    this.follow = true;
    if (this.position && this.map)
      this.map.setView(this.position.getLatLng(), 16);
  }
}
