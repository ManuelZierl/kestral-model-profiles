import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function fixture(t, template) {
  // Keep fixtures below the repo so the copied build resolves the pinned esbuild.
  const directory = await mkdtemp(join(root, ".build-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scripts"));
  await mkdir(join(directory, "src"));
  await cp(join(root, "scripts/build.mjs"), join(directory, "scripts/build.mjs"));
  await cp(join(root, "src/manifest.mjs"), join(directory, "src/manifest.mjs"));
  await writeFile(join(directory, "package.json"), '{"version":"0.1.1"}');
  await writeFile(join(directory, "src/index.html"), template);
  return directory;
}
const run = (directory) => spawnSync(process.execPath, [join(directory, "scripts/build.mjs")], { encoding: "utf8" });

test("build inserts script and style payloads literally without rescanning markers", async (t) => {
  const directory = await fixture(t, "<style>__STYLES__</style><script>__SCRIPT__</script>");
  const text = "$&|$`|$'|$$|__SCRIPT__|__STYLES__";
  const styles = `:root { --literal: ${JSON.stringify(text)}; }`;
  await writeFile(join(directory, "src/main.mjs"), `window.probe = ${JSON.stringify(text)};`);
  await writeFile(join(directory, "src/styles.css"), styles);
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  const html = await readFile(join(directory, "dist/ui/index.html"), "utf8");
  assert.ok(html.startsWith(`<style>${styles}</style>`));
  assert.ok(html.includes(`window.probe = ${JSON.stringify(text)};`));
});

test("a malformed HTML template fails before replacing the previous package", async (t) => {
  const directory = await fixture(t, "<style>__STYLES__</style><script>missing marker</script>");
  await writeFile(join(directory, "src/main.mjs"), "window.probe = 1;");
  await writeFile(join(directory, "src/styles.css"), "");
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/keep.txt"), "previous package");
  const result = run(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one __SCRIPT__/);
  assert.equal(await readFile(join(directory, "dist/keep.txt"), "utf8"), "previous package");
});
