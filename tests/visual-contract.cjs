const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const hash = (value) => createHash("sha256").update(value).digest("hex");
// Properties are CSS declarations, not font rasterization or animation phase.
function readStyles() {
  return Object.fromEntries(
    [".scr", ".instr", ".ctx", ".gbox", ".actcard", ".metcard", ".barwrap"].map(
      (selector) => {
        const node = document.querySelector("#phone " + selector),
          css = node && getComputedStyle(node);
        return [
          selector,
          css
            ? Object.fromEntries(
                [
                  "color",
                  "fontFamily",
                  "fontSize",
                  "fontWeight",
                  "letterSpacing",
                  "lineHeight",
                  "padding",
                  "margin",
                  "borderRadius",
                ].map((key) => [key, css[key]]),
              )
            : null,
        ];
      },
    ),
  );
}
async function assertContract(page, reference) {
  assert.equal(
    hash(await page.locator("#phone").innerHTML()),
    reference.markupHash,
    "Approved navigation markup/glyphs/copy changed",
  );
  assert.deepEqual(
    await page.evaluate(readStyles),
    reference.styles,
    "Approved typography, colors or spacing changed",
  );
}
module.exports = { hash, assertContract };
