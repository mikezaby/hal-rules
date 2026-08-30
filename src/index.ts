import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtendsEntry } from "./packs.ts";
import { PACK_DIR, SKILLS_DIR, collectPacks, resolveExtends } from "./packs.ts";
import type { FetchedEntry, LockEntry, SkillState } from "./skills.ts";
import { findSkill, indexSkills, isSource } from "./skills.ts";
import type { RuleVars } from "./vars.ts";
import { applyVars, stateOf } from "./vars.ts";

/** A variable value: a string, or a list rendered as markdown bullets. */
export type { RuleVars } from "./vars.ts";
export { applyVars } from "./vars.ts";

/**
 * `"on"`, `"off"`, or a pair carrying variables. `["off", vars]` is allowed so a
 * disabled rule can keep its configuration ready to switch on.
 */
export type RuleState = "on" | "off" | ["on" | "off", RuleVars];

/** A plugin is on or off; there is nothing to tune. */
export type PluginState = "on" | "off";

export interface AiRulesConfig {
  extends?: ExtendsEntry[];
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
  /**
   * Two shapes on one key. A `github:owner/repo#ref` key maps to skill paths as
   * the source groups them. Any other key is a slug under a registry's `skills/`
   * directory, on or off the way a rule is.
   */
  skills?: Record<string, string[] | SkillState>;
}

export interface ResolvedConfig {
  rulesDirs: string[];
  skillsDirs: string[];
  rules: Record<string, RuleState>;
  marketplaces: Record<string, unknown>;
  plugins: Record<string, PluginState>;
  mcp: Record<string, unknown>;
  settings: Record<string, unknown>;
  skills: Record<string, string[] | SkillState>;
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

export const DEFAULT_CONFIG = "hal-rules.json";
export const DEFAULT_OUT = ".claude/rules/generated";

/** Later configs win, exactly like eslint: extends first, own `rules` last. */
export function loadConfig(
  file: string,
  loaded = new Set<string>(),
  projectDir = dirname(resolve(file)),
): ResolvedConfig {
  const path = resolve(file);
  const out: ResolvedConfig = {
    rulesDirs: [],
    skillsDirs: [],
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
    const inherited = loadConfig(
      resolveExtends(from, base, projectDir),
      loaded,
      projectDir,
    );
    out.rulesDirs.push(...inherited.rulesDirs);
    out.skillsDirs.push(...inherited.skillsDirs);
    merge(out, inherited);
  }
  // A declared rulesDir that is missing stays an error worth seeing; the
  // implicit default is a guess, so it only counts when it is really there.
  const declared = config.rulesDir;
  const dirs = (declared ?? ["rules"]).map((dir) => resolve(base, dir));
  out.rulesDirs.push(
    ...(declared ? dirs : dirs.filter((dir) => existsSync(dir))),
  );
  // Skill bodies have no declared form: a `skills/` beside the config counts
  // when it is there, which is how a registry contributes its own.
  const skillsDir = resolve(base, SKILLS_DIR);
  if (existsSync(skillsDir)) out.skillsDirs.push(skillsDir);
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

  for (const [key, state] of Object.entries(config.skills)) {
    if (isSource(key)) {
      if (!Array.isArray(state)) {
        errors.push(
          `skill source "${key}" is set to ${JSON.stringify(state)}. Expected a list of skill paths`,
        );
      }
      continue;
    }
    try {
      const [enabled, vars] = stateOf(key, state);
      if (enabled === "off") continue;
      const dir = findSkill(key, config.skillsDirs);
      applyVars(readFileSync(join(dir, "SKILL.md"), "utf8"), vars, key);
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

/**
 * An `mcp.json` beside a skill's SKILL.md names the servers it needs, keyed
 * by var then value: `{ "tracker": { "linear": { "linear": {...} } } }`.
 * The project's own `mcp` entries win over anything a skill brings.
 */
function skillMcp(config: ResolvedConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [slug, state] of Object.entries(config.skills)) {
    if (isSource(slug)) continue;
    const [enabled, vars] = stateOf(slug, state);
    if (enabled !== "on") continue;
    const file = join(findSkill(slug, config.skillsDirs), "mcp.json");
    if (!existsSync(file)) continue;
    const byVar = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    for (const [name, byValue] of Object.entries(byVar)) {
      const value = vars[name];
      if (typeof value === "string") Object.assign(out, byValue[value] ?? {});
    }
  }
  return out;
}

export function bootstrap(
  config: ResolvedConfig,
  projectDir = ".",
): BootstrapResult[] {
  const servers = { ...skillMcp(config), ...config.mcp };
  const mcp = Object.keys(servers).length > 0 ? { mcpServers: servers } : {};
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
  // A registry, so the rules/ convention supplies the bodies and a project
  // needs no rulesDir until it writes rules of its own.
  extends: [{ registry: "hal-rules" }],
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
      extends: ExtendsEntry[];
      rules: Record<string, RuleState>;
    } = {
      ...STARTER_CONFIG,
      rules: { ...STARTER_RULES },
    };
    if (expand) {
      // Nothing to expand before the pack is there; a bare config still works.
      // A bundled or installed pack resolves to a path that may not exist; an
      // unfetched `github:` one throws, and means the same thing here.
      try {
        const first = starter.extends[0];
        const base =
          first === undefined
            ? ""
            : resolveExtends(first, projectDir, projectDir);
        if (existsSync(base))
          Object.assign(starter.rules, loadConfig(base).rules);
      } catch {
        // Left to the first build, which fetches the pack and reports properly.
      }
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
  packs: Record<string, FetchedEntry>;
}

export function readLock(projectDir = "."): Lock {
  const path = join(projectDir, LOCK_FILE);
  if (!existsSync(path)) return { skills: {}, packs: {} };
  const lock = JSON.parse(readFileSync(path, "utf8")) as Partial<Lock>;
  // A lock written before packs existed has no such key.
  return { skills: lock.skills ?? {}, packs: lock.packs ?? {} };
}

export function writeLock(lock: Partial<Lock>, projectDir = "."): void {
  const path = join(projectDir, LOCK_FILE);
  const skills = lock.skills ?? {};
  const packs = lock.packs ?? {};
  // Nothing tracked and nothing to track: don't leave an empty file behind.
  if (Object.keys(skills).length === 0 && Object.keys(packs).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  // An empty section is noise in a file people read during review.
  const written = {
    ...(Object.keys(packs).length > 0 ? { packs } : {}),
    ...(Object.keys(skills).length > 0 ? { skills } : {}),
  };
  writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
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

  // Packs first: an unfetched one makes every rule below it look like drift.
  const lockedPacks = readLock(projectDir).packs;
  for (const pack of collectPacks(configPath, projectDir)) {
    if (!existsSync(pack.dir)) {
      problems.push({
        what: `pack ${pack.spec} is not fetched (no ${PACK_DIR}/${pack.source.owner}-${pack.source.repo})`,
        fix: "run: npx hal-rules@latest",
      });
    } else if (!lockedPacks[pack.spec]) {
      problems.push({
        what: `pack ${pack.spec} is on disk but absent from ${LOCK_FILE}`,
        fix: "run: npx hal-rules@latest",
      });
    }
  }
  if (problems.length > 0) return problems;

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
        fix: "run: npx hal-rules@latest",
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
          fix: "run: npx hal-rules@latest",
        });
      else if (actual.get(rel) !== body)
        problems.push({
          what: `out of date: ${rel}`,
          fix: "run: npx hal-rules@latest",
        });
    }
    for (const rel of actual.keys()) {
      if (!expected.has(rel)) {
        problems.push({
          what: `stale rule still on disk: ${rel}`,
          fix: "run: npx hal-rules@latest",
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
  const wanted = new Set<string>();
  for (const [key, state] of Object.entries(config.skills)) {
    if (isSource(key)) for (const path of state as string[]) wanted.add(path);
    else if (stateOf(key, state)[0] === "on") wanted.add(key);
  }

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
        fix: "run: npx hal-rules@latest",
      });
    }
  }
  for (const [path, name] of lockedPaths) {
    if (!wanted.has(path)) {
      problems.push({
        what: `skill installed but no longer declared: ${name}`,
        fix: "run: npx hal-rules@latest",
      });
    } else if (
      !existsSync(join(projectDir, ".claude/skills", name, "SKILL.md"))
    ) {
      problems.push({
        what: `skill in the lock but missing on disk: ${name}`,
        fix: "run: npx hal-rules@latest (skills are committed, so this should not happen)",
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
  /** What the config says, or "unset" when it never mentions the slug. */
  state: "on" | "off" | "unset";
  /** Variables the rule needs, so `sync` can scaffold placeholders. */
  vars: string[];
}

const varsIn = (body: string): string[] => [
  ...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "")),
];

const stateIn = (
  config: Record<string, unknown>,
  slug: string,
): Available["state"] =>
  slug in config ? (stateOf(slug, config[slug])[0] as "on" | "off") : "unset";

/**
 * Every rule and skill the packs and the project's own dirs offer, with what
 * the config says about each. A later dir shadows an earlier one, as in a build.
 */
export function available(configPath = DEFAULT_CONFIG): {
  rules: Available[];
  skills: Available[];
} {
  const config = loadConfig(configPath);
  const rules = new Map<string, Available>();
  const skills = new Map<string, Available>();

  for (const dir of config.rulesDirs) {
    if (!existsSync(dir)) continue;
    for (const rel of listMarkdown(dir)) {
      const slug = rel.replace(/\.md$/, "");
      rules.set(slug, {
        slug,
        state: stateIn(config.rules, slug),
        vars: varsIn(readFileSync(join(dir, rel), "utf8")),
      });
    }
  }
  for (const dir of config.skillsDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of new Set(indexSkills(dir).values())) {
      const body = readFileSync(join(dir, entry.repoPath, "SKILL.md"), "utf8");
      skills.set(entry.path, {
        slug: entry.path,
        state: stateIn(config.skills, entry.path),
        vars: varsIn(body),
      });
    }
  }
  const sorted = (found: Map<string, Available>) =>
    [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  return { rules: sorted(rules), skills: sorted(skills) };
}

export interface Toggle extends Available {
  kind: "rules" | "skills";
  /** Variables the file uses that the config has no non-blank value for. */
  missing: string[];
}

/** The rule or skill a slug names, or an error listing what it could be. */
export function findAvailable(configPath: string, slug: string): Toggle {
  const { rules, skills } = available(configPath);
  const kind = rules.some((r) => r.slug === slug)
    ? "rules"
    : skills.some((s) => s.slug === slug)
      ? "skills"
      : undefined;
  if (kind === undefined) {
    const near = [...rules, ...skills]
      .map((i) => i.slug)
      .filter((s) => s.endsWith(`/${slug}`) || s.includes(slug));
    throw new Error(
      `"${slug}" is not a rule or skill in your packs.` +
        (near.length > 0
          ? `\n  Did you mean: ${near.join(", ")}`
          : "\n  See what is on offer: npx hal-rules@latest list"),
    );
  }
  const item = (kind === "rules" ? rules : skills).find((i) => i.slug === slug);
  if (item === undefined) throw new Error(`"${slug}" vanished mid-lookup`);
  const raw = readRaw(configPath);
  const [, given] = stateOf(slug, raw[kind]?.[slug] ?? "off");
  const missing = item.vars.filter((name) => {
    const value = given[name];
    return value === undefined || value === "" || value.length === 0;
  });
  return { ...item, kind, missing };
}

/** A variable `init` scaffolds as a list is entered comma separated. */
export function isListVar(slug: string, name: string): boolean {
  const example = STARTER_RULES[slug];
  return Array.isArray(example) && Array.isArray(example[1][name]);
}

const readRaw = (configPath: string): AiRulesConfig =>
  JSON.parse(readFileSync(resolve(configPath), "utf8")) as AiRulesConfig;

/**
 * Switches one rule or skill in the project's own config, keeping any vars
 * already there so a disabled entry re-enables without being asked again.
 * A value for a variable that `init` scaffolds as a list is split on commas.
 */
export function setState(
  configPath: string,
  item: Toggle,
  state: "on" | "off",
  values: Record<string, string> = {},
): void {
  const path = resolve(configPath);
  const raw = readRaw(path);
  const [, existing] = stateOf(item.slug, raw[item.kind]?.[item.slug] ?? "off");
  const vars: RuleVars = { ...existing };
  for (const [name, value] of Object.entries(values)) {
    vars[name] = isListVar(item.slug, name)
      ? value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : value;
  }
  const entry: RuleState = Object.keys(vars).length > 0 ? [state, vars] : state;
  if (item.kind === "rules") raw.rules = { ...raw.rules, [item.slug]: entry };
  else raw.skills = { ...raw.skills, [item.slug]: entry };
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}

/**
 * Rules that exist in a pack but appear nowhere in the config, neither on nor
 * off. A sparse config inherits new pack rules automatically, but an expanded
 * one pins today's list, and nothing otherwise tells you a rule shipped.
 */
export function outdated(configPath = DEFAULT_CONFIG): Available[] {
  return available(configPath).rules.filter((r) => r.state === "unset");
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
