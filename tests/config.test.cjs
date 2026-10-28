const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { root } = require("./helpers.cjs");
test("staging requires a public token and generates browser configuration without logging it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "augmentum-config-"));
  try {
    for (const token of ["", "sk.private", 'pk.bad\";alert(1)']) {
      const result = spawnSync(
        process.execPath,
        ["tools/configure-staging.cjs", dir],
        {
          cwd: root,
          env: { ...process.env, MAPBOX_PUBLIC_TOKEN: token },
          encoding: "utf8",
        },
      );
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(path.join(dir, "config.js")), false);
    }
    const result = spawnSync(
      process.execPath,
      ["tools/configure-staging.cjs", dir],
      {
        cwd: root,
        env: { ...process.env, MAPBOX_PUBLIC_TOKEN: "pk.fixture" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout + result.stderr, "");
    const context = { window: {} };
    vm.runInNewContext(
      fs.readFileSync(path.join(dir, "config.js"), "utf8"),
      context,
    );
    assert.equal(
      context.window.AUGMENTUM_CONFIG.mapboxPublicToken,
      "pk.fixture",
    );
    assert.equal(context.window.AUGMENTUM_CONFIG.searchBox, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
