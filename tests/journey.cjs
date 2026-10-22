const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { root } = require("./helpers.cjs");
const response = (origin = [0, 0], destination = [0.001, 0.001]) => ({
  code: "Ok",
  routes: [
    {
      duration: 120,
      geometry: { coordinates: [origin, [0.001, origin[1]], destination] },
      legs: [
        {
          steps: [
            { maneuver: { type: "depart", location: origin } },
            {
              maneuver: {
                type: "turn",
                modifier: "left",
                instruction: "Turn left",
                location: [0.001, origin[1]],
              },
            },
            {
              maneuver: {
                type: "arrive",
                instruction: "Arrive",
                location: destination,
              },
            },
          ],
        },
      ],
    },
  ],
});
(async () => {
  const server = spawn("python3", ["tools/serve.py", "--port", "0"], {
    cwd: root,
  });
  let browser;
  try {
    const [data] = await once(server.stdout, "data");
    const port = String(data).match(/port (\d+)/)[1];
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      headless: true,
    });
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1200, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      let directions = 0,
        failRoute = false,
        failTiles = false;
      await context.route("https://api.mapbox.com/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("/tiles/") && failTiles)
          return route.fulfill({ status: 503, body: "Offline" });
        if (url.pathname.includes("/tiles/"))
          return route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfasAAAAASUVORK5CYII=",
              "base64",
            ),
          });
        if (url.pathname.includes("/geocode/"))
          return route.fulfill({
            json: {
              features: [
                {
                  properties: {
                    full_address:
                      url.searchParams.get("q") === "start"
                        ? "Starting place"
                        : "Destination place",
                  },
                  geometry: {
                    coordinates:
                      url.searchParams.get("q") === "start"
                        ? [0, 0]
                        : [0.001, 0.001],
                  },
                },
              ],
            },
          });
        directions++;
        if (failRoute)
          return route.fulfill({
            status: 429,
            json: { message: "Rate limit" },
          });
        const coords = url.pathname
          .split("/")
          .at(-1)
          .split(";")
          .map((p) => p.split(",").map(Number));
        const data = response(...coords);
        data.routes.push({ ...data.routes[0], duration: 150 });
        return route.fulfill({ json: data });
      });
      await context.addInitScript(() => {
        const watchers = new Map();
        let id = 0,
          coords = { latitude: 0, longitude: 0, accuracy: 5, speed: 5 };
        navigator.geolocation.watchPosition = (ok, error) => {
          const key = ++id;
          watchers.set(key, { ok, error });
          queueMicrotask(() =>
            watchers.get(key)?.ok({ timestamp: Date.now(), coords }),
          );
          return key;
        };
        navigator.geolocation.clearWatch = (key) => watchers.delete(key);
        navigator.geolocation.getCurrentPosition = (ok) =>
          ok({ timestamp: Date.now(), coords });
        window.gps = (x, y = 0, accuracy = 5, speed = 5) => {
          coords = {
            longitude: x / 111320,
            latitude: y / 111320,
            accuracy,
            speed,
          };
          for (const w of [...watchers.values()])
            w.ok({ timestamp: Date.now(), coords });
        };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error("Page error:", e.message);
      });
      await page.clock.install();
      await page.goto(`http://127.0.0.1:${port}/navigate.html`);
      await page.locator("summary").click();
      await page.locator("#mapToken").fill("pk.fixture-not-real");
      await page.locator("#onlineConsent").check();
      await page.locator("#connect").click();
      assert.match(
        await page.locator("#journeyStatus").textContent(),
        /Mapbox enabled/,
      );
      for (const [kind, query, label] of [
        ["origin", "start", "Starting place"],
        ["destination", "park", "Destination place"],
      ]) {
        await page.locator("#" + kind + "Search").fill(query);
        await page.clock.runFor(400);
        await page
          .getByRole("option", { name: label })
          .click()
          .catch(async (e) => {
            console.error(
              "Search state:",
              await page.locator("#journeyStatus").textContent(),
            );
            throw e;
          });
      }
      await page.locator("#generate").click();
      await page.locator("#routeChoices button").first().waitFor();
      assert.equal(directions, 1);
      assert.equal(await page.locator("#routeChoices button").count(), 2);
      await page.locator("#routeChoices button").nth(1).click();
      await page.locator("#routeChoices button").nth(0).click();
      await page.locator("#startNavigation").click();
      const gps = async (x, y = 0, accuracy = 5, speed = 5) => {
        await page.clock.runFor(1000);
        await page.evaluate((p) => window.gps(...p), [x, y, accuracy, speed]);
      };
      await gps(0, 0, 5, 0);
      await gps(0, 0, 5, 0);
      await gps(0, 0, 5, 0);
      assert.equal(await page.evaluate(() => state.context), "stationary");
      assert.equal(await page.locator("#scr .live-map").count(), 1);
      const mapId = await page.evaluate(() => journeyMap.map._leaflet_id);
      await page.locator("#scr .expand").click();
      assert.equal(await page.locator("#fullmapview .live-map").count(), 1);
      await page.locator(".fmback").click();
      failTiles = true;
      await page.evaluate(() => journeyMap.map.setZoom(18));
      await page.waitForFunction(() => journeyMap.tileFailed);
      assert.match(
        await page.locator(".map-notice").textContent(),
        /Map tiles unavailable/,
      );
      failTiles = false;
      await page.locator("#recenter").click();
      await page.locator("#pauseNavigation").click();
      const pausedProgress = await page.evaluate(
        () => state.progressAlongRoute,
      );
      await gps(20);
      assert.equal(
        await page.evaluate(() => state.progressAlongRoute),
        pausedProgress,
      );
      await page.locator("#resumeNavigation").click();
      for (let i = 0; i < 3; i++) await gps(0);
      for (const x of [20, 40, 60, 80, 100]) await gps(x);
      await gps(111, 20);
      await page.clock.runFor(1400);
      assert.equal(await page.evaluate(() => state.legIndex), 1);
      // Lose signal, then reacquire locally. No paid API calls are made by these fixtures.
      await gps(111, 25, 50);
      await gps(111, 25);
      await gps(111, 26);
      await gps(111, 27);
      failRoute = true;
      for (const x of [130, 150, 170, 190]) await gps(x, 30);
      await page.waitForFunction(() =>
        document
          .querySelector("#journeyStatus")
          .textContent.includes("Rerouting failed"),
      );
      assert.equal(directions, 2);
      const oldId = await page.evaluate(() => routeModel.id);
      await page.clock.runFor(16000);
      failRoute = false;
      await gps(190, 30);
      await page.locator("#retryRoute").click();
      await page.waitForFunction(
        (previous) => routeModel.id !== previous,
        oldId,
      );
      assert.equal(directions, 3);
      assert.ok(
        await page.evaluate(() =>
          getLogRecords().some((r) => r.event_type === "route_replaced"),
        ),
      );
      assert.equal(
        await page.evaluate(() => journeyMap.map._leaflet_id),
        mapId,
      );
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      assert.match(
        await page.locator("#journeyStatus").textContent(),
        /Offline/,
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      assert.match(
        await page.locator("#journeyStatus").textContent(),
        /restored/,
      );
      for (const x of [170, 150, 130, 111]) await gps(x, 30);
      await gps(111, 50);
      await page.clock.runFor(1400);
      for (const y of [70, 90, 108, 111.32]) await gps(111.32, y);
      await gps(111.32, 111.32, 5, 0);
      await page.clock.runFor(1400);
      await page.waitForFunction(() =>
        document
          .querySelector("#journeyStatus")
          .textContent.includes("arrived"),
      );
      assert.ok(
        await page.evaluate(() =>
          getLogRecords().some((r) => r.event_type === "route_completed"),
        ),
      );
      // A fresh plan can also be ended explicitly before riding.
      await page.locator("#generate").click();
      await page.locator("#startNavigation").waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !document.querySelector("#startNavigation").disabled,
      );
      await page.locator("#startNavigation").click();
      await page.locator("#endNavigation").click();
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.equal(await page.evaluate(() => tracking), false);
      assert.equal(
        await page.evaluate(() => rideDeviceReliabilityActive),
        false,
      );
      assert.equal(
        (
          await page.request.get(`http://127.0.0.1:${port}/.git/config`)
        ).status(),
        403,
      );
      assert.deepEqual(errors, []);
      if (mobile)
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      console.log(
        `PASS journey ${mobile ? "mobile" : "desktop"}: search, routes, retained map, GPS, pause/resume, failed and accepted reroute, network status, end`,
      );
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
