import assert from "node:assert/strict";
import test from "node:test";

import { kebabCase, profileFromForm, profilesFromConfig, upsertProfile, validateProfile } from "../src/profile-model.mjs";

const valid = () => ({ id: "focused-work", title: "Focused work", description: "", connector_id: "llm-provider/local", model: "model-a", reasoning: null, temperature: null, max_output_tokens: null, tools: ["notes/read"], prompt: { layer_ids: ["assistant-instructions"], custom_texts: ["Be concise."] } });

test("normalizes optional generation settings and tool lines", () => {
  const profile = profileFromForm({ id: " focused-work ", title: " Focused work ", description: " ", connector_id: " llm-provider/local ", model: " model-a ", reasoning: "", temperature: "", max_output_tokens: "4096", tools: [" notes/read ", "notes/write"], prompt_layer_ids: ["assistant-instructions"], custom_texts: [" Be concise. "] });
  assert.deepEqual(profile.tools, ["notes/read", "notes/write"]);
  assert.equal(profile.temperature, null);
  assert.equal(profile.max_output_tokens, 4096);
  assert.deepEqual(profile.prompt, { layer_ids: ["assistant-instructions"], custom_texts: ["Be concise."] });
});

test("always writes the canonical prompt override shape", () => {
  const profile = profileFromForm({ id: "focused-work", title: "Focused work", description: "", connector_id: "llm-provider/local", model: "model-a", reasoning: "", temperature: "", max_output_tokens: "", tools: [], prompt_layer_ids: [], custom_texts: [] });
  assert.deepEqual(profile.prompt, { layer_ids: [], custom_texts: [] });
});

test("creates stable kebab-case IDs from names", () => {
  assert.equal(kebabCase("  Focused Writing & Review  "), "focused-writing-review");
  assert.equal(kebabCase("Über concise"), "uber-concise");
});

test("rejects authority-shaped mistakes before host validation", () => {
  assert.deepEqual(validateProfile(valid(), [], null), []);
  assert.match(validateProfile({ ...valid(), tools: ["notes/read", "notes/read"] }, [], null).join(" "), /more than once/);
  assert.match(validateProfile({ ...valid(), tools: ["not-qualified"] }, [], null).join(" "), /provider\/capability/);
  assert.match(validateProfile({ ...valid(), temperature: 2.1 }, [], null).join(" "), /between 0 and 2/);
  assert.match(validateProfile(valid(), [valid()], null).join(" "), /already exists/);
  assert.match(validateProfile({ ...valid(), prompt: null }, [], null).join(" "), /Prompt configuration is required/);
  assert.match(validateProfile({ ...valid(), prompt: { layer_ids: ["protocol"], custom_texts: [] } }, [], null).join(" "), /Prompt layer/);
  assert.match(validateProfile({ ...valid(), title: " Focused work " }, [], null).join(" "), /trimmed/);
  assert.match(validateProfile({ ...valid(), prompt: { layer_ids: [], custom_texts: ["a".repeat(16_384), "b".repeat(16_384), "c"] } }, [], null).join(" "), /total at most 32,768/);
});

test("counts JSON Schema characters rather than UTF-16 code units", () => {
  const unicode = {
    ...valid(),
    title: `${"a".repeat(119)}😀`,
    tools: [`${"😀".repeat(64)}/a`],
  };
  assert.deepEqual(validateProfile(unicode, [], null), []);
  assert.match(validateProfile({ ...unicode, title: `${unicode.title}b` }, [], null).join(" "), /at most 120/);
});

test("parses only complete, canonical stored configs while allowing first run", () => {
  assert.deepEqual(profilesFromConfig({}), []);
  assert.deepEqual(profilesFromConfig({ profiles: [valid()] }), [valid()]);
  assert.throws(() => profilesFromConfig({ profiles: null }), /must be a list/);
  assert.throws(() => profilesFromConfig({ profiles: [{}] }), /missing 'id'/);
  assert.throws(() => profilesFromConfig({ profiles: [valid(), { ...valid(), title: "Duplicate" }] }), /duplicated/);
  assert.throws(() => profilesFromConfig({ profiles: [valid()], extra: true }), /unknown field 'extra'/);
});

test("enforces profile collection transitions at the model boundary", () => {
  const full = Array.from({ length: 64 }, (_, index) => ({ ...valid(), id: `profile-${index}`, title: `Profile ${index}` }));
  assert.match(validateProfile({ ...valid(), id: "another" }, full, null).join(" "), /at most 64 profiles/);
  assert.throws(() => upsertProfile(full, { ...valid(), id: "another" }), /at most 64 profiles/);
  assert.throws(() => upsertProfile([valid()], valid()), /already exists/);
  assert.match(validateProfile({ ...valid(), id: "renamed" }, [valid()], "focused-work").join(" "), /stable ID cannot change/);
  assert.throws(() => upsertProfile([valid()], { ...valid(), id: "renamed" }, "focused-work"), /stable ID cannot change/);
  assert.throws(() => upsertProfile([valid()], { ...valid(), id: "missing" }, "missing"), /no longer exists/);
});

test("updates one profile without changing list order", () => {
  const second = { ...valid(), id: "second", title: "Second" };
  assert.deepEqual(upsertProfile([valid(), second], { ...valid(), title: "Updated" }, "focused-work").map((item) => item.title), ["Updated", "Second"]);
});
