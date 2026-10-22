const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { root, fixture } = require("./helpers.cjs");
function environment() {
  const c = vm.createContext({
    URL,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    console,
  });
  for (const f of ["route.js", "geometry.js", "routing.js"])
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), c);
  return { c, run: (s) => vm.runInContext(s, c) };
}
function response() {
  return {
    code: "Ok",
    routes: [
      {
        duration: 120,
        geometry: {
          coordinates: [
            [0, 0],
            [0.0005, 0],
            [0.001, 0],
            [0.001, 0.001],
          ],
        },
        legs: [
          {
            steps: [
              { maneuver: { type: "depart", location: [0, 0] } },
              {
                maneuver: {
                  type: "turn",
                  modifier: "left",
                  instruction: "Turn left",
                  location: [0.001, 0],
                },
              },
              {
                maneuver: {
                  type: "arrive",
                  instruction: "Arrive",
                  location: [0.001, 0.001],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
test("Mapbox conversion derives geometry distances, ordered turns and unknown infrastructure", () => {
  const f = environment();
  f.c.data = response();
  f.run("const choice=MapboxRoutes.convert(data)[0]");
  assert.equal(f.run("choice.route.maneuvers[0].geometryIndex"), 2);
  assert.equal(f.run("choice.route.maneuvers[0].rot"), -90);
  assert.equal(f.run("choice.route.maneuvers[0].seg"), "unknown");
  assert.ok(f.run("choice.distance") > 220);
  assert.equal(f.run("choice.duration"), 120);
});
test("adapter rejects absent routes, malformed geometry, missing arrival and out-of-order maneuvers", () => {
  for (const change of [
    (r) => (r.code = "NoRoute"),
    (r) => (r.routes[0].geometry.coordinates[1] = [NaN, 0]),
    (r) => r.routes[0].legs[0].steps.pop(),
    (r) => (r.routes[0].legs[0].steps[1].maneuver.location = [1, 1]),
  ]) {
    const f = environment(),
      r = response();
    change(r);
    f.c.data = r;
    assert.throws(() => f.run("MapboxRoutes.convert(data)"));
  }
});
test("client uses cycling profile and search without putting tokens in errors", async () => {
  const f = environment();
  const urls = [];
  f.c.fetcher = async (url) => {
    urls.push(new URL(url));
    return {
      ok: true,
      text: async () =>
        JSON.stringify(
          url.includes("/directions/")
            ? response()
            : {
                features: [
                  {
                    geometry: { coordinates: [0.001, 0.001] },
                    properties: { full_address: "Destination" },
                  },
                ],
              },
        ),
    };
  };
  f.run("const client=new MapboxRoutes.Client('pk.test',{fetcher})");
  const results = await f.run("client.search('park')");
  assert.equal(results[0].label, "Destination");
  await f.run("client.routes([0,0],[.001,.001])");
  assert.match(urls[1].pathname, /mapbox\/cycling/);
  assert.equal(urls[1].searchParams.get("steps"), "true");
  assert.equal(urls[0].searchParams.get("autocomplete"), "true");
});
for (const code of [401, 403, 429, 503])
  test("provider HTTP " + code + " is truthful and redacted", async () => {
    const f = environment();
    f.c.fetcher = async () => ({ ok: false, status: code });
    f.run("const client=new MapboxRoutes.Client('pk.test',{fetcher})");
    await assert.rejects(
      f.run("client.search('park')"),
      (e) => !e.message.includes("pk.test") && /Mapbox/.test(e.message),
    );
  });
test("request timeout aborts provider without swallowing errors", async () => {
  const f = environment();
  f.c.fetcher = (_url, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      ),
    );
  f.run("const client=new MapboxRoutes.Client('pk.test',{fetcher,timeout:5})");
  await assert.rejects(f.run("client.search('park')"), /timed out/);
});
test("cancelled or superseded requests cannot activate stale routes", async () => {
  const f = environment();
  f.c.data = response();
  f.run("const choices=MapboxRoutes.convert(data)");
  let resolve;
  f.c.provider = { routes: () => new Promise((r) => (resolve = r)) };
  f.run("const controller=new RoutingController(provider)");
  const pending = f.run("controller.request([0,0],[.001,.001])");
  f.run("controller.cancel()");
  resolve(f.run("choices"));
  assert.equal(await pending, null);
  assert.throws(() => f.run("controller.accept(()=>{})"));
});
test("replacement is only accepted after validation, activation failure retains pending route", async () => {
  const f = environment();
  f.c.data = response();
  f.run("const choices=MapboxRoutes.convert(data)");
  f.c.provider = { routes: async () => f.run("choices") };
  f.run("const controller=new RoutingController(provider)");
  await f.run("controller.request([0,0],[.001,.001])");
  assert.throws(() =>
    f.run("controller.accept(()=>{throw Error('activation failed')})"),
  );
  assert.equal(f.run("controller.status"), "preview");
  f.run("controller.accept(()=>{})");
  assert.equal(f.run("controller.status"), "accepted");
});
test("failed request does not offer previous route as a replacement", async () => {
  const f = environment();
  let fail = false;
  f.c.data = response();
  f.run("const choices=MapboxRoutes.convert(data)");
  f.c.provider = {
    routes: async () => {
      if (fail) throw Error("Offline");
      return f.run("choices");
    },
  };
  f.run("const controller=new RoutingController(provider)");
  await f.run("controller.request([0,0],[.001,.001])");
  fail = true;
  await assert.rejects(
    f.run("controller.request([0,0],[.001,.001])"),
    /Offline/,
  );
  assert.equal(f.run("controller.status"), "failed");
  assert.throws(() => f.run("controller.select(0)"));
});
test("pause stops queued GPS and resume retains route and research session", () => {
  const f = fixture();
  f.start();
  f.fix(0);
  f.fix(10);
  const label = f.run("sessionLabel"),
    old = [...f.watches.values()][0];
  f.run("pauseNavigation()");
  old.ok({
    coords: { latitude: 0, longitude: 0.001, accuracy: 5 },
    timestamp: f.now() + 1000,
  });
  assert.equal(f.state().lastFix.lng, 10 / 111320);
  f.run("resumeNavigation()");
  assert.equal(f.watches.size, 1);
  assert.equal(f.run("sessionLabel"), label);
  assert.ok(f.events().some((e) => e.event_type === "session_paused"));
  assert.ok(f.events().some((e) => e.event_type === "session_resumed"));
});
module.exports = { response };

test("local search biases addresses and uses a shared suggest/retrieve session for places", async () => {
  const f = environment();
  const urls = [];
  f.c.fetcher = async (url) => {
    urls.push(new URL(url));
    return {
      ok: true,
      text: async () =>
        JSON.stringify(
          url.includes("/suggest")
            ? {
                suggestions: [
                  {
                    mapbox_id: "poi/example",
                    name: "Local café",
                    place_formatted: "Town",
                  },
                ],
              }
            : {
                features: [
                  {
                    geometry: { coordinates: [77.1, 12.9] },
                    properties: { full_address: "Address" },
                  },
                ],
              },
        ),
    };
  };
  f.run("const client=new MapboxRoutes.Client('pk.fixture',{fetcher})");
  const results = await f.run(
    "client.search('café',undefined,{proximity:[77.1,12.9],language:'en',sessionToken:'session-1'})",
  );
  f.c.result = results[0];
  const resolved = await f.run("client.retrieve(result)");
  assert.equal(resolved.coordinate[0], 77.1);
  assert.equal(urls[0].searchParams.get("proximity"), "77.1,12.9");
  assert.equal(urls[0].searchParams.get("limit"), "10");
  assert.equal(urls[0].searchParams.get("language"), "en");
  assert.equal(
    urls[1].searchParams.get("session_token"),
    urls[0].searchParams.get("session_token"),
  );
  assert.match(urls[1].pathname, /poi%2Fexample/);
  await f.run("client.search('address',undefined,{proximity:[77.1,12.9]})");
  assert.match(urls[2].pathname, /geocode/);
  await assert.rejects(
    f.run("client.search('park',undefined,{proximity:[999,0]})"),
    /Invalid location/,
  );
});
