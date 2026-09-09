import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageDigest } from "../scripts/package-digest.mjs";

async function fixture(t, path = "ui/index.html") {
  const root = await mkdtemp(join(tmpdir(), "profile-digest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "package");
  await mkdir(packageRoot);
  const manifest = JSON.stringify({ integrity: { algorithm: "sha256", assets: { [path]: "not-used-by-canonical-framing" } } });
  await writeFile(join(packageRoot, "app.json"), manifest);
  return { root, packageRoot, manifest };
}

test("canonical package framing remains unchanged for regular files", async (t) => {
  const { packageRoot, manifest } = await fixture(t);
  await mkdir(join(packageRoot, "ui"));
  await writeFile(join(packageRoot, "ui/index.html"), "hello");
  const hash = createHash("sha256");
  for (const [path, text] of [["app.json", manifest], ["ui/index.html", "hello"]]) {
    for (const value of [path, text]) {
      const bytes = Buffer.from(value);
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(bytes.length));
      hash.update(length).update(bytes);
    }
  }
  assert.equal(await packageDigest(packageRoot), `sha256-${hash.digest("hex")}`);
});

test("package digest rejects symlinked ancestor directories", async (t) => {
  const { root, packageRoot } = await fixture(t);
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside/index.html"), "outside package");
  await symlink(join(root, "outside"), join(packageRoot, "ui"), "junction");
  await assert.rejects(packageDigest(packageRoot), /non-regular|regular file/);
});

for (const path of ["ui//index.html", "./ui/index.html", "ui/./index.html", "ui/../ui/index.html"]) {
  test(`package digest rejects non-canonical asset path ${path}`, async (t) => {
    const { packageRoot } = await fixture(t, path);
    await mkdir(join(packageRoot, "ui"));
    await writeFile(join(packageRoot, "ui/index.html"), "hello");
    await assert.rejects(packageDigest(packageRoot), /invalid package path/);
  });
}
