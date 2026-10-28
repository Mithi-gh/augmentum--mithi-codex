const fs = require("node:fs");
const path = require("node:path");
const token = (process.env.MAPBOX_PUBLIC_TOKEN || "").trim();
if (!/^pk\.[A-Za-z0-9._-]+$/.test(token)) {
  throw Error(
    "Set the MAPBOX_PUBLIC_TOKEN repository variable to a public pk. token before deploying.",
  );
}
const config = {
  mapboxPublicToken: token,
  searchBox: process.env.MAPBOX_SEARCH_BOX === "true",
  searchProximity: [73.8567, 18.5204],
};
fs.mkdirSync(process.argv[2] || "_site", { recursive: true });
fs.writeFileSync(
  path.join(process.argv[2] || "_site", "config.js"),
  "window.AUGMENTUM_CONFIG = Object.freeze(" + JSON.stringify(config) + ");\n",
);
