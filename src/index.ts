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

/** A plugin is on or off; there is nothing to tune. */
export type PluginState = "on" | "off";

export interface AiRulesConfig {
  extends?: string[];
  rulesDir?: string[];
  rules?: Record<string, RuleState>;
  /** Marketplace name -> `{ source: { ... } }`, verbatim into settings.json. */
  marketplaces?: Record<string, unknown>;
  /** `"plugin@marketplace"` -> on/off. */
  plugins?: Record<string, PluginState>;
  /** Server name -> server config, verbatim into .mcp.json. */
  mcp?: Record<string, unknown>;
  /** Copied into settings.json as-is, so no Claude Code setting needs modelling here. */
  settings?: Record<string, unknown>;
}

export interface ResolvedConfig {
  rulesDirs: string[];
  rules: Record<string, RuleState>;
  marketplaces: Record<string, unknown>;
  plugins: Record<string, PluginState>;
  mcp: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export const DEFAULT_CONFIG = "ai-rules.json";
export const DEFAULT_OUT = ".claude/rules/generated";

/** Later configs win, exactly like eslint: extends first, own `rules` last. */
export function loadConfig(
  file: string,
  loaded = new Set<string>(),
): ResolvedConfig {
  const path = resolve(file);
  const out: ResolvedConfig = {
    rulesDirs: [],
    rules: {},
    marketplaces: {},
    plugins: {},
    mcp: {},
    settings: {},
  };
  // A diamond or a cycle: the first load already applied it.
  if (loaded.has(path)) return out;
  loaded.add(path);

  const config = JSON.parse(readFileSync(path, "utf8")) as AiRulesConfig;
  const base = dirname(path);
  for (const from of config.extends ?? []) {
    const inherited = loadConfig(resolve(base, from), loaded);
    out.rulesDirs.push(...inherited.rulesDirs);
    merge(out, inherited);
  }
  out.rulesDirs.push(
    ...(config.rulesDir ?? ["rules"]).map((dir) => resolve(base, dir)),
  );
  merge(out, config);
  return out;
}

/** Every declaration kind composes the way rules do: later wins. */
function merge(
  out: ResolvedConfig,
  from: AiRulesConfig | ResolvedConfig,
): void {
  Object.assign(out.rules, from.rules ?? {});
  Object.assign(out.marketplaces, from.marketplaces ?? {});
  Object.assign(out.plugins, from.plugins ?? {});
  Object.assign(out.mcp, from.mcp ?? {});
  Object.assign(out.settings, from.settings ?? {});
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
  // Relative, so output is identical on every machine. A path that climbs out of
  // the project (a pack in node_modules or elsewhere) is noise: drop it.
  const from = relative(process.cwd(), source);
  const note = from.startsWith("..")
    ? `<!-- generated from ${slug} — edit it in the pack, then rerun ai-rules -->`
    : `<!-- generated from ${slug} (${from}) — edit the source, then rerun ai-rules -->`;
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

export interface BootstrapResult {
  path: string;
  status: "created" | "exists" | "empty";
  /** Declared entries the existing file does not have. Reported, never merged. */
  missing: string[];
}

/** Flatten one level: `enabledPlugins.figma@official`, so drift names a real entry. */
function entries(shape: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) out.push(`${key}.${inner}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

function has(file: Record<string, unknown>, entry: string): boolean {
  const [key, inner] = entry.split(".");
  if (key === undefined) return false;
  const value = file[key];
  if (inner === undefined) return key in file;
  return typeof value === "object" && value !== null && inner in value;
}

/**
 * Write the file if it is absent, otherwise leave it alone and report what it
 * lacks. Claude Code never writes .claude/settings.json itself, but people and
 * `/plugin install` do — overwriting their work to assert a source of truth
 * would cost more than it buys. Merging is a decision still to be made.
 */
function bootstrapFile(
  path: string,
  desired: Record<string, unknown>,
): BootstrapResult {
  if (Object.keys(desired).length === 0)
    return { path, status: "empty", missing: [] };

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(desired, null, 2)}\n`);
    return { path, status: "created", missing: [] };
  }

  const current = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  return {
    path,
    status: "exists",
    missing: entries(desired).filter((entry) => !has(current, entry)),
  };
}

function desiredSettings(config: ResolvedConfig): Record<string, unknown> {
  // Passthrough first, so a computed key always wins over a hand-written one.
  const out: Record<string, unknown> = { ...config.settings };

  if (Object.keys(config.marketplaces).length > 0) {
    out.extraKnownMarketplaces = config.marketplaces;
  }
  const plugins = Object.entries(config.plugins);
  if (plugins.length > 0) {
    // The shape is an object of booleans; `false` actively disables, so keep it.
    out.enabledPlugins = Object.fromEntries(
      plugins.map(([id, on]) => [id, on === "on"]),
    );
  }
  return out;
}

export function bootstrap(
  config: ResolvedConfig,
  projectDir = ".",
): BootstrapResult[] {
  const mcp =
    Object.keys(config.mcp).length > 0 ? { mcpServers: config.mcp } : {};
  return [
    bootstrapFile(
      join(projectDir, ".claude/settings.json"),
      desiredSettings(config),
    ),
    bootstrapFile(join(projectDir, ".mcp.json"), mcp),
  ];
}
