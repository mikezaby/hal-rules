import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

/** A pack skill is on or off. A `github:` key carries a path list instead. */
export type SkillState = "on" | "off";

/** Which of the two shapes a `skills` key is: a repo to fetch, or a pack slug. */
export function isSource(key: string): boolean {
  return key.startsWith("github:");
}

/** `github:owner/repo` or `github:owner/repo#ref`. */
export interface Source {
  owner: string;
  repo: string;
  ref?: string;
}

export interface SkillEntry {
  /** As written in the config: `engineering/tdd`. */
  path: string;
  /** The directory name, which is what Claude Code uses as the command. */
  name: string;
  /** Path inside the repo: `skills/engineering/tdd`. */
  repoPath: string;
}

export interface LockEntry {
  source: string;
  /** Absent for a pack skill: it came off disk, so there is nothing to pin. */
  ref?: string;
  sha?: string;
  path: string;
}

/** Anything fetched from a repo, so the pin is always there. */
export interface FetchedEntry extends LockEntry {
  ref: string;
  sha: string;
}

/** What a pack skill records as its source, where a fetched one records a repo. */
export const PACK_SOURCE = "pack";

export function parseSource(spec: string): Source {
  const match = /^github:([^/#]+)\/([^/#]+)(?:#(.+))?$/.exec(spec);
  if (!match) {
    throw new Error(
      `Unrecognised skill source: "${spec}"\n  expected github:owner/repo or github:owner/repo#ref`,
    );
  }
  return { owner: match[1] ?? "", repo: match[2] ?? "", ref: match[3] };
}

/** Pin whatever was asked for to a commit, so the lock records something stable. */
export async function resolveSha(
  source: Source,
): Promise<{ ref: string; sha: string }> {
  const ref = source.ref ?? "HEAD";
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${ref}`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.sha" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not resolve ${source.owner}/${source.repo}#${ref} (HTTP ${response.status}).\n` +
        `  Check the repo and ref exist, or that you are not rate-limited by GitHub.`,
    );
  }
  return { ref, sha: (await response.text()).trim() };
}

export async function download(source: Source, sha: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hal-skills-"));
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${sha}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed for ${url} (HTTP ${response.status})`);

  const archive = join(dir, "repo.tar.gz");
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  // tar ships with macOS, Linux and Windows 10+; avoids a dependency for one call.
  execFileSync("tar", ["-xzf", archive, "-C", dir, "--strip-components=1"]);
  rmSync(archive);
  return dir;
}

/**
 * Every skill in a checkout, keyed the way a config would name it. A repo that
 * groups under `skills/` is addressed without that prefix, so `engineering/tdd`
 * works whether or not the repo has a skills root.
 */
export function indexSkills(root: string): Map<string, SkillEntry> {
  const found = new Map<string, SkillEntry>();
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith(".") || item.name === "node_modules") continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name === "SKILL.md") {
        const repoPath = relative(root, dirname(full)).split(sep).join("/");
        const entry: SkillEntry = {
          path: repoPath.replace(/^skills\//, ""),
          name: repoPath.split("/").pop() ?? repoPath,
          repoPath,
        };
        found.set(entry.path, entry);
        found.set(repoPath, entry); // the full path works too
      }
    }
  };
  walk(root);
  return found;
}

/** Grouped for display: `engineering/` -> [tdd, to-tickets, ...]. */
export function groupForDisplay(
  index: Map<string, SkillEntry>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const entry of new Set(index.values())) {
    const group = entry.path.includes("/")
      ? `${entry.path.split("/")[0] ?? ""}/`
      : "(top level)";
    groups.set(group, [...(groups.get(group) ?? []), entry.name].sort());
  }
  return new Map([...groups].sort());
}

export async function fetchSource(spec: string): Promise<{
  root: string;
  index: Map<string, SkillEntry>;
  ref: string;
  sha: string;
}> {
  const source = parseSource(spec);
  const { ref, sha } = await resolveSha(source);
  const root = await download(source, sha);
  return { root, index: indexSkills(root), ref, sha };
}

export interface InstallReport {
  installed: string[];
  removed: string[];
  lock: Record<string, LockEntry>;
}

/** Last dir wins, so a project shadows a pack skill by dropping the slug in place. */
export function findSkill(slug: string, dirs: string[]): string {
  for (const dir of [...dirs].reverse()) {
    const path = join(dir, slug);
    if (existsSync(join(path, "SKILL.md"))) return path;
  }
  throw new Error(
    `No skill "${slug}" found.\n` +
      (dirs.length > 0
        ? `  looked for ${slug}/SKILL.md in:\n${dirs.map((dir) => `    ${dir}`).join("\n")}`
        : "  no registry in the extends chain has a skills/ directory"),
  );
}

/**
 * Skills land flat in `.claude/skills/<name>/` because that is the only layout
 * Claude Code discovers, since the directory name IS the command. The category from
 * the config is kept in the lock file so provenance is not lost.
 *
 * A `github:` key names a repo to fetch; any other key is a slug resolved from
 * the registries in the extends chain, on or off the way a rule is.
 */
export async function installSkills(
  wanted: Record<string, string[] | SkillState>,
  projectDir: string,
  previous: Record<string, LockEntry> = {},
  skillsDirs: string[] = [],
): Promise<InstallReport> {
  const skillsDir = join(projectDir, ".claude/skills");
  const lock: Record<string, LockEntry> = {};
  const installed: string[] = [];
  const claimedBy = new Map<string, string>();

  const claim = (name: string, by: string): void => {
    const owner = claimedBy.get(name);
    if (owner) {
      throw new Error(
        `Two sources both provide the skill name "${name}":\n` +
          `  ${owner}\n  ${by}\n` +
          `  Claude Code keys skills by directory name, so one would silently win.`,
      );
    }
    claimedBy.set(name, by);
  };

  // A malformed state is reported by validate; here anything but "on" is a skip.
  for (const [slug, state] of Object.entries(wanted)) {
    if (isSource(slug) || state !== "on") continue;
    const from = findSkill(slug, skillsDirs);
    const name = slug.split("/").pop() ?? slug;
    claim(name, `${PACK_SOURCE} (${slug})`);

    const dest = join(skillsDir, name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(from, dest, { recursive: true });
    lock[name] = { source: PACK_SOURCE, path: slug };
    installed.push(`${name}  <-  ${PACK_SOURCE} (${slug})`);
  }

  for (const [spec, paths] of Object.entries(wanted)) {
    if (!Array.isArray(paths)) continue;
    if (paths.length === 0) continue;
    const { root, index, ref, sha } = await fetchSource(spec);
    try {
      for (const path of paths) {
        const entry = index.get(path);
        if (!entry) {
          const near = [...new Set([...index.values()].map((s) => s.path))]
            .filter(
              (p) => p.endsWith(`/${path}`) || p.split("/").pop() === path,
            )
            .slice(0, 3);
          throw new Error(
            `"${path}" is not in ${spec}` +
              (near.length > 0 ? `\n  did you mean: ${near.join(", ")}` : "") +
              `\n  run: hal skills list ${spec}`,
          );
        }
        claim(entry.name, `${spec} (${entry.path})`);

        const dest = join(skillsDir, entry.name);
        rmSync(dest, { recursive: true, force: true });
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(join(root, entry.repoPath), dest, { recursive: true });
        lock[entry.name] = {
          source: spec.split("#")[0] ?? spec,
          ref,
          sha,
          path: entry.repoPath,
        };
        installed.push(`${entry.name}  <-  ${spec} (${entry.path})`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Anything this tool installed before and no longer wants.
  const removed: string[] = [];
  for (const name of Object.keys(previous)) {
    if (name in lock) continue;
    const dir = join(skillsDir, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  }
  return { installed, removed, lock };
}
