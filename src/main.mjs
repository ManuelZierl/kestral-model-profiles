import { EMPTY_PROFILE, kebabCase, profileFromForm, profilesFromConfig, upsertProfile, validateProfile } from "./profile-model.mjs";

import { mergeProfileChange } from "./profile-merge.mjs";

const root = document.querySelector("#app");
if (!root) throw new Error("Model Profiles app root is missing");

const state = {
  profiles: [],
  originalId: null,
  draft: { ...EMPTY_PROFILE },
  idEdited: false,
  context: { connectors: [], tools: [], promptLayers: [] },
  errors: [],
  status: "",
  statusIsError: false,
  deleteConfirmation: null,
  saving: false,
  loadState: "loading",
  loadError: "",
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function readContext(value) {
  if (!value || value.kind !== "model-profile-editor") return { connectors: [], tools: [], promptLayers: [] };
  return {
    connectors: Array.isArray(value.connectors) ? value.connectors : [],
    tools: Array.isArray(value.tools) ? value.tools : [],
    promptLayers: Array.isArray(value.prompt_layers) ? value.prompt_layers : [],
  };
}

function defaultPrompt() {
  return {
    layer_ids: state.context.promptLayers
      .filter((layer) => layer.id !== "protocol" && layer.included)
      .map((layer) => layer.id),
    custom_texts: [],
  };
}

function newDraft() {
  const connector = state.context.connectors[0];
  return {
    ...EMPTY_PROFILE,
    connector_id: connector?.id ?? "",
    model: connector?.default_model ?? connector?.models?.[0]?.id ?? "",
    tools: [],
    prompt: defaultPrompt(),
  };
}

function editableProfile(profile) {
  return {
    ...structuredClone(profile),
  };
}

function selectedConnector() {
  return state.context.connectors.find((connector) => connector.id === state.draft.connector_id) ?? null;
}

function modelChoices() {
  const connector = selectedConnector();
  const models = Array.isArray(connector?.models) ? [...connector.models] : [];
  if (state.draft.model && !models.some((model) => model.id === state.draft.model)) {
    models.unshift({ id: state.draft.model, display_name: null, variants: [], unavailable: true });
  }
  return models;
}

function selectedModel() {
  return modelChoices().find((model) => model.id === state.draft.model) ?? null;
}

function variantOptions(selected) {
  const variants = [...(selectedModel()?.variants ?? [])];
  if (selected && !variants.includes(selected)) variants.unshift(selected);
  return variants
    .map((value) => `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(variantLabel(value))}${selectedModel()?.variants?.includes(value) ? "" : " (not currently advertised)"}</option>`)
    .join("");
}

function hasVariantChoice() {
  return (selectedModel()?.variants?.length ?? 0) > 0 || Boolean(state.draft.reasoning);
}

function variantLabel(value) {
  return ({ minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" })[value] ?? value;
}

function profileList() {
  if (state.profiles.length === 0) {
    return `<div class="empty"><strong>No profiles yet</strong><p>Create a focused setup for writing, research, coding, or any repeated task.</p></div>`;
  }
  return state.profiles.map((profile) => {
    const confirming = state.deleteConfirmation === profile.id;
    const parameters = [
      profile.reasoning ? `${profile.reasoning} variant` : "provider variant default",
      profile.temperature === null ? "provider temperature default" : `temperature ${profile.temperature}`,
      profile.max_output_tokens === null ? "provider token default" : `${profile.max_output_tokens} max tokens`,
    ];
    const promptSummary = `${profile.prompt.layer_ids.length} Chat layer${profile.prompt.layer_ids.length === 1 ? "" : "s"}, ${profile.prompt.custom_texts.length} custom text${profile.prompt.custom_texts.length === 1 ? "" : "s"}`;
    return `<article class="profile-card">
      <div class="profile-heading">
        <div><h3>${escapeHtml(profile.title)}</h3><p class="profile-id">${escapeHtml(profile.id)}</p></div>
        <span class="tool-count">${profile.tools.length} ${profile.tools.length === 1 ? "tool" : "tools"}</span>
      </div>
      ${profile.description ? `<p>${escapeHtml(profile.description)}</p>` : ""}
      <dl><div><dt>Provider profile</dt><dd>${escapeHtml(profile.connector_id)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(profile.model)}</dd></div><div><dt>Prompt</dt><dd>${escapeHtml(promptSummary)}</dd></div></dl>
      <p class="parameters">${parameters.map(escapeHtml).join(" / ")}</p>
      <div class="card-actions">
        <button type="button" class="secondary" data-edit="${escapeHtml(profile.id)}">Edit</button>
        ${confirming
          ? `<span class="delete-question">Delete this profile? Chat threads using it will return to Chat defaults.</span><button type="button" class="danger" data-confirm-delete="${escapeHtml(profile.id)}">Delete</button><button type="button" class="quiet" data-cancel-delete>Cancel</button>`
          : `<button type="button" class="quiet" data-delete="${escapeHtml(profile.id)}">Delete</button>`}
      </div>
    </article>`;
  }).join("");
}

function connectorOptions() {
  const connectors = [...state.context.connectors];
  if (state.draft.connector_id && !connectors.some((connector) => connector.id === state.draft.connector_id)) {
    connectors.unshift({ id: state.draft.connector_id, unavailable: true, models: [] });
  }
  return connectors.map((connector) => `<option value="${escapeHtml(connector.id)}"${connector.id === state.draft.connector_id ? " selected" : ""}>${escapeHtml(connector.id)}${connector.unavailable ? " (not configured)" : ""}</option>`).join("");
}

function modelOptions() {
  return modelChoices().map((model) => `<option value="${escapeHtml(model.id)}"${model.id === state.draft.model ? " selected" : ""}>${escapeHtml(model.display_name || model.id)}${model.unavailable ? " (not currently available)" : ""}</option>`).join("");
}

function toolChoices() {
  const available = state.context.tools.map((tool) => ({ ...tool, unavailable: false }));
  const missing = state.draft.tools
    .filter((reference) => !available.some((tool) => tool.reference === reference))
    .map((reference) => ({ reference, provider: "Unavailable", name: reference, description: "This tool is not in Chat's current granted catalog.", unavailable: true }));
  const tools = [...available, ...missing];
  if (tools.length === 0) return `<p class="empty-choice">Chat currently has no granted tools.</p>`;
  return tools.map((tool) => `<label class="check-row${tool.unavailable ? " unavailable" : ""}">
    <input type="checkbox" name="tools" value="${escapeHtml(tool.reference)}"${state.draft.tools.includes(tool.reference) ? " checked" : ""}>
    <span><strong>${escapeHtml(tool.provider)} / ${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.description || tool.reference)}</small></span>
  </label>`).join("");
}

function promptLayerChoices() {
  const selectedIds = state.draft.prompt.layer_ids;
  const protocol = state.context.promptLayers.find((layer) => layer.id === "protocol");
  const available = state.context.promptLayers.filter((layer) => layer.id !== "protocol" && layer.included);
  const missing = selectedIds
    .filter((id) => !available.some((layer) => layer.id === id))
    .map((id) => ({ id, title: id, source: "Unavailable", content: "This layer is no longer included by Settings → Chat.", unavailable: true }));
  return `<label class="check-row fixed">
      <input type="checkbox" checked disabled>
      <span><strong>${escapeHtml(protocol?.title ?? "Kestral protocol")}</strong><small>Always included by the host and cannot be replaced.</small></span>
    </label>${[...available, ...missing].map((layer) => `<label class="check-row${layer.unavailable ? " unavailable" : ""}">
      <input type="checkbox" name="prompt_layer_ids" value="${escapeHtml(layer.id)}"${selectedIds.includes(layer.id) ? " checked" : ""}>
      <span><strong>${escapeHtml(layer.title)}</strong><small>${escapeHtml(layer.source ?? "Chat settings")}</small></span>
      ${layer.content ? `<details><summary>Review text</summary><pre>${escapeHtml(layer.content)}</pre></details>` : ""}
    </label>`).join("")}`;
}

function customPromptTexts() {
  const texts = state.draft.prompt.custom_texts;
  if (texts.length === 0) return `<p class="empty-choice">No profile-specific prompt text.</p>`;
  return texts.map((text, index) => `<div class="custom-prompt">
    <label><span>Custom text ${index + 1}</span><textarea name="custom_texts" rows="4" placeholder="Add instructions for this model profile.">${escapeHtml(text)}</textarea></label>
    <button type="button" class="quiet compact" data-remove-prompt="${index}">Remove</button>
  </div>`).join("");
}

function loadStatePanel() {
  if (state.loadState === "loading") {
    return `<section class="load-state" role="status"><strong>Loading profiles...</strong><p>Reading the host-validated profile library.</p></section>`;
  }
  return `<section class="load-state error" role="alert" tabindex="-1">
    <strong>Profiles could not be loaded</strong>
    <p>${escapeHtml(state.loadError)}</p>
    <p>Editing stays blocked so a failed load cannot replace saved profiles.</p>
    <button type="button" class="secondary" data-retry-load>Try again</button>
  </section>`;
}

function render() {
  const draft = state.draft;
  const connector = selectedConnector();
  const atProfileLimit = state.originalId === null && state.profiles.length >= 64;
  root.innerHTML = `<header class="hero">
    <p class="eyebrow">Chat setup library</p>
    <h1>Model Profiles</h1>
    <p class="lede">Save a model, generation settings, prompt composition, and focused tool list once. Pick the profile beside Chat's composer whenever you need it.</p>
    <div class="authority-note"><strong>Profiles can only reduce access.</strong><span>A profile never grants a tool. Chat uses the overlap between this list and its current permissions.</span></div>
  </header>
  ${state.loadState === "ready" ? `<div class="workspace" aria-busy="${state.saving}">
    <section class="library" aria-labelledby="library-title">
      <div class="section-heading"><div><p class="eyebrow">Saved setups</p><h2 id="library-title">Your profiles</h2></div><span>${state.profiles.length} of 64</span></div>
      <div class="profile-list">${profileList()}</div>
    </section>
    <section class="editor" aria-labelledby="editor-title">
      <div class="section-heading"><div><p class="eyebrow">${state.originalId ? "Update setup" : "New setup"}</p><h2 id="editor-title" tabindex="-1">${state.originalId ? "Edit profile" : "Create profile"}</h2></div></div>
      <form id="profile-form" novalidate>
        ${state.errors.length > 0 ? `<div class="error-summary" role="alert" tabindex="-1"><strong>Check this profile</strong><ul>${state.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>` : ""}
        <div class="field-grid">
          <label><span>Name</span><input name="title" required value="${escapeHtml(draft.title)}" autocomplete="off"><small>Shown in Chat's profile picker.</small></label>
          <label><span>Stable ID</span><input name="id" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeHtml(draft.id)}" placeholder="generated-from-name" autocomplete="off"${state.originalId ? " readonly aria-readonly=\"true\"" : ""}><small>${state.originalId ? "The ID cannot change after the profile is first saved." : "Generated from the name. You can edit it before saving."}</small></label>
        </div>
        <label><span>Description <em>optional</em></span><textarea name="description" rows="3" placeholder="When should you choose this profile?">${escapeHtml(draft.description)}</textarea></label>
        <fieldset><legend>Model</legend><p>Choose from profiles configured under <strong>Settings → Model providers</strong>. Model choices are discovered from the selected provider profile.</p><div class="field-grid">
          <label><span>Model provider profile</span><select name="connector_id" required ${state.context.connectors.length === 0 ? "disabled" : ""}><option value="">Choose a profile</option>${connectorOptions()}</select></label>
          <label><span>Model</span><select name="model" required ${modelChoices().length === 0 ? "disabled" : ""}><option value="">Choose a model</option>${modelOptions()}</select></label>
        </div>${connector?.discovery_error ? `<p class="inline-warning" role="status">Model discovery failed. The configured default remains available: ${escapeHtml(connector.discovery_error)}</p>` : ""}</fieldset>
        <fieldset><legend>Generation</legend><p>Leave a value blank to keep the provider profile's default.</p><div class="generation-grid">
          ${hasVariantChoice() ? `<label><span>Model variant</span><select name="reasoning"><option value="">Provider default</option>${variantOptions(draft.reasoning)}</select></label>` : ""}
          <label><span>Temperature</span><input name="temperature" type="number" min="0" max="2" step="0.1" value="${escapeHtml(draft.temperature ?? "")}" placeholder="Provider default"></label>
          <label><span>Maximum output tokens</span><input name="max_output_tokens" type="number" min="1" max="1000000" step="1" value="${escapeHtml(draft.max_output_tokens ?? "")}" placeholder="Provider default"></label>
        </div></fieldset>
        <fieldset><legend>System prompt</legend><p>Select the live prompt layers composed under <strong>Settings → Chat</strong>. The Kestral protocol stays mandatory. Profile-specific texts are appended in order; clearing every optional layer and text intentionally uses the protocol alone.</p>
          <div class="choice-list">${promptLayerChoices()}</div>
          <div class="subsection-heading"><strong>Profile-specific text</strong><button type="button" class="secondary compact" data-add-prompt ${(draft.prompt?.custom_texts.length ?? 0) >= 8 ? "disabled" : ""}>Add text</button></div>
          <div class="custom-prompts">${customPromptTexts()}</div>
        </fieldset>
        <fieldset><legend>Tools</legend><p>Select from Chat's currently granted capabilities. An empty list gives this profile no tools; revoked tools remain unavailable.</p><div class="choice-list">${toolChoices()}</div></fieldset>
        ${state.originalId ? `<p class="inline-warning">Saving changes makes existing Chat selections stale. Review and select the updated profile again in Chat.</p>` : ""}
        ${atProfileLimit ? `<p class="inline-warning">The library already contains 64 profiles. Delete one before creating another.</p>` : ""}
        <div class="form-actions"><button type="submit" class="primary" ${state.saving || atProfileLimit ? "disabled" : ""}>${state.saving ? "Saving..." : "Save profile"}</button><button type="button" class="secondary" data-reset>${state.originalId ? "Cancel editing" : "Clear"}</button></div>
      </form>
    </section>
  </div>` : loadStatePanel()}
  <p class="status${state.statusIsError ? " error" : ""}" role="${state.statusIsError ? "alert" : "status"}" tabindex="-1" aria-live="${state.statusIsError ? "assertive" : "polite"}">${escapeHtml(state.status)}</p>`;
  root.setAttribute("aria-busy", String(state.loadState === "loading" || state.saving));
  if (state.saving) {
    root.querySelectorAll("button, input, select, textarea").forEach((control) => { control.disabled = true; });
  }
  wireEvents();
}

function valuesFor(form) {
  const value = (name) => form.elements.namedItem(name)?.value ?? "";
  return {
    id: value("id"),
    title: value("title"),
    description: value("description"),
    connector_id: value("connector_id"),
    model: value("model"),
    reasoning: value("reasoning"),
    temperature: value("temperature"),
    max_output_tokens: value("max_output_tokens"),
    tools: [...form.querySelectorAll('input[name="tools"]:checked')].map((input) => input.value),
    prompt_layer_ids: [...form.querySelectorAll('input[name="prompt_layer_ids"]:checked')].map((input) => input.value),
    custom_texts: [...form.querySelectorAll('textarea[name="custom_texts"]')].map((input) => input.value),
  };
}

function readDraft(form, keepEmptyCustomTexts = false) {
  const values = valuesFor(form);
  const draft = profileFromForm(values);
  if (keepEmptyCustomTexts) {
    // Keep in-progress text verbatim across unrelated UI transitions; normalize
    // only on submit. Numeric draft values can be strings until that boundary.
    for (const field of ["id", "title", "description", "connector_id", "model", "temperature", "max_output_tokens"]) {
      draft[field] = values[field];
    }
    draft.prompt.custom_texts = values.custom_texts;
  }
  return draft;
}

function clearStatus() {
  if (!state.status && !state.statusIsError) return;
  state.status = "";
  state.statusIsError = false;
  const status = root.querySelector(".status");
  if (status) {
    status.textContent = "";
    status.classList.remove("error");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
  }
}

async function loadProfiles(config, focusFailure = false) {
  state.loadState = "loading";
  state.loadError = "";
  state.status = "";
  state.statusIsError = false;
  render();
  try {
    const currentConfig = config === undefined ? await window.appHost.getConfig() : config;
    state.profiles = profilesFromConfig(currentConfig);
    state.draft = newDraft();
    state.loadState = "ready";
  } catch (error) {
    state.loadState = "failed";
    state.loadError = error instanceof Error ? error.message : String(error);
  }
  render();
  if (focusFailure && state.loadState === "failed") root.querySelector(".load-state.error")?.focus();
}

async function persist(nextProfiles, success, changedId) {
  if (state.loadState !== "ready" || state.saving) return false;
  state.saving = true;
  state.status = "Saving...";
  state.statusIsError = false;
  render();
  try {
    const current = profilesFromConfig(await window.appHost.getConfig());
    const merged = mergeProfileChange(state.profiles, nextProfiles, current, changedId);
    await window.appHost.updateConfig({ profiles: merged });
    state.profiles = merged;
    state.status = success;
    return true;
  } catch (error) {
    state.status = `Could not save: ${error instanceof Error ? error.message : String(error)}`;
    state.statusIsError = true;
    return false;
  } finally {
    state.saving = false;
  }
}

function resetEditor(clearStatus = true) {
  state.originalId = null;
  state.draft = newDraft();
  state.idEdited = false;
  state.errors = [];
  if (clearStatus) {
    state.status = "";
    state.statusIsError = false;
  }
}

function wireEvents() {
  root.querySelector("[data-retry-load]")?.addEventListener("click", () => { void loadProfiles(undefined, true); });
  const form = root.querySelector("#profile-form");
  form?.addEventListener("input", clearStatus);
  form?.elements.namedItem("title")?.addEventListener("input", (event) => {
    state.draft.title = event.currentTarget.value;
    if (!state.idEdited) {
      state.draft.id = kebabCase(state.draft.title);
      form.elements.namedItem("id").value = state.draft.id;
    }
  });
  form?.elements.namedItem("id")?.addEventListener("input", (event) => {
    state.idEdited = true;
    state.draft.id = event.currentTarget.value;
  });
  form?.elements.namedItem("connector_id")?.addEventListener("change", (event) => {
    clearStatus();
    state.draft = readDraft(form, true);
    state.draft.connector_id = event.currentTarget.value;
    const connector = selectedConnector();
    state.draft.model = connector?.default_model ?? connector?.models?.[0]?.id ?? "";
    state.draft.reasoning = null;
    render();
    root.querySelector('select[name="connector_id"]')?.focus();
  });
  form?.elements.namedItem("model")?.addEventListener("change", (event) => {
    clearStatus();
    state.draft = readDraft(form, true);
    state.draft.model = event.currentTarget.value;
    state.draft.reasoning = null;
    render();
    root.querySelector('select[name="model"]')?.focus();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.saving) return;
    state.draft = readDraft(form);
    const invalidNumbers = [...form.querySelectorAll('input[type="number"]')]
      .filter((input) => input.validity.badInput)
      .map((input) => `Enter a valid number for ${input.name === "temperature" ? "temperature" : "maximum output tokens"}.`);
    state.errors = [...invalidNumbers, ...validateProfile(state.draft, state.profiles, state.originalId)];
    if (state.errors.length > 0) {
      state.status = "Profile not saved.";
      state.statusIsError = true;
      render();
      root.querySelector(".error-summary")?.focus();
      return;
    }
    const next = upsertProfile(state.profiles, state.draft, state.originalId);
    const saved = await persist(next, `Saved ${state.draft.title}.`, state.draft.id);
    if (saved) resetEditor(false);
    render();
    root.querySelector(saved ? 'input[name="title"]' : 'button[type="submit"]')?.focus();
  });
  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    resetEditor();
    render();
  });
  root.querySelector("[data-add-prompt]")?.addEventListener("click", () => {
    clearStatus();
    state.draft = readDraft(form, true);
    state.draft.prompt.custom_texts.push("");
    render();
    root.querySelectorAll('textarea[name="custom_texts"]')[state.draft.prompt.custom_texts.length - 1]?.focus();
  });
  root.querySelectorAll("[data-remove-prompt]").forEach((button) => button.addEventListener("click", () => {
    clearStatus();
    state.draft = readDraft(form, true);
    state.draft.prompt.custom_texts.splice(Number(button.dataset.removePrompt), 1);
    render();
  }));
  root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const profile = state.profiles.find((item) => item.id === button.dataset.edit);
    if (!profile) return;
    clearStatus();
    state.originalId = profile.id;
    state.draft = editableProfile(profile);
    state.idEdited = true;
    state.errors = [];
    state.deleteConfirmation = null;
    render();
    root.querySelector("#editor-title")?.focus();
    root.querySelector("#editor-title")?.scrollIntoView({ block: "start" });
  }));
  root.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => {
    clearStatus();
    state.draft = readDraft(form, true);
    state.deleteConfirmation = button.dataset.delete;
    render();
    root.querySelector(`[data-confirm-delete="${button.dataset.delete}"]`)?.focus();
  }));
  root.querySelector("[data-cancel-delete]")?.addEventListener("click", () => {
    state.draft = readDraft(form, true);
    const id = state.deleteConfirmation;
    state.deleteConfirmation = null;
    render();
    root.querySelector(`[data-delete="${id}"]`)?.focus();
  });
  root.querySelector("[data-confirm-delete]")?.addEventListener("click", async (event) => {
    if (state.saving) return;
    const id = event.currentTarget.dataset.confirmDelete;
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) return;
    const next = state.profiles.filter((item) => item.id !== id);
    state.draft = readDraft(form, true);
    const deleted = await persist(next, `Deleted ${profile.title}.`, id);
    if (deleted) {
      state.deleteConfirmation = null;
      if (state.originalId === id) resetEditor(false);
    }
    render();
    root.querySelector(deleted ? ".status" : `[data-confirm-delete="${id}"]`)?.focus();
  });
}

window.appHost.onInit(async (host) => {
  state.context = readContext(host.hostContext);
  state.draft = newDraft();
  await loadProfiles(host.config);
  window.appHost.ready();
});
