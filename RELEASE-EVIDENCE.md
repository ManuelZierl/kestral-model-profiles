# Lifecycle Evidence

This repository publishes the format-1 evidence document required for a
promoted external Kestral app. It is generated only after a real manual host
run. The workflow validates the recorded observations and package provenance;
it does not run Kestral or Tauri. Dispatch requires the exact app
`source_commit` and an explicit `tauri_tested: true` manual attestation.

## Two-Commit Boundary

Use the clean Model Profiles source commit that produced `dist/` as the
evidence source commit. The Kestral release record is filled in by a later
metadata-only core commit, so the core commit tested is not changed to record
its own hash or evidence URL. Do not combine those two core commits.

## Manual Observations

Before dispatching **Release evidence**, run all checks against the exact
package, lowercase 40-hex app `source_commit`, and exact Kestral host commit
named in the dispatch inputs. Set `tauri_tested` to `true` after the real Tauri
run. Supply this exact JSON shape. Every check is required, must have
`status: "passed"`, and must describe the retained observation rather than
merely saying that a step was attempted.

```json
{
  "tested_at": "2026-08-06T12:00:00Z",
  "platforms": ["windows-x86_64", "linux-x86_64"],
  "lifecycle": {
    "package_inspection": { "status": "passed", "observation": "..." },
    "permission_denial": { "status": "passed", "observation": "..." },
    "activation": { "status": "passed", "observation": "..." },
    "representative_action": { "status": "passed", "observation": "..." },
    "restart": { "status": "passed", "observation": "..." },
    "update_data_preservation": { "status": "passed", "observation": "..." },
    "disable_enable": { "status": "passed", "observation": "..." },
    "keep_data_uninstall": { "status": "passed", "observation": "..." },
    "purge_data_uninstall": { "status": "passed", "observation": "..." }
  }
}
```

The checks must cover these Model Profiles cases:

1. Inspect `dist/` without executing package code. Confirm the exact app ID,
   `model-profile-editor` v1 contribution, `model-profiles` config declaration,
   and the package's declared backend/data behavior.
2. Exercise the host permission-denial path where it is available. For this
   package, no permission prompt is expected: record that no capabilities or
   grant requests were declared, so the denial case is a no-op and Model
   Profiles cannot turn a profile tool list into a grant.
3. Activate the app and open **Model Profiles**. Record the empty first-run
   config `{ "profiles": [] }` as an observed no-op before saving anything.
4. Create a profile and save it through the atomic `compareUpdateConfig` bridge
   operation, select it beside Chat's composer, and verify that the host stores
   the canonical `model-profiles` value. Confirm a profile only reduces Chat's
   currently granted tools; it never grants one. This successful save must use
   the exact host commit recorded in the evidence.
5. Restart Kestral. Confirm the saved profile, discovered provider/model
   choices, and Chat selection are restored from host-owned config.
6. Update to the exact package under test. Confirm the host-owned config is
   preserved. The package declares no app-data migration command, so the app
   migration portion is an explicit no-op; the retained config is the observed
   result.
7. Disable and re-enable the app. While disabled, confirm its dashboard and
   extension are unavailable and no capability authority exists; after
   re-enable, confirm the prior config is still readable.
8. Uninstall with **Keep data**, reinstall the exact package, and confirm the
   saved `model-profiles` config is retained. Package `data: { "kind": "none" }`
   means there are no backend data bytes to preserve; the host config is the
   retained app data being observed.
9. Uninstall with **Purge data**, then inspect the host config and secret store.
   Confirm the `model-profiles` entry is absent and no Model Profiles secrets
   remain. This is an observed purge, while the package's declared backend/data
   and secret behavior are otherwise no-op cases.

The input rejects unknown fields, missing checks, duplicate platforms, malformed
timestamps, failed statuses, and empty observations. `workflow_url` is derived
from the GitHub Actions environment and is not accepted as manual input.

## Dispatch Gates

The workflow checks out Kestral's public package schema at pinned commit
`82a983a268911e7a1958b4c6eab06dde334070b1` into `.kestral-contract`. It runs
the existing app checks, verifies the clean checked-out source HEAD, exact app
identity, exact Model Profiles extension contribution, canonical package digest,
and generated evidence shape. It intentionally does not start Tauri or claim
to execute host tests.

Dispatch with a new `release_tag` matching the workflow's conservative syntax.
The tag must not already exist as either a GitHub release or remote
`refs/tags/<tag>`. Publication creates a new GitHub release containing only the
evidence JSON; it never overwrites an existing release or publishes the
installable app package. Start the dispatch from a ref whose `GITHUB_SHA`
matches `source_commit`; a mismatch is rejected.
