import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { profilesFromConfig } from "../src/profile-model.mjs";
import { packageDigest } from "../scripts/package-digest.mjs";

const dist = new URL("../dist/", import.meta.url);
const canonicalConfigFixture = new URL("fixtures/model-profiles-host-config.json", import.meta.url);
const malformedConfigFixture = new URL("fixtures/model-profiles-host-config-malformed.json", import.meta.url);

test("built package follows the Kestral package contract", async () => {
  const [app, packageMetadata] = await Promise.all([
    readFile(new URL("app.json", dist), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const html = await readFile(new URL("ui/index.html", dist), "utf8");
  assert.equal(app.format_version, 1);
  assert.equal(app.id, "com.ma-zierl.kestral-model-profiles");
  assert.equal(app.version, packageMetadata.version);
  assert.deepEqual(packageMetadata.dependencies ?? {}, {});
  assert.equal(app.backend.kind, "none");
  assert.deepEqual(app.data, { kind: "none" });
  assert.deepEqual(app.manifest.capabilities, []);
  assert.deepEqual(app.manifest.grant_requests, []);
  assert.equal(app.manifest.config_declarations[0].name, "model-profiles");
  assert.deepEqual(app.manifest.extension_contributions, [{
    target_app: "chat",
    extension_point: "model-profile-editor",
    contract_version: 1,
    surface: "model-profiles",
  }]);
  assert.equal(app.integrity.assets["ui/index.html"], `sha256-${createHash("sha256").update(html).digest("hex")}`);
  assert.deepEqual((await readdir(dist)).sort(), ["app.json", "ui"]);
  assert.deepEqual(await readdir(new URL("ui/", dist)), ["index.html"]);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test("package digest uses Kestral's canonical package framing", async () => {
  assert.equal(
    await packageDigest(dist),
    "sha256-f06c6e032200b0bac3139de7d76309d91e6014324fe8c9908df72d63bce243b8",
  );
});

test("checked host-config fixtures preserve the current app-owned shape", async () => {
  const canonicalBytes = await readFile(canonicalConfigFixture);
  assert.equal(
    `sha256-${createHash("sha256").update(canonicalBytes).digest("hex")}`,
    "sha256-2a05bd9474431fd48a8a36f68c60aea2ec9630641cde5c5e1992a32aee53db66",
  );
  const canonical = JSON.parse(canonicalBytes);
  assert.deepEqual(Object.keys(canonical), ["profiles"]);
  assert.equal(canonical.profiles.length, 2);
  assert.equal(profilesFromConfig(canonical).length, 2);
  assert.equal(canonical.profiles[0].prompt.layer_ids[0], "assistant-instructions");
  assert.equal(canonical.profiles[1].tools.length, 0);

  const malformedBytes = await readFile(malformedConfigFixture);
  assert.equal(
    `sha256-${createHash("sha256").update(malformedBytes).digest("hex")}`,
    "sha256-85ec89ea95f53efb39ce6547a1dee6fb26def20dfdcda2f12301fa098b8d9047",
  );
  assert.throws(() => JSON.parse(malformedBytes), /Expected ','|Unexpected end|Unexpected token/);
});

test("declared config schema rejects non-canonical surrounding whitespace", async () => {
  const app = JSON.parse(await readFile(new URL("app.json", dist), "utf8"));
  const profile = app.manifest.config_declarations[0].json_schema.properties.profiles.items;
  assert.equal(new RegExp(profile.properties.title.pattern).test(" Focused work "), false);
  assert.equal(new RegExp(profile.properties.description.pattern).test(""), true);
  assert.equal(new RegExp(profile.properties.prompt.properties.custom_texts.items.pattern).test(" padded "), false);
});

test("surface is responsive, theme-native, and honest about authority", async () => {
  const [html, source, styles] = await Promise.all([
    readFile(new URL("ui/index.html", dist), "utf8"),
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /name="viewport"/);
  assert.match(styles, /minmax\(min\(100%,/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?:color|background(?:-color)?|border-color)\s*:\s*(?:white|black|gray|red|blue)\b/i);
  assert.match(source, /Profiles can only reduce access/);
  assert.match(source, /never grants a tool/);
  assert.match(source, /kebabCase\(state\.draft\.title\)/);
  assert.match(source, /type="checkbox" name="tools"/);
  assert.match(source, /name="connector_id" required/);
  assert.match(source, /name="model" required/);
  assert.match(source, /Profile-specific text/);
  assert.match(source, /role="status"/);
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
});
