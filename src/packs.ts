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

/** One checkout per repo, however many configs are extended out of it. */
export function packDir(pack: Pack, projectDir: string): string {
  return join(projectDir, PACK_DIR, `${pack.source.owner}-${pack.source.repo}`);
}

/**
 * A path (`./base.json`, `/abs/base.json`) resolves against the config file.
 * `github:...` resolves into this project's pack cache, which a build fetches
 * before any config is read.
 *
 * Anything else is a bare specifier: an installed package if there is one, and
 * otherwise the pack shipped inside this package. That fallback is what lets
 * `npx hal-rules` work in a repo with no node_modules. A Rails or Python
 * project has nowhere to install a pack.
 */
export function resolveExtends(
  spec: string,
  base: string,
  projectDir: string,
): string {
  if (isPackSpec(spec)) {
    const pack = parsePack(spec);
    const file = join(packDir(pack, projectDir), pack.path);
    if (!existsSync(file)) {
      throw new Error(
        `${spec} is not fetched yet (looked in ${file})\n` +
          `  run: npx hal-rules@latest`,
      );
    }
    return file;
  }
  if (spec.startsWith(".") || isAbsolute(spec)) return resolve(base, spec);
  try {
    return createRequire(join(base, "_.js")).resolve(spec);
  } catch {
    const [, ...rest] = spec.split("/");
    return resolve(PACKAGE_ROOT, ...rest);
  }
}

/**
 * Every pack reachable from a config, descending only through checkouts that
 * are already on disk. A build calls this repeatedly: each fetch reveals the
 * next layer, so the fixpoint is the whole graph without a second walker.
 */
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
    for (const spec of config.extends ?? []) {
      if (isPackSpec(spec)) {
        const pack = parsePack(spec);
        const dir = packDir(pack, projectDir);
        found.push({ ...pack, dir });
        visit(join(dir, pack.path));
      } else {
        visit(resolveExtends(spec, dirname(path), projectDir));
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
