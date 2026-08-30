/** Shared by rules and skills: both take "on", "off", or ["on", { var: "value" }]. */
export type RuleVars = Record<string, string | string[]>;

export function applyVars(body: string, vars: RuleVars, slug: string): string {
  let out = body;
  for (const [name, value] of Object.entries(vars)) {
    if (value === "") {
      // A blank is what `sync` scaffolds; enabling the rule without filling it
      // in would silently render the sentence with a hole in it.
      throw new Error(
        `"${slug}": {{${name}}} has no value.\n` +
          `  Fill it in, or set the rule to "off" until you have it.`,
      );
    }
    if (Array.isArray(value)) {
      // An empty list renders to nothing, leaving "all of these must pass"
      // followed by silence. That is a broken rule, not an empty one.
      if (value.length === 0) {
        throw new Error(
          `"${slug}": {{${name}}} is an empty list.\n` +
            `  Fill it in, or set the rule to "off" until you have the values.`,
        );
      }
      out = out.replaceAll(
        `{{${name}}}`,
        value.map((item) => `- \`${item}\``).join("\n"),
      );
      continue;
    }
    out = out.replaceAll(`{{${name}}}`, value);
  }

  const [, unset] = /\{\{(\w+)\}\}/.exec(out) ?? [];
  // Shipping a literal "{{framework}}" to Claude as an instruction is worse than failing.
  if (unset) {
    throw new Error(
      `"${slug}" uses {{${unset}}} but no value was given.\n` +
        `  Set it: "${slug}": ["on", { "${unset}": "..." }]`,
    );
  }
  return out;
}

// `state` arrives from JSON, so it is unknown however the interface types it.
export function stateOf(
  slug: string,
  state: unknown,
): [enabled: string, vars: RuleVars] {
  if (state === "on" || state === "off") return [state, {}];
  if (
    Array.isArray(state) &&
    (state[0] === "on" || state[0] === "off") &&
    typeof state[1] === "object" &&
    state[1] !== null
  ) {
    return state as [string, RuleVars];
  }
  throw new Error(
    `"${slug}" is set to ${JSON.stringify(state)}. Expected "on", "off", or ["on", { var: "value" }]`,
  );
}
