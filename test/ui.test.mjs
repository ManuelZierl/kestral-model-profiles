import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { JSDOM } from "jsdom";

const builtUi = new URL("../dist/ui/index.html", import.meta.url);

async function waitFor(check) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for the Model Profiles UI");
}

const hostContext = {
  kind: "model-profile-editor",
  connectors: [{
    id: "llm-provider/test",
    default_model: "model-a",
    default_variant: null,
    models: [{ id: "model-a", display_name: "Model A", variants: [] }],
    discovery_error: null,
  }],
  tools: [],
  prompt_layers: [{ id: "protocol", title: "Kestral protocol", included: true }],
};

const storedProfile = (overrides = {}) => ({
  id: "focused-work",
  title: "Focused Work",
  description: "",
  connector_id: "llm-provider/test",
  model: "model-a",
  reasoning: null,
  temperature: null,
  max_output_tokens: null,
  tools: [],
  prompt: { layer_ids: [], custom_texts: [] },
  ...overrides,
});

async function createDom({
  context = hostContext,
  initialConfig = {},
  getConfig = async () => initialConfig,
  updateConfig = async (config) => config,
} = {}) {
  const html = await readFile(builtUi, "utf8");
  return new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.structuredClone = globalThis.structuredClone;
      window.appHost = {
        ready() {},
        reportError() {},
        onInit(callback) {
          queueMicrotask(() => callback({ hostContext: context, config: initialConfig }));
        },
        getConfig,
        updateConfig,
      };
    },
  });
}

test("a first-run empty config can save its first profile", async () => {
  let savedConfig = null;
  let configReads = 0;
  const dom = await createDom({
    getConfig: async () => {
      configReads += 1;
      return {}; // Saving re-reads the host library before merging this change.
    },
    updateConfig: async (config) => {
      savedConfig = config;
      return config;
    },
  });

  try {
    await waitFor(() => dom.window.document.querySelector('select[name="model"]')?.value === "model-a");
    const title = dom.window.document.querySelector('input[name="title"]');
    const save = dom.window.document.querySelector('button[type="submit"]');
    assert.ok(title instanceof dom.window.HTMLInputElement);
    assert.ok(save instanceof dom.window.HTMLButtonElement);
    assert.equal(save.disabled, false);
    assert.equal(dom.window.document.querySelector('select[name="reasoning"]'), null);

    title.value = "Focused Work";
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    save.click();

    await waitFor(() => savedConfig !== null);
    assert.equal(configReads, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(savedConfig)), {
      profiles: [{
        id: "focused-work",
        title: "Focused Work",
        description: "",
        connector_id: "llm-provider/test",
        model: "model-a",
        reasoning: null,
        temperature: null,
        max_output_tokens: null,
        tools: [],
        prompt: { layer_ids: [], custom_texts: [] },
      }],
    });
  } finally {
    dom.window.close();
  }
});

test("model variants appear as choices only when the selected model advertises them", async () => {
  const dom = await createDom({
    context: {
      ...hostContext,
      connectors: [{
        id: "llm-provider/test",
        default_model: "model-a",
        models: [{ id: "model-a", display_name: "Model A", variants: ["low", "xhigh"] }],
      }],
    },
  });

  try {
    await waitFor(() => dom.window.document.querySelector('select[name="reasoning"]'));
    const options = [...dom.window.document.querySelectorAll('select[name="reasoning"] option')].map((option) => option.textContent);
    assert.deepEqual(options, ["Provider default", "Low", "Extra high"]);
  } finally {
    dom.window.close();
  }
});

test("an existing profile keeps its stable ID read-only while editing", async () => {
  const dom = await createDom({ initialConfig: { profiles: [storedProfile()] } });

  try {
    await waitFor(() => dom.window.document.querySelector("[data-edit]"));
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.document.querySelector("[data-edit]").click();
    const id = dom.window.document.querySelector('input[name="id"]');
    assert.ok(id instanceof dom.window.HTMLInputElement);
    assert.equal(id.value, "focused-work");
    assert.equal(id.readOnly, true);
  } finally {
    dom.window.close();
  }
});

test("all editing controls are disabled while a config save is pending", async () => {
  let finishSave;
  const savePending = new Promise((resolve) => { finishSave = resolve; });
  const dom = await createDom({ updateConfig: async () => savePending });

  try {
    await waitFor(() => dom.window.document.querySelector('select[name="model"]')?.value === "model-a");
    const title = dom.window.document.querySelector('input[name="title"]');
    title.value = "Focused Work";
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dom.window.document.querySelector('button[type="submit"]').click();

    await waitFor(() => dom.window.document.querySelector(".status")?.textContent === "Saving...");
    const controls = [...dom.window.document.querySelectorAll("button, input, select, textarea")];
    assert.ok(controls.length > 0);
    assert.ok(controls.every((control) => control.disabled));

    finishSave({});
    await waitFor(() => dom.window.document.querySelector('button[type="submit"]')?.disabled === false);
  } finally {
    dom.window.close();
  }
});

test("editing only custom prompt text preserves the prompt override", async () => {
  let savedConfig = null;
  const profile = storedProfile({ prompt: { layer_ids: ["assistant-instructions"], custom_texts: ["Old text"] } });
  const dom = await createDom({
    context: {
      ...hostContext,
      prompt_layers: [
        { id: "protocol", title: "Kestral protocol", included: true },
        { id: "assistant-instructions", title: "Assistant instructions", included: false },
      ],
    },
    initialConfig: { profiles: [profile] },
    updateConfig: async (config) => { savedConfig = config; return config; },
  });

  try {
    await waitFor(() => dom.window.document.querySelector("[data-edit]"));
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.document.querySelector("[data-edit]").click();
    const customText = dom.window.document.querySelector('textarea[name="custom_texts"]');
    customText.value = "New text";
    customText.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dom.window.document.querySelector('button[type="submit"]').click();

    await waitFor(() => savedConfig !== null);
    assert.deepEqual(JSON.parse(JSON.stringify(savedConfig.profiles[0].prompt)), {
      layer_ids: ["assistant-instructions"],
      custom_texts: ["New text"],
    });
  } finally {
    dom.window.close();
  }
});

test("invalid initial config blocks writes until retry loads the saved library", async () => {
  let loadAttempts = 0;
  let updateCalls = 0;
  const dom = await createDom({
    initialConfig: { profiles: null },
    getConfig: async () => {
      loadAttempts += 1;
      return { profiles: [storedProfile()] };
    },
    updateConfig: async (config) => {
      updateCalls += 1;
      return config;
    },
  });

  try {
    await waitFor(() => dom.window.document.querySelector(".load-state.error"));
    assert.equal(dom.window.document.querySelector("#profile-form"), null);
    assert.match(dom.window.document.querySelector(".load-state.error").textContent, /editing stays blocked/i);
    assert.equal(updateCalls, 0);

    dom.window.document.querySelector("[data-retry-load]").click();
    await waitFor(() => dom.window.document.querySelector("[data-edit]"));
    assert.equal(loadAttempts, 1);
    assert.equal(dom.window.document.querySelector(".profile-card h3").textContent, "Focused Work");
    assert.equal(updateCalls, 0);
  } finally {
    dom.window.close();
  }
});

test("malformed stored config fails closed instead of appearing empty", async () => {
  let updateCalls = 0;
  const dom = await createDom({
    initialConfig: { profiles: null },
    updateConfig: async (config) => {
      updateCalls += 1;
      return config;
    },
  });

  try {
    await waitFor(() => dom.window.document.querySelector(".load-state.error"));
    assert.match(dom.window.document.querySelector(".load-state.error").textContent, /must be a list/i);
    assert.equal(dom.window.document.querySelector("#profile-form"), null);
    assert.equal(updateCalls, 0);
  } finally {
    dom.window.close();
  }
});

test("a full profile library blocks creation but still allows editing", async () => {
  const profiles = Array.from({ length: 64 }, (_, index) => storedProfile({
    id: `profile-${index}`,
    title: `Profile ${index}`,
  }));
  const dom = await createDom({ initialConfig: { profiles } });

  try {
    await waitFor(() => dom.window.document.querySelectorAll(".profile-card").length === 64);
    assert.equal(dom.window.document.querySelector('button[type="submit"]').disabled, true);
    assert.match(dom.window.document.querySelector("#profile-form").textContent, /delete one before creating another/i);

    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.document.querySelector("[data-edit]").click();
    assert.equal(dom.window.document.querySelector('button[type="submit"]').disabled, false);
    assert.equal(dom.window.document.activeElement.id, "editor-title");
  } finally {
    dom.window.close();
  }
});

test("a failed save preserves the draft and can be retried once", async () => {
  let updateCalls = 0;
  const dom = await createDom({
    updateConfig: async (config) => {
      updateCalls += 1;
      if (updateCalls === 1) throw new Error("disk unavailable");
      return config;
    },
  });

  try {
    await waitFor(() => dom.window.document.querySelector('select[name="model"]')?.value === "model-a");
    const title = dom.window.document.querySelector('input[name="title"]');
    title.value = "Focused Work";
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dom.window.document.querySelector('button[type="submit"]').click();

    await waitFor(() => dom.window.document.querySelector(".status.error"));
    assert.match(dom.window.document.querySelector(".status.error").textContent, /disk unavailable/);
    assert.equal(dom.window.document.querySelector('input[name="title"]').value, "Focused Work");
    assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('button[type="submit"]'));

    dom.window.document.querySelector('button[type="submit"]').click();
    await waitFor(() => dom.window.document.querySelector(".status")?.textContent === "Saved Focused Work.");
    assert.equal(updateCalls, 2);
  } finally {
    dom.window.close();
  }
});

test("editing after a successful save clears the stale success message", async () => {
  const dom = await createDom();

  try {
    await waitFor(() => dom.window.document.querySelector('select[name="model"]')?.value === "model-a");
    let title = dom.window.document.querySelector('input[name="title"]');
    title.value = "Focused Work";
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dom.window.document.querySelector('button[type="submit"]').click();
    await waitFor(() => dom.window.document.querySelector(".status")?.textContent === "Saved Focused Work.");

    title = dom.window.document.querySelector('input[name="title"]');
    title.value = "Another profile";
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(dom.window.document.querySelector(".status").textContent, "");
  } finally {
    dom.window.close();
  }
});
