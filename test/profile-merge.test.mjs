import assert from "node:assert/strict";
import test from "node:test";
import { mergeProfileChange } from "../src/profile-merge.mjs";

const profile = (id = "saved") => ({
  id, title: id, description: "", connector_id: "local", model: "model-a",
  reasoning: null, temperature: null, max_output_tokens: null, tools: [],
  prompt: { layer_ids: [], custom_texts: [] },
});

test("merging an edit retains current order and unrelated concurrent changes", () => {
  const before = profile();
  const changed = { ...before, description: "my edit" };
  const other = { ...profile("other"), title: "external edit" };
  assert.deepEqual(mergeProfileChange([before, profile("other")], [changed, profile("other")],
    [other, before, profile("new")], before.id), [other, changed, profile("new")]);
});

test("conflicting additions, edits, and deleted targets are refused", () => {
  const before = profile();
  const mine = { ...before, title: "Mine" };
  const theirs = { ...before, title: "Theirs" };
  assert.throws(() => mergeProfileChange([], [mine], [theirs], before.id), /changed in another editor/);
  assert.throws(() => mergeProfileChange([before], [mine], [theirs], before.id), /changed in another editor/);
  assert.throws(() => mergeProfileChange([before], [mine], [], before.id), /changed in another editor/);
  assert.throws(() => mergeProfileChange([before], [], [theirs], before.id), /changed in another editor/);
});

test("retrying an already applied addition, edit, or deletion is idempotent", () => {
  const before = profile();
  const after = { ...before, title: "Changed" };
  const other = profile("external");
  assert.deepEqual(mergeProfileChange([], [after], [after, other], after.id), [after, other]);
  assert.deepEqual(mergeProfileChange([before], [after], [after, other], after.id), [after, other]);
  assert.deepEqual(mergeProfileChange([before], [], [other], before.id), [other]);
});

test("JSON object key order does not create a false conflict", () => {
  const before = profile();
  const reordered = Object.fromEntries(Object.entries(before).reverse());
  reordered.prompt = { custom_texts: [], layer_ids: [] };
  const after = { ...before, title: "Changed" };
  assert.deepEqual(mergeProfileChange([before], [after], [reordered], before.id), [after]);
});

test("the merged library must still satisfy the collection limit", () => {
  const full = Array.from({ length: 64 }, (_, index) => profile(`profile-${index}`));
  assert.throws(() => mergeProfileChange(full.slice(1), [...full.slice(1), profile()], full, "saved"), /more than 64 profiles/);
});
