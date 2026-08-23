import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiRulesConfig } from "./index.ts";
import { type LockEntry, type Source, download, resolveSha } from "./skills.ts";

/** Committed, not gitignored: a pack is not reproducible from anything local. */
export const PACK_DIR = ".hal/packs";

/** This package's own root, so the bundled pack is reachable with no install. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where the pack lives in this repo, kept apart from the generator's code. */
const REGISTRY_DIR = "registry";

/** A registry holds its rule bodies here. Convention, not configuration. */
export const RULES_DIR = "rules";

/** The preset a registry offers when none is named. */
export const DEFAULT_PRESET = "recommended";

/**
 * A registry plus which preset to take from it. The registry is a directory —
 * a path, or a `github:owner/repo` fetched into the pack cache — holding
 * `<preset>.json` and a `rules/` directory.
 */
export interface RegistryRef {
  registry: string;
  preset?: string;
  ref?: string;
}

/** A config file path, or a registry and the preset wanted out of it. */
export type ExtendsEntry = string | RegistryRef;

export function isRegistryRef(entry: ExtendsEntry): entry is RegistryRef {
  return typeof entry === "object";
}

export interface Pack {
  source: Source;
  /** Path to the config file inside the repo. */
  path: string;
  /** As written in the config, minus any ref. */
  spec: string;
}

export interface PackRef extends Pack {
  /** Where the checkout lives in this project. */
  dir: string;
}

const PACK_RE = /^github:([^/#]+)\/([^/#]+)(?:\/([^#]+))?(?:#(.+))?$/;

export function isPackSpec(spec: string): boolean {
  return spec.startsWith("github:");
}

/** `github:owner/repo/path/to/config.json#ref`; ref last so the path can nest. */
export function parsePack(spec: string): Pack {
  const match = PACK_RE.exec(spec);
  if (!match) {
    throw new Error(
      `Unrecognised pack source: "${spec}"\n` +
        `  expected github:owner/repo/config.json or github:owner/repo/config.json#ref`,
    );
  }
  const [, owner = "", repo = "", path, ref] = match;
  return {
    source: { owner, repo, ref },
    path: path ?? "recommended.json",
    spec: `github:${owner}/${repo}`,
  };
}

const REGISTRY_RE = /^github:([^/#]+)\/([^/#]+)(?:\/([^#]+))?$/;

/** The github form of a registry reference, as the same Pack a spec produces. */
export function packFromRef(entry: RegistryRef): Pack {
  const match = REGISTRY_RE.exec(entry.registry);
  if (!match) {
    throw new Error(
      `Unrecognised registry: "${entry.registry}"\n` +
        `  expected github:owner/repo or github:owner/repo/dir, with the preset\n` +
        `  in "preset" and any ref in "ref"`,
    );
  }
  const [, owner = "", repo = "", dir] = match;
  return {
    source: { owner, repo, ref: entry.ref },
    // A registry may sit in a subdirectory of its repo, so the preset path
    // carries it and `dirname` gives the directory back where rules are looked up.
    path: join(dir ?? ".", `${entry.preset ?? DEFAULT_PRESET}.json`),
    spec: `github:${owner}/${repo}`,
  };
}

/** One checkout per repo, however many configs are extended out of it. */
export function packDir(pack: Pack, projectDir: string): string {
  return join(projectDir, PACK_DIR, `${pack.source.owner}-${pack.source.repo}`);
}

/**
 * Where an `extends` entry's config file lives.
 *
 * An object names a **registry**: a directory holding `<preset>.json` and a
 * `rules/` directory. A string is a config file directly — a path resolved
 * against the config that names it, a `github:` spec, or a bare specifier
 * resolving to an installed package and otherwise to the pack shipped inside
 * this one under `registry/`. That last fallback is what lets `npx hal-rules`
 * work in a repo with no node_modules; a Rails or Python project has nowhere
 * to install a pack.
 */
export function resolveExtends(
  entry: ExtendsEntry,
  base: string,
  projectDir: string,
): string {
  if (isRegistryRef(entry)) return resolveRegistry(entry, base, projectDir);

  const spec = entry;
  if (isPackSpec(spec)) return packConfig(parsePack(spec), projectDir, spec);
  if (spec.startsWith(".") || isAbsolute(spec)) return resolve(base, spec);
  return resolveBare(spec, base);
}

/** An installed package, else the pack shipped inside this one. */
function resolveBare(spec: string, base: string): string {
  try {
    return createRequire(join(base, "_.js")).resolve(spec);
  } catch {
    // The package name is dropped and the rest read against the registry, so
    // `hal-rules/recommended.json` keeps working now that the pack sits under
    // `registry/`. The published `exports` map does the same for a real install.
    const [, ...rest] = spec.split("/");
    return resolve(PACKAGE_ROOT, REGISTRY_DIR, ...rest);
  }
}

/** A fetched pack's config, or a clear reason it is not there yet. */
function packConfig(pack: Pack, projectDir: string, named: string): string {
  const file = join(packDir(pack, projectDir), pack.path);
  if (!existsSync(file)) {
    throw new Error(
      `${named} is not fetched yet (looked in ${file})\n` +
        `  run: npx hal-rules@latest`,
    );
  }
  return file;
}

/**
 * A registry is a directory by convention: `<preset>.json` beside a `rules/`
 * holding the bodies. Enforced, because a registry without rules resolves every
 * slug to nothing and the failure is otherwise reported once per rule.
 */
function resolveRegistry(
  entry: RegistryRef,
  base: string,
  projectDir: string,
): string {
  const preset = `${entry.preset ?? DEFAULT_PRESET}.json`;
  let dir: string;
  if (entry.registry.startsWith("github:")) {
    const pack = packFromRef(entry);
    packConfig(pack, projectDir, entry.registry);
    dir = join(packDir(pack, projectDir), dirname(pack.path));
  } else {
    if (entry.ref !== undefined) {
      throw new Error(
        `Registry "${entry.registry}" is a path, so "ref" means nothing here.\n` +
          `  A ref only applies to a github: registry.`,
      );
    }
    if (entry.registry.startsWith(".") || isAbsolute(entry.registry)) {
      dir = resolve(base, entry.registry);
    } else {
      // A bare specifier names a package, so let the preset resolve through the
      // same path a string takes and read the registry directory back off it.
      dir = dirname(resolveBare(`${entry.registry}/${preset}`, base));
    }
    if (!existsSync(dir)) {
      throw new Error(
        `Registry not found: ${entry.registry}\n  looked in ${dir}`,
      );
    }
  }

  const file = join(dir, preset);
  if (!existsSync(file)) {
    throw new Error(
      `Registry "${entry.registry}" has no preset "${entry.preset ?? DEFAULT_PRESET}"\n` +
        `  looked for ${file}`,
    );
  }
  if (!existsSync(join(dir, RULES_DIR))) {
    throw new Error(
      `Registry "${entry.registry}" has no ${RULES_DIR}/ directory\n` +
        `  expected ${join(dir, RULES_DIR)}, which is where a registry keeps its rule bodies`,
    );
  }
  return file;
}

/**
 * Every pack reachable from a config, descending only through checkouts that
 * are already on disk. A build calls this repeatedly: each fetch reveals the
 * next layer, so the fixpoint is the whole graph without a second walker.
 */
/** The pack an entry names, in either form, or undefined if it names no repo. */
function packOf(entry: ExtendsEntry): Pack | undefined {
  if (isRegistryRef(entry)) {
    return entry.registry.startsWith("github:")
      ? packFromRef(entry)
      : undefined;
  }
  return isPackSpec(entry) ? parsePack(entry) : undefined;
}

export function collectPacks(
  configPath: string,
  projectDir: string,
): PackRef[] {
  const seen = new Set<string>();
  const found: PackRef[] = [];

  const visit = (file: string): void => {
    const path = resolve(file);
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);

    let config: AiRulesConfig;
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as AiRulesConfig;
    } catch {
      return; // loadConfig reports a malformed config with a better message.
    }
    for (const entry of config.extends ?? []) {
      const pack = packOf(entry);
      if (pack) {
        const dir = packDir(pack, projectDir);
        found.push({ ...pack, dir });
        visit(join(dir, pack.path));
      } else {
        visit(resolveExtends(entry, dirname(path), projectDir));
      }
    }
  };

  visit(configPath);
  return found;
}

export interface PackReport {
  installed: string[];
  removed: string[];
  lock: Record<string, LockEntry>;
}

/**
 * A pinned pack is never refetched: the lock plus the checkout is the answer,
 * so a build stays offline and a push upstream cannot change what instructs
 * Claude until someone asks for it with `--update`.
 */
async function ensure(
  pack: PackRef,
  previous: Record<string, LockEntry>,
  update: boolean,
): Promise<{ entry: LockEntry; fetched: boolean }> {
  const locked = previous[pack.spec];
  const wanted = pack.source.ref ?? "HEAD";
  if (!update && locked?.ref === wanted && existsSync(pack.dir)) {
    return { entry: locked, fetched: false };
  }

  const { ref, sha } = await resolveSha(pack.source);
  const entry: LockEntry = { source: pack.spec, ref, sha, path: PACK_DIR };
  if (locked?.sha === sha && existsSync(pack.dir)) {
    return { entry, fetched: false };
  }

  const root = await download(pack.source, sha);
  try {
    rmSync(pack.dir, { recursive: true, force: true });
    mkdirSync(dirname(pack.dir), { recursive: true });
    cpSync(root, pack.dir, { recursive: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return { entry, fetched: true };
}

/**
 * Fetch every pack a config reaches, then everything those reach. Runs before
 * the config is loaded, because resolution is synchronous and a checkout has
 * to be on disk by then.
 */
export async function installPacks(
  configPath: string,
  projectDir = ".",
  previous: Record<string, LockEntry> = {},
  { update = false } = {},
): Promise<PackReport> {
  const lock: Record<string, LockEntry> = {};
  const installed: string[] = [];

  for (;;) {
    const todo = collectPacks(configPath, projectDir).filter(
      (pack) => !(pack.spec in lock),
    );
    if (todo.length === 0) break;

    for (const pack of todo) {
      if (pack.spec in lock) continue; // two configs, one repo
      const { entry, fetched } = await ensure(pack, previous, update);
      lock[pack.spec] = entry;
      if (fetched)
        installed.push(
          `${pack.spec}  @ ${entry.ref} (${entry.sha.slice(0, 8)})`,
        );
    }
  }

  const removed = Object.keys(previous).filter((spec) => !(spec in lock));
  for (const spec of removed) {
    const pack = parsePack(spec);
    rmSync(packDir(pack, projectDir), { recursive: true, force: true });
  }
  return { installed, removed, lock };
}
