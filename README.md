# Kestral Model Profiles

An external Kestral reference app for reusable Chat model setups. Each profile
combines a configured model-provider profile, discovered model and variant,
generation parameters, selected Chat prompt layers, profile-specific prompt
text, and an exact tool allowlist.

Model Profiles never grants capabilities. For every Chat turn, Kestral
intersects the selected profile's allowlist with Chat's current grants. Missing
or revoked tools remain unavailable.

## Build

The minimum supported Kestral host is `0.1.0-alpha.1`, matching
`dist/app.json`. This coordinated first alpha release includes the atomic
`compareUpdateConfig` surface API used by the editor; there is no earlier
released `0.1.0-alpha.1` host contract. Promotion evidence records and tests the
exact final Kestral commit rather than treating an earlier development build
with the same provisional version as supported. Node.js is a build-only tool:
use the exact supported line `>=22.19 <23` for `npm ci`, builds, and tests. No
Node runtime or backend ships in the installable package. This alpha is
supported on Kestral's Windows x86_64 and Linux x86_64 desktop releases.

```sh
npm ci
npm audit --audit-level=high
npm run build
```

## Test

```sh
npm run check
```

`npm run check` runs the behavior and UI suites, proves two clean builds are
byte-for-byte reproducible, and verifies the canonical Kestral package digest.
CI also validates `dist/app.json` against an exact public Kestral schema
checkout at `82a983a268911e7a1958b4c6eab06dde334070b1` and refuses stale or
extra generated output.

Lifecycle evidence is generated and published separately through the manually
dispatched workflow documented in [`RELEASE-EVIDENCE.md`](RELEASE-EVIDENCE.md).
It records the exact source, canonical package digest, app identity, extension
contract, and nine manual host observations. The workflow publishes only a new
evidence release asset; it does not run Kestral or Tauri.

## Package

The deterministic build emits the installable directory in `dist/`:

```text
dist/
|-- app.json
`-- ui/
    `-- index.html
```

Install `dist/` through **Apps → Install an app**. Open **Model Profiles** to
create profiles, then choose one from the **Model profile** control beside
Chat's composer. Provider profiles, their available models and variants, Chat
prompt layers, and Chat's currently granted tools are presented as choices; the
app does not require users to copy internal IDs.

Credential-free local provider profiles can be selected directly. A cloud
provider profile that uses an API key or OAuth credential must first be selected
as **Default for Chat**. This keeps each invocation limited to Kestral's existing
broker-authorized credential alias instead of exposing another saved credential.

The app has no backend, capabilities, grants, network access, or secrets. Its
sandboxed dashboard updates only the host-owned `model-profiles` app-config
section, whose canonical value is `{ "profiles": [...] }`. The package declares
`data: { "kind": "none" }`: it owns no backend data bytes and exposes no app-data
migration command. Disable retains the host-owned configuration; uninstall
offers the host's explicit keep-or-purge choice. The immutable config fixture in
`test/fixtures/` documents the current stored shape and is checked by hash in
the package tests.

This repository ships no third-party runtime code: its only dependencies are
build/test development dependencies, and the self-contained UI has no runtime
dependency notice asset. The package tests verify the `backend: none` payload
and CI verifies the exact generated output.

Before each save or delete, the editor re-reads the host-owned library and
merges only the intended profile change. It then uses Kestral's atomic
compare-and-update config operation. Unrelated concurrent changes are merged
and retried; conflicting edits to the same profile block the write rather than
silently replacing either version.

It opts into Chat's generic `model-profile-editor` v1 contract through a manifest
extension contribution; Kestral does not recognize this app by a privileged ID.

The immutable `v0.1.1` package is the predecessor for the `0.1.2` update test.
Disable and keep-data uninstall retain host-owned profiles; purge removes them.
Historical Runs and artifacts follow Kestral's normal provenance retention.

Manuel Zierl maintains this repository. Report ordinary defects through
[GitHub Issues](https://github.com/ManuelZierl/kestral-model-profiles/issues) and
security-sensitive defects through [private vulnerability reporting](https://github.com/ManuelZierl/kestral-model-profiles/security/advisories/new).
