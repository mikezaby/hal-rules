import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { LockEntry } from "./skills.ts";

/** A variable value: a string, or a list rendered as markdown bullets. */
export type RuleVars = Record<string, string | string[]>;

/**
 * `"on"`, `"off"`, or a pair carrying variables. `["off", vars]` is allowed so a
 * disabled rule can keep its configuration ready to switch on.
 */
export type RuleState = "on" | "off" | ["on" | "off", RuleVars];

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
  /** `"github:owner/repo#ref"` -> skill paths as the source groups them. */
  skills?: Record<string, string[]>;
}

export interface ResolvedConfig {
  rulesDirs: string[];
  rules: Record<string, RuleState>;
  marketplaces: Record<string, unknown>;
  plugins: Record<string, PluginState>;
  mcp: Record<string, unknown>;
  settings: Record<string, unknown>;
  skills: Record<string, string[]>;
}

const CONFIG_KEYS = new Set([
  "extends",
  "rulesDir",
  "rules",
  "marketplaces",
  "plugins",
  "mcp",
  "settings",
  "skills",
]);

/** This package's own root, so the bundled pack is reachable with no install. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A path (`./base.json`, `/abs/base.json`) resolves against the config file.
 *
 * Anything else is a bare specifier: an installed package if there is one, and
 * otherwise the pack shipped inside this package. That fallback is what lets
 * `npx hal-rules` work in a repo with no node_modules. A Rails or Python
 * project has nowhere to install a pack.
 */
function resolveExtends(spec: string, base: string): string {
  if (spec.startsWith(".") || isAbsolute(spec)) return resolve(base, spec);
  try {
    return createRequire(join(base, "_.js")).resolve(spec);
  } catch {
    const [, ...rest] = spec.split("/");
    return resolve(PACKAGE_ROOT, ...rest);
  }
}

export const DEFAULT_CONFIG = "hal-rules.json";
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
    skills: {},
  };
  // A diamond or a cycle: the first load already applied it.
  if (loaded.has(path)) return out;
  loaded.add(path);

  let config: AiRulesConfig;
  try {
    config = JSON.parse(readFileSync(path, "utf8")) as AiRulesConfig;
  } catch (error) {
    // With extends chains, "which file" is the only useful part of the message.
    throw new Error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${path}: unknown key(s) ${unknown.join(", ")}\n  expected one of: ${[...CONFIG_KEYS].join(", ")}`,
    );
  }
  const base = dirname(path);
  for (const from of config.extends ?? []) {
    const inherited = loadConfig(resolveExtends(from, base), loaded);
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
  Object.assign(out.skills, from.skills ?? {});
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

export function applyVars(body: string, vars: RuleVars, slug: string): string {
  let out = body;
  for (const [name, value] of Object.entries(vars)) {
    if (value === "") {
      // A blank is what `sync` scaffolds; enabling the rule without filling it
      // in would silently render the sentence with a hole in it.
      throw new Error(
        `Rule "${slug}": {{${name}}} has no value.\n` +
          `  Fill it in, or set the rule to "off" until you have it.`,
      );
    }
    if (Array.isArray(value)) {
      // An empty list renders to nothing, leaving "all of these must pass"
      // followed by silence. That is a broken rule, not an empty one.
      if (value.length === 0) {
        throw new Error(
          `Rule "${slug}": {{${name}}} is an empty list.\n` +
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
      `Rule "${slug}" uses {{${unset}}} but no value was given.\n` +
        `  Set it: "${slug}": ["on", { "${unset}": "..." }]`,
    );
  }
  return out;
}

/** The header goes after any frontmatter, because YAML has to start at line 1. */
function withHeader(body: string, slug: string, source: string): string {
  // Relative, so output is identical on every machine. A path that climbs out of
  // the project (a pack in node_modules or elsewhere) is noise: drop it.
  const from = relative(process.cwd(), source);
  const note = from.startsWith("..")
    ? `<!-- generated from ${slug}. Edit it in the pack, then rerun hal -->`
    : `<!-- generated from ${slug} (${from}). Edit the source, then rerun hal -->`;
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (!frontmatter) return `${note}\n${body}`;
  return `${frontmatter[0]}${note}\n${body.slice(frontmatter[0].length)}`;
}

// `state` arrives from JSON, so it is unknown however the interface types it.
function stateOf(
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

/**
 * Everything wrong with the config, not just the first thing. Returns the files
 * to write so nothing is read twice.
 */
function plan(
  config: ResolvedConfig,
  outDir: string,
): {
  files: { path: string; content: string; slug: string }[];
  errors: string[];
} {
  const files: { path: string; content: string; slug: string }[] = [];
  const errors: string[] = [];

  for (const [slug, state] of Object.entries(config.rules)) {
    try {
      const [enabled, vars] = stateOf(slug, state);
      if (enabled === "off") continue;

      const source = findRule(slug, config.rulesDirs);
      const body = applyVars(readFileSync(source, "utf8"), vars, slug);
      files.push({
        path: join(outDir, `${slug}.md`),
        content: withHeader(body, slug, source),
        slug,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const [id, state] of Object.entries(config.plugins) as [
    string,
    unknown,
  ][]) {
    if (state !== "on" && state !== "off") {
      errors.push(
        `plugin "${id}" is set to ${JSON.stringify(state)}. Expected "on" or "off"`,
      );
    } else if (!id.includes("@")) {
      errors.push(
        `plugin "${id}" is not a plugin id. Expected "name@marketplace"`,
      );
    }
  }

  return { files, errors };
}

/** Every problem with the config, as a list. Empty means it will build. */
export function validate(configPath: string): string[] {
  return plan(loadConfig(configPath), ".").errors;
}

export interface Change {
  kind: "added" | "changed" | "removed";
  slug: string;
  before?: string;
  after?: string;
}

/**
 * What this run would alter, compared with what is already on disk. The previous
 * output is still there (gitignored, but present), so the tool can show what
 * moved without anyone committing derived files.
 */
function diffAgainstDisk(
  files: { path: string; content: string; slug: string }[],
  outDir: string,
): Change[] {
  // No previous output means nothing to compare, not "everything is new".
  if (!existsSync(outDir)) return [];

  const changes: Change[] = [];
  const expected = new Set(files.map(({ path }) => path));

  for (const { path, content, slug } of files) {
    if (!existsSync(path)) {
      changes.push({ kind: "added", slug, after: content });
      continue;
    }
    const before = readFileSync(path, "utf8");
    if (before !== content)
      changes.push({ kind: "changed", slug, before, after: content });
  }

  for (const rel of listMarkdown(outDir)) {
    const path = join(outDir, rel);
    if (!expected.has(path)) {
      changes.push({
        kind: "removed",
        slug: rel.replace(/\.md$/, ""),
        before: readFileSync(path, "utf8"),
      });
    }
  }
  return changes;
}

export function build(configPath: string, outDir: string): string[] {
  return buildWithChanges(configPath, outDir).written;
}

export function buildWithChanges(
  configPath: string,
  outDir: string,
): { written: string[]; changes: Change[] } {
  const { files, errors } = plan(loadConfig(configPath), outDir);

  // Resolve everything before touching disk: a config error must not leave the
  // previous output half-wiped and half-rewritten.
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} problem(s) in the config:\n  ${errors.join("\n  ")}`,
    );
  }

  const changes = diffAgainstDisk(files, outDir);

  rmSync(outDir, { recursive: true, force: true });
  for (const { path, content } of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { written: files.map(({ slug }) => slug), changes };
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
 * `/plugin install` do, and overwriting their work to assert a source of truth
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

export interface InitResult {
  path: string;
  status: "created" | "exists" | "updated";
}

const STARTER_CONFIG = {
  extends: ["hal-rules/recommended.json"],
  rulesDir: ["rules"],
};

/**
 * Every rule that needs a variable, scaffolded off but filled in. JSON has no
 * comments, so a worked example is the only way to show the shape. Without
 * this, enabling one of these is a build error rather than a rule.
 * Replace the values, then switch the ones you want to "on".
 */
const STARTER_RULES: Record<string, RuleState> = {
  "workflow/before-finish": [
    "off",
    { checks: ["pnpm tsc", "pnpm lint", "pnpm test"] },
  ],
  "workflow/out-of-scope-findings": [
    "off",
    { findingsFile: "docs/findings.md" },
  ],
  "documentation/architecture-decisions": ["off", { adrDir: "docs/adr/" }],
};

/** Adds a line to .gitignore unless it is already there. */
function ignore(path: string, entry: string): InitResult {
  if (!existsSync(path)) {
    writeFileSync(path, `${entry}\n`);
    return { path, status: "created" };
  }

  const current = readFileSync(path, "utf8");
  if (current.split("\n").some((line) => line.trim() === entry)) {
    return { path, status: "exists" };
  }
  writeFileSync(
    path,
    current.endsWith("\n") ? `${current}${entry}\n` : `${current}\n${entry}\n`,
  );
  return { path, status: "updated" };
}

/**
 * Scaffold a config. Never overwrites one that exists, because an existing config is
 * the team's, and re-running init must not be a way to lose it.
 *
 * `expand` writes the inherited rules out as explicit entries so they can be
 * read and toggled without opening node_modules. The trade-off is real: an
 * expanded config pins today's set, so rules added to the pack later will not
 * switch themselves on.
 */
export function init(projectDir = ".", { expand = false } = {}): InitResult[] {
  const config = join(projectDir, DEFAULT_CONFIG);
  const results: InitResult[] = [];

  if (existsSync(config)) {
    results.push({ path: config, status: "exists" });
  } else {
    const starter: {
      extends: string[];
      rulesDir: string[];
      rules: Record<string, RuleState>;
    } = {
      ...STARTER_CONFIG,
      rules: { ...STARTER_RULES },
    };
    if (expand) {
      const base = resolveExtends(starter.extends[0] ?? "", projectDir);
      // Nothing to expand before the pack is installed; a bare config still works.
      if (existsSync(base))
        Object.assign(starter.rules, loadConfig(base).rules);
    }
    writeFileSync(config, `${JSON.stringify(starter, null, 2)}\n`);
    results.push({ path: config, status: "created" });
  }

  results.push(ignore(join(projectDir, ".gitignore"), `${DEFAULT_OUT}/`));
  return results;
}

export const LOCK_FILE = "hal-rules.lock.json";

interface Lock {
  skills: Record<string, LockEntry>;
}

export function readLock(projectDir = "."): Lock {
  const path = join(projectDir, LOCK_FILE);
  if (!existsSync(path)) return { skills: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Lock;
}

export function writeLock(lock: Lock, projectDir = "."): void {
  const path = join(projectDir, LOCK_FILE);
  // Nothing tracked and nothing to track: don't leave an empty file behind.
  if (Object.keys(lock.skills).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}

export interface CheckProblem {
  what: string;
  fix: string;
}

/**
 * Read-only. Generates into a temp directory and compares, so a check can never
 * write into the repository it is checking.
 */
export function check(
  configPath = DEFAULT_CONFIG,
  projectDir = ".",
  outDir = DEFAULT_OUT,
): CheckProblem[] {
  const problems: CheckProblem[] = [];

  const invalid = validate(configPath);
  if (invalid.length > 0) {
    // A config that cannot resolve makes every later comparison meaningless.
    return invalid.map((what) => ({ what, fix: "fix hal-rules.json" }));
  }

  const config = loadConfig(configPath);
  const expectedDir = mkdtempSync(join(tmpdir(), "hal-check-"));
  try {
    build(configPath, expectedDir);
    const expected = new Map(
      listMarkdown(expectedDir).map((rel) => [
        rel,
        readFileSync(join(expectedDir, rel), "utf8"),
      ]),
    );
    const actualRoot = join(projectDir, outDir);
    // Nothing generated at all is one fact, not one per rule.
    if (!existsSync(actualRoot)) {
      problems.push({
        what: `nothing generated yet (${expected.size} rules expected)`,
        fix: "run: npx hal-rules",
      });
      return problems;
    }
    const actual = new Map(
      listMarkdown(actualRoot).map((rel) => [
        rel,
        readFileSync(join(actualRoot, rel), "utf8"),
      ]),
    );

    for (const [rel, body] of expected) {
      if (!actual.has(rel))
        problems.push({
          what: `missing rule: ${rel}`,
          fix: "run: npx hal-rules",
        });
      else if (actual.get(rel) !== body)
        problems.push({
          what: `out of date: ${rel}`,
          fix: "run: npx hal-rules",
        });
    }
    for (const rel of actual.keys()) {
      if (!expected.has(rel)) {
        problems.push({
          what: `stale rule still on disk: ${rel}`,
          fix: "run: npx hal-rules",
        });
      }
    }
  } finally {
    rmSync(expectedDir, { recursive: true, force: true });
  }

  problems.push(...checkSkills(config, projectDir));

  for (const result of bootstrap(config, projectDir)) {
    for (const entry of result.missing) {
      problems.push({
        what: `${result.path} lacks declared entry: ${entry}`,
        fix: "add it by hand, or delete the file and rerun to regenerate it",
      });
    }
  }
  return problems;
}

/** Config, lock and disk must agree. No network: refetching in CI is slow and flaky. */
function checkSkills(
  config: ResolvedConfig,
  projectDir: string,
): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const locked = readLock(projectDir).skills;
  const wanted = new Set(Object.values(config.skills).flat());

  const lockedPaths = new Map(
    Object.entries(locked).map(([name, entry]) => [
      entry.path.replace(/^skills\//, ""),
      name,
    ]),
  );
  for (const path of wanted) {
    if (!lockedPaths.has(path)) {
      problems.push({
        what: `skill declared but not installed: ${path}`,
        fix: "run: npx hal-rules",
      });
    }
  }
  for (const [path, name] of lockedPaths) {
    if (!wanted.has(path)) {
      problems.push({
        what: `skill installed but no longer declared: ${name}`,
        fix: "run: npx hal-rules",
      });
    } else if (
      !existsSync(join(projectDir, ".claude/skills", name, "SKILL.md"))
    ) {
      problems.push({
        what: `skill in the lock but missing on disk: ${name}`,
        fix: "run: npx hal-rules (skills are committed, so this should not happen)",
      });
    }
  }
  return problems;
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => rel.split(sep).join("/"))
    .sort();
}

/**
 * A line-level diff with the common prefix and suffix trimmed. Deliberately not
 * an LCS: rule files are small and change in whole paragraphs, and this needs no
 * git, no `diff` binary and no dependency.
 */
export function formatDiff(change: Change): string {
  const before = (change.before ?? "").split("\n");
  const after = (change.after ?? "").split("\n");

  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head++;

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);
  const lines = [
    ...removed.map((line) => `  - ${line}`),
    ...added.map((line) => `  + ${line}`),
  ];
  return lines.length > 0 ? lines.join("\n") : "  (no textual change)";
}

export function summarise(changes: Change[]): string[] {
  const mark = { added: "+", changed: "~", removed: "-" } as const;
  return changes
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(({ kind, slug }) => `  ${mark[kind]} ${slug}`);
}

export interface Available {
  slug: string;
  /** Variables the rule needs, so `sync` can scaffold placeholders. */
  vars: string[];
}

/**
 * Rules that exist in a pack but appear nowhere in the config, neither on nor
 * off. A sparse config inherits new pack rules automatically, but an expanded
 * one pins today's list, and nothing otherwise tells you a rule shipped.
 */
export function outdated(configPath = DEFAULT_CONFIG): Available[] {
  const config = loadConfig(configPath);
  const known = new Set(Object.keys(config.rules));
  const found = new Map<string, Available>();

  for (const dir of config.rulesDirs) {
    if (!existsSync(dir)) continue;
    for (const rel of listMarkdown(dir)) {
      const slug = rel.replace(/\.md$/, "");
      if (known.has(slug) || found.has(slug)) continue;
      const body = readFileSync(join(dir, rel), "utf8");
      found.set(slug, {
        slug,
        vars: [
          ...new Set(
            [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ""),
          ),
        ],
      });
    }
  }
  return [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Adds the rules `outdated` found to the project's own config as `"off"`, so
 * adopting one stays a deliberate edit rather than something that switches
 * itself on. Only the project's file is touched, never an inherited pack.
 */
export function sync(configPath = DEFAULT_CONFIG): Available[] {
  const additions = outdated(configPath);
  if (additions.length === 0) return [];

  const path = resolve(configPath);
  const raw = JSON.parse(readFileSync(path, "utf8")) as AiRulesConfig;
  const rules: Record<string, RuleState> = { ...(raw.rules ?? {}) };

  for (const { slug, vars } of additions) {
    if (vars.length === 0) {
      rules[slug] = "off";
      continue;
    }
    // Reuse init's worked examples where we have them, so a list-valued
    // variable is scaffolded as a list rather than a misleading empty string.
    const example = STARTER_RULES[slug];
    rules[slug] = Array.isArray(example)
      ? ["off", example[1]]
      : ["off", Object.fromEntries(vars.map((name) => [name, ""]))];
  }
  raw.rules = rules;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  return additions;
}
