import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { packageDigest } from "../scripts/package-digest.mjs";

async function packageChecksums() {
  const checksums = {};
  for (const path of ["app.json", "ui/index.html"]) {
    const content = await readFile(new URL(`../dist/${path}`, import.meta.url));
    checksums[path] = createHash("sha256").update(content).digest("hex");
  }
  return checksums;
}

function buildPackage() {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const checkedIn = await packageChecksums();
buildPackage();
const first = await packageChecksums();
assert.deepEqual(first, checkedIn, "checked-in dist must match a clean build");
const firstPackageDigest = await packageDigest(new URL("../dist/", import.meta.url));
buildPackage();
assert.deepEqual(await packageChecksums(), first, "two clean builds must produce identical package checksums");
assert.equal(await packageDigest(new URL("../dist/", import.meta.url)), firstPackageDigest, "two clean builds must produce the same Kestral package digest");
console.log(`Reproducible package checksums: ${JSON.stringify(first)} (${firstPackageDigest})`);
