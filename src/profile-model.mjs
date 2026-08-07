import { modelProfilesConfigSchema, profileSchema } from "./manifest.mjs";

export const EMPTY_PROFILE = Object.freeze({
  id: "",
  title: "",
  description: "",
  connector_id: "",
  model: "",
  reasoning: null,
  temperature: null,
  max_output_tokens: null,
  tools: [],
  prompt: { layer_ids: [], custom_texts: [] },
});

const REASONING = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_REF = /^[^/\s]+\/[^/\s]+$/;
const MAX_PROMPT_TEXT_CHARS = 16 * 1024;
const MAX_PROFILES = modelProfilesConfigSchema.properties.profiles.maxItems;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const characterCount = (value) => Array.from(value).length;
const summarize = (value) => {
  const characters = Array.from(String(value));
  return characters.length <= 80 ? characters.join("") : `${characters.slice(0, 77).join("")}...`;
};

function validateExactFields(value, expected, label, errors) {
  for (const field of expected) {
    if (!Object.hasOwn(value, field)) errors.push(`${label} is missing '${field}'.`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.includes(field)) errors.push(`${label} contains unknown field '${summarize(field)}'.`);
  }
}

function validateText(value, label, max, allowEmpty, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} must be text.`);
    return false;
  }
  if ((!allowEmpty && value.length === 0) || value !== value.trim() || characterCount(value) > max) {
    errors.push(`${label} ${allowEmpty ? "must be trimmed and at most" : "is required, must be trimmed, and must be at most"} ${max.toLocaleString("en-US")} characters.`);
    return false;
  }
  return true;
}

export function kebabCase(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function validateProfile(profile, existingProfiles, originalId = null) {
  const errors = [];
  if (!isObject(profile)) return ["Profile must be an object."];
  validateExactFields(profile, profileSchema.required, "Profile", errors);

  if (typeof profile.id !== "string" || !PROFILE_ID.test(profile.id) || profile.id.length > 64) {
    errors.push("ID must use lowercase letters, numbers, and single hyphens.");
  }
  validateText(profile.title, "Name", 120, false, errors);
  validateText(profile.description, "Description", 1000, true, errors);
  validateText(profile.connector_id, "Provider profile ID", 256, false, errors);
  validateText(profile.model, "Model ID", 256, false, errors);
  if (profile.reasoning !== null && (typeof profile.reasoning !== "string" || !REASONING.has(profile.reasoning))) errors.push("Reasoning effort is invalid.");
  if (profile.temperature !== null && (typeof profile.temperature !== "number" || !Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2)) {
    errors.push("Temperature must be between 0 and 2.");
  }
  if (profile.max_output_tokens !== null && (typeof profile.max_output_tokens !== "number" || !Number.isInteger(profile.max_output_tokens) || profile.max_output_tokens < 1 || profile.max_output_tokens > 1_000_000)) {
    errors.push("Maximum output tokens must be a whole number from 1 to 1,000,000.");
  }
  if (!Array.isArray(profile.tools)) {
    errors.push("Tools must be a list.");
  } else {
    if (profile.tools.length > 64) errors.push("A profile can contain at most 64 tools.");
    const tools = new Set();
    for (const tool of profile.tools.slice(0, 64)) {
      if (typeof tool !== "string" || !TOOL_REF.test(tool) || characterCount(tool) > 257) errors.push(`Tool '${summarize(tool)}' must use provider/capability.`);
      if (tools.has(tool)) errors.push(`Tool '${summarize(tool)}' is listed more than once.`);
      tools.add(tool);
    }
  }
  if (!isObject(profile.prompt)
    || !Array.isArray(profile.prompt.layer_ids) || !Array.isArray(profile.prompt.custom_texts)) {
    errors.push("Prompt configuration is required and must contain layer IDs and custom texts.");
  } else {
    validateExactFields(profile.prompt, profileSchema.properties.prompt.required, "Prompt configuration", errors);
    if (profile.prompt.layer_ids.length > 64) errors.push("A profile can select at most 64 prompt layers.");
    const layers = new Set();
    for (const layer of profile.prompt.layer_ids.slice(0, 64)) {
      if (typeof layer !== "string" || !layer || layer !== layer.trim() || characterCount(layer) > 256 || layer === "protocol") {
        errors.push(`Prompt layer '${summarize(layer)}' is invalid.`);
      }
      if (layers.has(layer)) errors.push(`Prompt layer '${summarize(layer)}' is selected more than once.`);
      layers.add(layer);
    }
    if (profile.prompt.custom_texts.length > 8) errors.push("A profile can contain at most 8 custom prompt texts.");
    let totalPromptCharacters = 0;
    for (const text of profile.prompt.custom_texts.slice(0, 8)) {
      const length = typeof text === "string" ? characterCount(text) : 0;
      totalPromptCharacters += length;
      if (typeof text !== "string" || !text || text !== text.trim() || length > MAX_PROMPT_TEXT_CHARS) {
        errors.push("Each custom prompt text must be trimmed, non-empty, and at most 16,384 characters.");
      }
    }
    if (totalPromptCharacters > 32 * 1024) errors.push("Custom prompt texts must total at most 32,768 characters.");
  }
  if (originalId === null && existingProfiles.length >= MAX_PROFILES) {
    errors.push(`A profile library can contain at most ${MAX_PROFILES} profiles.`);
  }
  if (originalId !== null && !existingProfiles.some((item) => item.id === originalId)) {
    errors.push("This profile no longer exists. Reload before saving.");
  }
  if (originalId !== null && profile.id !== originalId) {
    errors.push("A saved profile's stable ID cannot change.");
  }
  if (existingProfiles.some((item) => item.id === profile.id && item.id !== originalId)) {
    errors.push(`A profile with ID '${profile.id}' already exists.`);
  }
  return errors;
}

export function profilesFromConfig(config) {
  if (!isObject(config)) throw new Error("Stored model profiles config must be an object.");
  if (Object.keys(config).length === 0) return [];

  const configErrors = [];
  validateExactFields(config, modelProfilesConfigSchema.required, "Stored config", configErrors);
  if (!Array.isArray(config.profiles)) {
    configErrors.push("Stored config 'profiles' must be a list.");
  } else if (config.profiles.length > MAX_PROFILES) {
    configErrors.push(`Stored config contains more than ${MAX_PROFILES} profiles.`);
  } else {
    const ids = new Set();
    config.profiles.forEach((profile, index) => {
      for (const error of validateProfile(profile, [], null)) {
        configErrors.push(`Profile ${index + 1}: ${error}`);
      }
      if (typeof profile?.id === "string") {
        if (ids.has(profile.id)) configErrors.push(`Profile ${index + 1}: ID '${summarize(profile.id)}' is duplicated.`);
        ids.add(profile.id);
      }
    });
  }
  if (configErrors.length > 0) {
    throw new Error(`Stored model profiles config is invalid. ${configErrors.join(" ")}`);
  }
  return config.profiles;
}

export function profileFromForm(values) {
  const optionalNumber = (value) => value.trim() === "" ? null : Number(value);
  const list = (value) => Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return {
    id: values.id.trim(),
    title: values.title.trim(),
    description: values.description.trim(),
    connector_id: values.connector_id.trim(),
    model: values.model.trim(),
    reasoning: values.reasoning || null,
    temperature: optionalNumber(values.temperature),
    max_output_tokens: optionalNumber(values.max_output_tokens),
    tools: list(values.tools),
    prompt: {
      layer_ids: list(values.prompt_layer_ids),
      custom_texts: list(values.custom_texts),
    },
  };
}

export function upsertProfile(profiles, profile, originalId = null) {
  if (originalId === null) {
    if (profiles.length >= MAX_PROFILES) throw new Error(`A profile library can contain at most ${MAX_PROFILES} profiles.`);
    if (profiles.some((item) => item.id === profile.id)) throw new Error(`A profile with ID '${profile.id}' already exists.`);
    return [...profiles, profile];
  }
  if (profile.id !== originalId) throw new Error("A saved profile's stable ID cannot change.");
  if (!profiles.some((item) => item.id === originalId)) throw new Error("The profile to update no longer exists.");
  return profiles.map((item) => item.id === originalId ? profile : item);
}
