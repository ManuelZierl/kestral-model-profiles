export const APP_ID = "com.ma-zierl.kestral-model-profiles";

const requiredTrimmedText = (maxLength) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: "^\\S(?:[\\s\\S]*\\S)?$",
});

const optionalTrimmedText = (maxLength) => ({
  type: "string",
  maxLength,
  pattern: "^(?:|\\S(?:[\\s\\S]*\\S)?)$",
});

const profileProperties = {
  id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  title: requiredTrimmedText(120),
  description: optionalTrimmedText(1000),
  connector_id: requiredTrimmedText(256),
  model: requiredTrimmedText(256),
  reasoning: { type: ["string", "null"], enum: ["minimal", "low", "medium", "high", "xhigh", "max", null] },
  temperature: { type: ["number", "null"], minimum: 0, maximum: 2 },
  max_output_tokens: { type: ["integer", "null"], minimum: 1, maximum: 1000000 },
  tools: { type: "array", maxItems: 64, uniqueItems: true, items: { type: "string", minLength: 3, maxLength: 257, pattern: "^[^/\\s]+/[^/\\s]+$" } },
  prompt: {
    type: "object",
    additionalProperties: false,
    required: ["layer_ids", "custom_texts"],
    properties: {
      layer_ids: { type: "array", maxItems: 64, uniqueItems: true, items: { ...requiredTrimmedText(256), not: { const: "protocol" } } },
      custom_texts: { type: "array", maxItems: 8, items: requiredTrimmedText(16384) },
    },
  },
};

export const profileSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(profileProperties),
  properties: profileProperties,
};

export const modelProfilesConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profiles"],
  properties: { profiles: { type: "array", maxItems: 64, items: profileSchema } },
};

export function manifestFor(uiDigest, appVersion) {
  return {
    format_version: 1,
    id: APP_ID,
    version: appVersion,
    display_name: "Model Profiles",
    description: "Save reusable model, prompt, generation, and tool configurations for Chat.",
    publisher: { name: "Kestral reference apps" },
    license: "MIT",
    icon: { kind: "kestral", name: "settings" },
    min_host_version: "0.1.0-alpha.1",
    manifest: {
      capabilities: [],
      surfaces: [{
        name: "model-profiles",
        kind: "dashboard",
        title: "Model Profiles",
        description: "Create and maintain reusable model and prompt setups for Chat.",
        intents: [],
        ui: { entry: "ui/index.html" },
      }],
      config_declarations: [{
        name: "model-profiles",
        title: "Model profiles",
        description: "Reusable model, prompt, generation, and tool configurations selected in Chat.",
        json_schema: modelProfilesConfigSchema,
        default: { profiles: [] },
      }],
      extension_contributions: [{
        target_app: "chat",
        extension_point: "model-profile-editor",
        contract_version: 1,
        surface: "model-profiles",
      }],
      grant_requests: [],
    },
    backend: { kind: "none" },
    data: { kind: "none" },
    integrity: { algorithm: "sha256", assets: { "ui/index.html": uiDigest } },
  };
}
