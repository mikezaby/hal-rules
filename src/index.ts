import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** `"on"`, `"off"`, or `["on", { varName: value }]`. */
export type RuleState = "on" | "off" | ["on", Record<string, string>];

export interface AiRulesConfig {
  extends?: string[];
  rulesDir?: string[];
  rules?: Record<string, RuleState>;
}

export interface ResolvedConfig {
  rulesDirs: string[];
  rules: Record<string, RuleState>;
}

export const DEFAULT_CONFIG = "ai-rules.json";
export const DEFAULT_OUT = ".claude/rules/generated";

/** Later configs win, exactly like eslint: extends first, own `rules` last. */
export function loadConfig(
  file: string,
  loaded = new Set<string>(),
): ResolvedConfig {
  const path = resolve(file);
  const out: ResolvedConfig = { rulesDirs: [], rules: {} };
  // A diamond or a cycle: the first load already applied it.
  if (loaded.has(path)) return out;
  loaded.add(path);

  const config = JSON.parse(readFileSync(path, "utf8")) as AiRulesConfig;
  const base = dirname(path);
  for (const from of config.extends ?? []) {
    const inherited = loadConfig(resolve(base, from), loaded);
    out.rulesDirs.push(...inherited.rulesDirs);
    Object.assign(out.rules, inherited.rules);
  }
  out.rulesDirs.push(
    ...(config.rulesDir ?? ["rules"]).map((dir) => resolve(base, dir)),
  );
  Object.assign(out.rules, config.rules ?? {});
  return out;
}

/** Last dir wins, so a project shadows a pack's rule by slug. */
function findRule(slug: string, dirs: string[]): string {
  const search = [...dirs].reverse();
  for (const dir of search) {
    const path = join(dir, `${slug}.md`);
    if (existsSync(path)) return path;
  }
  throw new Error(
    `Rule not found: ${slug}\n  looked in:\n    ${search.join("\n    ")}`,
  );
}

export function applyVars(
  body: string,
  vars: Record<string, string>,
  slug: string,
): string {
  let out = body;
  for (const [name, value] of Object.entries(vars))
    out = out.replaceAll(`{{${name}}}`, value);

  const [, unset] = /\{\{(\w+)\}\}/.exec(out) ?? [];
  // Shipping a literal "{{framework}}" to Claude as an instruction is worse than failing.
  if (unset) {
    throw new Error(
      `Rule "${slug}" uses {{${unset}}} but no value was given.\n` +
        `  Set it: "${slug}": ["on", { "${unset}": "..." }]`,
    );
  }
  return out;
}

/** The header goes after any frontmatter — YAML has to start at line 1. */
function withHeader(body: string, slug: string, source: string): string {
  // Relative, so the output is identical on every machine.
  const from = relative(process.cwd(), source);
  const note = `<!-- generated from ${slug} (${from}) — edit the source, then rerun ai-rules -->`;
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (!frontmatter) return `${note}\n${body}`;
  return `${frontmatter[0]}${note}\n${body.slice(frontmatter[0].length)}`;
}

export function build(configPath: string, outDir: string): string[] {
  const { rulesDirs, rules } = loadConfig(configPath);
  rmSync(outDir, { recursive: true, force: true });

  const written: string[] = [];
  for (const [slug, state] of Object.entries(rules)) {
    const [enabled, vars] = Array.isArray(state) ? state : [state, {}];
    if (enabled === "off") continue;

    const source = findRule(slug, rulesDirs);
    const body = applyVars(readFileSync(source, "utf8"), vars, slug);
    const dest = join(outDir, `${slug}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, withHeader(body, slug, source));
    written.push(slug);
  }
  return written;
}
