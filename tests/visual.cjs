/* Captured before Phase 3 UI edits. Only the deliberately replaced map region is masked. */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const { root } = require("./helpers.cjs");
(async () => {
  const { default: pixelmatch } = await import("pixelmatch");
  const server = spawn("python3", ["tools/serve.py", "--port", "0"], {
    cwd: root,
  });
  let b;
  try {
    const [data] = await once(server.stdout, "data");
    const port = String(data).match(/port (\d+)/)[1];
    b = await chromium.launch({
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    });
    for (const width of [390, 1200]) {
      const page = await b.newPage({ viewport: { width, height: 1000 } });
      await page.goto(`http://127.0.0.1:${port}/test-engine.html`);
      await page.evaluate(() => {
        stopPreflightChecks();
        loadRoute([
          { lat: 0, lng: 0, cue: "continue", seg: "quiet" },
          { lat: 0, lng: 0.01, cue: "turn", rot: -90, seg: "quiet" },
          { lat: 0.01, lng: 0.01, cue: "arrive", seg: "quiet" },
        ]);
      });
      await page.evaluate(() => document.fonts.ready);
      for (const mode of [
        "normal",
        "prepare",
        "act",
        "stationary",
        "offroute",
      ]) {
        await page.evaluate((mode) => {
          Object.assign(state, {
            context: mode === "stationary" ? "stationary" : "motion",
            condition:
              mode === "offroute"
                ? "caution"
                : mode === "stationary"
                  ? "normal"
                  : mode,
            cue: "turn",
            rot: -90,
            trueDist: mode === "act" ? 10 : 400,
            currentSeg: "quiet",
            drivingFromRoute: true,
            legIndex: 0,
            distSoFar: 0,
            confidenceFiring: false,
            gpsWeak: false,
            matchUncertain: false,
            offRouteActive: mode === "offroute",
            recoveryGlyph: "offroute",
            showFullMap: false,
            finished: false,
          });
          render();
        }, mode);
        const actual = PNG.sync.read(
          await page
            .locator("#phone")
            .screenshot({
              animations: "disabled",
              mask: [page.locator(".map")],
            }),
        );
        const expected = PNG.sync.read(
          await fs.readFile(
            path.join(root, "tests/visual/baseline", `${width}-${mode}.png`),
          ),
        );
        assert.equal(actual.width, expected.width);
        assert.equal(actual.height, expected.height);
        const changed =
          pixelmatch(
            actual.data,
            expected.data,
            null,
            actual.width,
            actual.height,
            { threshold: 0.1 },
          ) /
          (actual.width * actual.height);
        assert.ok(
          changed < 0.01,
          `${width}-${mode}: ${(changed * 100).toFixed(2)}% differs from approved baseline`,
        );
        console.log(
          `PASS visual ${width}-${mode}: ${(changed * 100).toFixed(3)}% changed`,
        );
      }
      await page.close();
    }
  } finally {
    if (b) await b.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
