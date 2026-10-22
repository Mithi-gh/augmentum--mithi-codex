/* Captured before Phase 3 UI edits. Only the deliberately replaced map region is masked. */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const { root } = require("./helpers.cjs");
const { hash, assertContract } = require("./visual-contract.cjs");
const artifactDir = path.join(root, "test-results/visual");
// Chromium 151 CI vs 154 references measured up to 1.05% raster-only change.
// Exact markup, CSS/font sources and computed visual styles are checked separately.
const MAX_RASTER_CHANGE = 0.015;
(async () => {
  const { default: pixelmatch } = await import("pixelmatch");
  const server = spawn("python3", ["tools/serve.py", "--port", "0"], {
    cwd: root,
  });
  let b;
  try {
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(root, "tests/visual/baseline/manifest.json"),
        "utf8",
      ),
    );
    for (const [file, expectedHash] of Object.entries(manifest.sources))
      assert.equal(
        hash(await fs.readFile(path.join(root, file))),
        expectedHash,
        "Approved UI source changed: " + file,
      );
    await fs.mkdir(artifactDir, { recursive: true });
    const [data] = await once(server.stdout, "data");
    const port = String(data).match(/port (\d+)/)[1];
    b = await chromium.launch({
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    });
    await fs.writeFile(
      path.join(artifactDir, "environment.json"),
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          browser: b.version(),
          referenceBrowser: manifest.browser,
          maxRasterChange: MAX_RASTER_CHANGE,
        },
        null,
        2,
      ),
    );
    console.log(
      `Visual browser ${b.version()}, reference ${manifest.browser}; exact UI contract + ${(MAX_RASTER_CHANGE * 100).toFixed(1)}% raster budget`,
    );
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
          await page.locator("#phone").screenshot({
            animations: "disabled",
            mask: [page.locator(".map")],
          }),
        );
        const expected = PNG.sync.read(
          await fs.readFile(
            path.join(root, "tests/visual/baseline", `${width}-${mode}.png`),
          ),
        );
        const name = `${width}-${mode}`;
        const diff = new PNG({ width: actual.width, height: actual.height });
        try {
          assert.equal(actual.width, expected.width);
          assert.equal(actual.height, expected.height);
          const changed =
            pixelmatch(
              actual.data,
              expected.data,
              diff.data,
              actual.width,
              actual.height,
              { threshold: 0.1 },
            ) /
            (actual.width * actual.height);
          await assertContract(page, manifest.states[name]);
          assert.ok(
            changed < MAX_RASTER_CHANGE,
            `${width}-${mode}: ${(changed * 100).toFixed(2)}% differs from approved baseline`,
          );
          console.log(
            `PASS visual ${width}-${mode}: ${(changed * 100).toFixed(3)}% changed`,
          );
        } catch (error) {
          await fs.writeFile(
            path.join(artifactDir, name + "-actual.png"),
            PNG.sync.write(actual),
          );
          await fs.writeFile(
            path.join(artifactDir, name + "-expected.png"),
            PNG.sync.write(expected),
          );
          await fs.writeFile(
            path.join(artifactDir, name + "-diff.png"),
            PNG.sync.write(diff),
          );
          await fs.writeFile(
            path.join(artifactDir, name + "-error.txt"),
            String(error.stack),
          );
          throw error;
        }
        // Negative controls prove that the raster tolerance cannot hide UI changes.
        if (width === 390 && mode === "normal") {
          const glyph = page.locator("#scr .gbox svg path").first();
          const original = await glyph.getAttribute("d");
          await glyph.evaluate((node) => node.setAttribute("d", "M0 0 L1 1"));
          await assert.rejects(
            assertContract(page, manifest.states[name]),
            /markup/,
          );
          await glyph.evaluate(
            (node, value) => node.setAttribute("d", value),
            original,
          );
          const override = await page.addStyleTag({
            content: "#phone .instr{font-size:10px !important}",
          });
          await assert.rejects(
            assertContract(page, manifest.states[name]),
            /typography/,
          );
          await override.evaluate((node) => node.remove());
          await assertContract(page, manifest.states[name]);
          console.log(
            "PASS visual negative controls: changed glyph and font size are rejected",
          );
        }
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
