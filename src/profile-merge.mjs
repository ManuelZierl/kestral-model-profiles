import { profilesFromConfig } from "./profile-model.mjs";

// Compare the canonical fields, independently of host JSON object key order.
function sameProfile(left, right) {
  const fields = (profile) => profile === undefined ? null : [
    profile.id, profile.title, profile.description, profile.connector_id,
    profile.model, profile.reasoning, profile.temperature, profile.max_output_tokens,
    profile.tools, profile.prompt.layer_ids, profile.prompt.custom_texts,
  ];
  return JSON.stringify(fields(left)) === JSON.stringify(fields(right));
}

// Rebase ONE intended change on a fresh host snapshot. This detects already
// visible conflicts, not writes racing after the read: atomic CAS needs a host API.
export function mergeProfileChange(previous, proposed, current, id) {
  const before = previous.find((profile) => profile.id === id);
  const after = proposed.find((profile) => profile.id === id);
  const latest = current.find((profile) => profile.id === id);
  if (!before && !after) throw new Error("The profile change has no target.");
  if (!sameProfile(before, latest)) {
    // A timed-out write may already have succeeded. Retrying it must not lose
    // other profiles or duplicate the intended profile.
    if (sameProfile(after, latest)) return current;
    throw new Error(`Profile '${id}' changed in another editor or was deleted. Reopen Model Profiles and review the current library before saving.`);
  }
  const merged = after
    ? before
      ? current.map((profile) => profile.id === id ? after : profile)
      : [...current, after]
    : current.filter((profile) => profile.id !== id);
  return profilesFromConfig({ profiles: merged });
}
