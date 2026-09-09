import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";

async function edit(path, replacements) {
  let source = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length, 2, `expected exactly one anchor in ${path}: ${before.slice(0, 100)}`);
    source = source.replace(before, () => after);
  }
  await writeFile(path, source);
}

await cp(".review-work/profile-merge.mjs", "src/profile-merge.mjs");
await cp(".review-work/profile-merge.test.mjs", "test/profile-merge.test.mjs");
await cp(".review-work/package-digest.mjs", "scripts/package-digest.mjs");
await edit("src/main.mjs", [
  ['const root = document.querySelector("#app");', 'import { mergeProfileChange } from "./profile-merge.mjs";\n\nconst root = document.querySelector("#app");'],
  ['value="${draft.temperature ?? ""}"', 'value="${escapeHtml(draft.temperature ?? "")}"'],
  ['value="${draft.max_output_tokens ?? ""}"', 'value="${escapeHtml(draft.max_output_tokens ?? "")}"'],
  ['  if (keepEmptyCustomTexts) draft.prompt.custom_texts = values.custom_texts;', `  if (keepEmptyCustomTexts) {
    // Keep in-progress text verbatim across unrelated UI transitions; normalize
    // only on submit. Numeric draft values can be strings until that boundary.
    for (const field of ["id", "title", "description", "connector_id", "model", "temperature", "max_output_tokens"]) {
      draft[field] = values[field];
    }
    draft.prompt.custom_texts = values.custom_texts;
  }`],
  ['async function persist(nextProfiles, success) {', 'async function persist(nextProfiles, success, changedId) {'],
  ['    await window.appHost.updateConfig({ profiles: nextProfiles });\n    state.profiles = nextProfiles;', `    const current = profilesFromConfig(await window.appHost.getConfig());
    const merged = mergeProfileChange(state.profiles, nextProfiles, current, changedId);
    await window.appHost.updateConfig({ profiles: merged });
    state.profiles = merged;`],
  ['    state.errors = validateProfile(state.draft, state.profiles, state.originalId);', `    const invalidNumbers = [...form.querySelectorAll('input[type="number"]')]
      .filter((input) => input.validity.badInput)
      .map((input) => \`Enter a valid number for \${input.name === "temperature" ? "temperature" : "maximum output tokens"}.\`);
    state.errors = [...invalidNumbers, ...validateProfile(state.draft, state.profiles, state.originalId)];`],
  ['const saved = await persist(next, `Saved ${state.draft.title}.`);', 'const saved = await persist(next, `Saved ${state.draft.title}.`, state.draft.id);'],
  ['    state.deleteConfirmation = button.dataset.delete;', '    state.draft = readDraft(form, true);\n    state.deleteConfirmation = button.dataset.delete;'],
  ['    const id = state.deleteConfirmation;', '    state.draft = readDraft(form, true);\n    const id = state.deleteConfirmation;'],
  ['    const deleted = await persist(next, `Deleted ${profile.title}.`);', '    state.draft = readDraft(form, true);\n    const deleted = await persist(next, `Deleted ${profile.title}.`, id);'],
]);
await edit("scripts/build.mjs", [
  ['const html = template.replace("__STYLES__", styles).replace("__SCRIPT__", script);', `for (const marker of ["__STYLES__", "__SCRIPT__"]) {
  if (template.split(marker).length !== 2) throw new Error(\`HTML template must contain exactly one \${marker} marker\`);
}
// A callback inserts dollar sequences literally. One pass also prevents marker
// text inside a payload from being interpreted as another template slot.
const html = template.replace(/__STYLES__|__SCRIPT__/g, (marker) => marker === "__STYLES__" ? styles : script);`],
]);
await edit("test/ui.test.mjs", [
  ['      throw new Error("initial config should come from the host init payload");', '      return {}; // Saving re-reads the host library before merging this change.'],
  ['    assert.equal(configReads, 0);', '    assert.equal(configReads, 1);'],
]);
await edit("README.md", [
  ['It opts into Chat\'s generic `model-profile-editor` v1 contract', `Before each save or delete, the editor re-reads the host-owned library and
merges only the intended profile change. Unrelated changes already present in
that snapshot are preserved; conflicting edits to the same profile block the
write and ask the user to reopen the editor. This is not atomic concurrency
control: the v1 bridge exposes separate reads and writes, so a write racing
between those calls still requires a future host-side revision/CAS API.

It opts into Chat's generic \`model-profile-editor\` v1 contract`],
]);
