import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { packageDigest } from "../scripts/package-digest.mjs";
import {
  APP_ID,
  EXTENSION_CONTRIBUTIONS,
  LIFECYCLE_CHECKS,
  REPOSITORY,
  createEvidence,
  validateObservations,
  workflowUrl,
} from "../scripts/release-evidence.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function observations() {
  return {
    tested_at: "2026-08-06T12:00:00Z",
    platforms: ["windows-x86_64", "linux-x86_64"],
    lifecycle: Object.fromEntries(LIFECYCLE_CHECKS.map((check) => [check, {
      status: "passed",
      observation: `Manual host observation for ${check}.`,
    }])),
  };
}

test("derives an Actions URL only from GitHub run environment", () => {
  assert.equal(workflowUrl({
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "ManuelZierl/kestral-model-profiles",
    GITHUB_RUN_ID: "12345",
  }), `${REPOSITORY}/actions/runs/12345`);
  assert.throws(() => workflowUrl({ GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "1" }), /GITHUB_SERVER_URL/);
});

test("rejects missing, unknown, malformed, and non-passed observations", () => {
  const value = observations();
  assert.throws(() => validateObservations({ ...value, unexpected: true }), /fields differ/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, extra: { status: "passed", observation: "x" } } }), /fields differ/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, activation: { status: "failed", observation: "x" } } }), /must be 'passed'/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, restart: undefined } }), /must be an object/);
});

test("creates evidence for any declared backend kind while binding identity and contribution", async () => {
  const root = await mkdtemp(join(tmpdir(), "kestral-model-profiles-evidence-"));
  await mkdir(join(root, "dist", "ui"), { recursive: true });
  await writeFile(join(root, "dist", "ui", "index.html"), "<!doctype html>\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "kestral-model-profiles", version: "0.1.2" }));
  await writeFile(join(root, "dist", "app.json"), JSON.stringify({
    id: APP_ID,
    version: "0.1.2",
    backend: { kind: "mcp-stdio" },
    manifest: { extension_contributions: EXTENSION_CONTRIBUTIONS },
    integrity: { algorithm: "sha256", assets: { "ui/index.html": "sha256-ignored" } },
  }));
  const digest = await packageDigest(join(root, "dist"));
  const context = {
    root,
    observations: observations(),
    expectedPackageDigest: digest,
    hostVersion: "0.1.0-alpha.1",
    hostCommit: HEAD,
    env: {
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "ManuelZierl/kestral-model-profiles",
      GITHUB_RUN_ID: "12345",
      GITHUB_SHA: HEAD,
    },
    git: (args) => args[0] === "rev-parse" ? HEAD : "",
  };
  const evidence = await createEvidence(context);
  assert.deepEqual(evidence.app, { id: APP_ID, version: "0.1.2" });
  assert.equal(evidence.source.repository, REPOSITORY);
  assert.equal(evidence.package.digest, digest);
  assert.deepEqual(evidence.extension_contributions, [{
    target_app: "chat",
    extension_point: "model-profile-editor",
    contract_version: 1,
  }]);
  await assert.rejects(() => createEvidence({ ...context, expectedAppId: "com.example.other" }), /expected app ID/);
  await assert.rejects(() => createEvidence({ ...context, expectedPackageDigest: "sha256-0000000000000000000000000000000000000000000000000000000000000000" }), /package digest mismatch/);
  await assert.rejects(() => createEvidence({ ...context, env: { ...context.env, GITHUB_REPOSITORY: "ManuelZierl/other-app" } }), /source repository does not match/);
  await assert.rejects(() => createEvidence({ ...context, git: (args) => args[0] === "rev-parse" ? HEAD : " M package.json" }), /source checkout is not clean/);
});

test("rejects a changed Model Profiles extension contribution", async () => {
  const root = await mkdtemp(join(tmpdir(), "kestral-model-profiles-evidence-"));
  await mkdir(join(root, "dist", "ui"), { recursive: true });
  await writeFile(join(root, "dist", "ui", "index.html"), "<!doctype html>\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.2" }));
  await writeFile(join(root, "dist", "app.json"), JSON.stringify({
    id: APP_ID,
    version: "0.1.2",
    backend: { kind: "none" },
    manifest: { extension_contributions: [{ ...EXTENSION_CONTRIBUTIONS[0], contract_version: 2 }] },
    integrity: { algorithm: "sha256", assets: { "ui/index.html": "sha256-ignored" } },
  }));
  const digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence({
    root,
    observations: observations(),
    expectedPackageDigest: digest,
    hostVersion: "0.1.0-alpha.1",
    hostCommit: HEAD,
    env: { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "ManuelZierl/kestral-model-profiles", GITHUB_RUN_ID: "1", GITHUB_SHA: HEAD },
    git: (args) => args[0] === "rev-parse" ? HEAD : "",
  }), /extension contributions/);
});
