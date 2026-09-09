import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { manifestFor } from "../src/manifest.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const stagedDist = join(root, "dist.next");
const previousDist = join(root, "dist.previous");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (await exists(previousDist)) {
  if (!(await exists(dist))) await rename(previousDist, dist);
}

const bundle = await build({
  entryPoints: [join(root, "src", "main.mjs")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
});
const [template, styles, packageSource] = await Promise.all([
  readFile(join(root, "src", "index.html"), "utf8"),
  readFile(join(root, "src", "styles.css"), "utf8"),
  readFile(join(root, "package.json"), "utf8"),
]);
const packageMetadata = JSON.parse(packageSource);
if (typeof packageMetadata.version !== "string" || packageMetadata.version.length === 0) {
  throw new Error("package.json must declare a non-empty version");
}
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
for (const marker of ["__STYLES__", "__SCRIPT__"]) {
  if (template.split(marker).length !== 2) throw new Error(`HTML template must contain exactly one ${marker} marker`);
}
// A callback inserts dollar sequences literally. One pass also prevents marker
// text inside a payload from being interpreted as another template slot.
const html = template.replace(/__STYLES__|__SCRIPT__/g, (marker) => marker === "__STYLES__" ? styles : script);
const digest = `sha256-${createHash("sha256").update(html).digest("hex")}`;
await rm(stagedDist, { recursive: true, force: true });
await mkdir(join(stagedDist, "ui"), { recursive: true });
await Promise.all([
  writeFile(join(stagedDist, "ui", "index.html"), html),
  writeFile(join(stagedDist, "app.json"), `${JSON.stringify(manifestFor(digest, packageMetadata.version), null, 2)}\n`),
]);

const hadPreviousDist = await exists(dist);
if (hadPreviousDist) {
  await rm(previousDist, { recursive: true, force: true });
  await rename(dist, previousDist);
}
try {
  await rename(stagedDist, dist);
} catch (error) {
  if (hadPreviousDist) {
    try {
      await rename(previousDist, dist);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], "replace dist failed and the previous package could not be restored");
    }
  }
  throw error;
}
await rm(previousDist, { recursive: true, force: true });
