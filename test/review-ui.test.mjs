import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const profile = (id = "saved") => ({
  id, title: id, description: "", connector_id: "local", model: "model-a",
  reasoning: null, temperature: null, max_output_tokens: null, tools: [],
  prompt: { layer_ids: [], custom_texts: [] },
});
const context = {
  kind: "model-profile-editor",
  connectors: [{ id: "local", default_model: "model-a", models: [{ id: "model-a", variants: [] }] }],
  tools: [{ reference: "notes/read", provider: "notes", name: "read" }],
  prompt_layers: [{ id: "protocol", included: true }, { id: "instructions", title: "Instructions", included: true }],
};
async function waitFor(check) {
  for (let n = 0; n < 100; n += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("UI did not settle");
}
async function open(t, { initial = { profiles: [profile()] }, current = initial, failWrite = false } = {}) {
  const writes = [];
  const dom = new JSDOM(await readFile(new URL("../dist/ui/index.html", import.meta.url), "utf8"), {
    runScripts: "dangerously",
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.appHost = {
        ready() {},
        onInit(callback) { queueMicrotask(() => callback({ config: initial, hostContext: context })); },
        getConfig: async () => structuredClone(current),
        updateConfig: async (value) => {
          writes.push(structuredClone(value));
          if (failWrite) throw new Error("disk unavailable");
          current = structuredClone(value);
          return value;
        },
      };
    },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  await waitFor(() => document.querySelector("#profile-form"));
  const query = (selector) => document.querySelector(selector);
  const enter = (name, value) => {
    const element = query(`[name="${name}"]`);
    if (element.type === "checkbox") element.checked = value;
    else element.value = value;
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  return { document, query, enter, writes };
}
function draft(app) {
  return [...app.document.querySelectorAll("#profile-form input, #profile-form select, #profile-form textarea")]
    .map((element) => [element.name, element.value, element.checked ?? null]);
}
function fillDraft(app) {
  app.query("[data-add-prompt]").click();
  app.enter("title", "Draft ");
  app.enter("description", "  unfinished description\n");
  app.enter("temperature", "0.75");
  app.enter("max_output_tokens", "4096");
  app.enter("tools", true);
  app.enter("prompt_layer_ids", false);
  app.enter("custom_texts", "  unfinished\ncustom text  ");
}

test("delete confirmation and cancellation preserve every unfinished form field", async (t) => {
  const app = await open(t);
  fillDraft(app);
  const before = draft(app);
  app.query("[data-delete]").click();
  assert.deepEqual(draft(app), before);
  app.enter("description", "more edits while confirming ");
  const edited = draft(app);
  app.query("[data-cancel-delete]").click();
  assert.deepEqual(draft(app), edited);
  assert.equal(app.writes.length, 0);
});

for (const failWrite of [false, true]) {
  test(`deleting another profile preserves the draft when the write ${failWrite ? "fails" : "succeeds"}`, async (t) => {
    const app = await open(t, { failWrite });
    fillDraft(app);
    const before = draft(app);
    app.query("[data-delete]").click();
    app.query("[data-confirm-delete]").click();
    await waitFor(() => /Deleted|Could not save/.test(app.query(".status").textContent));
    assert.deepEqual(draft(app), before);
    assert.equal(app.writes.length, 1);
  });
}

test("saving preserves additions and edits made elsewhere to unrelated profiles", async (t) => {
  const other = { ...profile("other"), title: "Changed elsewhere" };
  const app = await open(t, {
    initial: { profiles: [profile(), profile("other")] },
    current: { profiles: [profile(), other, profile("new-elsewhere")] },
  });
  app.query('[data-edit="saved"]').click();
  app.enter("title", "My edit");
  app.query('[type="submit"]').click();
  await waitFor(() => app.writes.length > 0);
  assert.deepEqual(app.writes[0].profiles, [{ ...profile(), title: "My edit" }, other, profile("new-elsewhere")]);
});

test("deleting preserves additions made elsewhere", async (t) => {
  const app = await open(t, { current: { profiles: [profile(), profile("new-elsewhere")] } });
  app.query("[data-delete]").click();
  app.query("[data-confirm-delete]").click();
  await waitFor(() => app.writes.length > 0);
  assert.deepEqual(app.writes[0].profiles, [profile("new-elsewhere")]);
});

for (const action of ["save", "delete"]) {
  test(`${action} refuses to overwrite a profile changed in another editor`, async (t) => {
    const app = await open(t, { current: { profiles: [{ ...profile(), title: "Changed elsewhere" }] } });
    app.query("[data-edit]").click();
    app.enter("description", "My unfinished edit");
    if (action === "save") app.query('[type="submit"]').click();
    else {
      app.query("[data-delete]").click();
      app.query("[data-confirm-delete]").click();
    }
    await waitFor(() => app.query(".status").textContent !== "Saving...");
    assert.equal(app.writes.length, 0);
    assert.match(app.query(".status").textContent, /changed in another editor/);
    assert.equal(app.query('[name="description"]').value, "My unfinished edit");
  });
}

test("a malformed fresh config blocks writes without erasing the draft", async (t) => {
  const app = await open(t, { current: { profiles: null } });
  app.enter("title", "New profile");
  app.query('[type="submit"]').click();
  await waitFor(() => app.query(".status").textContent !== "Saving...");
  assert.equal(app.writes.length, 0);
  assert.match(app.query(".status").textContent, /must be a list/);
  assert.equal(app.query('[name="title"]').value, "New profile");
});

test("native bad numeric input is not silently saved as a provider default", async (t) => {
  const app = await open(t);
  app.enter("title", "New profile");
  // jsdom does not implement the browser's partially typed number editor.
  // Model the badInput flag exposed for values such as an unfinished exponent.
  Object.defineProperty(app.query('[name="temperature"]'), "validity", { value: { badInput: true } });
  app.query('[type="submit"]').click();
  await waitFor(() => app.query(".error-summary") || app.writes.length > 0);
  assert.equal(app.writes.length, 0);
  assert.match(app.query(".error-summary").textContent, /valid number.*temperature/i);
});
