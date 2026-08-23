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
  ref: string;
  sha: string;
  path: string;
}

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
async function resolveSha(
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

async function download(source: Source, sha: string): Promise<string> {
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

/**
 * Skills land flat in `.claude/skills/<name>/` because that is the only layout
 * Claude Code discovers — the directory name IS the command. The category from
 * the config is kept in the lock file so provenance is not lost.
 */
export async function installSkills(
  wanted: Record<string, string[]>,
  projectDir: string,
  previous: Record<string, LockEntry> = {},
): Promise<InstallReport> {
  const skillsDir = join(projectDir, ".claude/skills");
  const lock: Record<string, LockEntry> = {};
  const installed: string[] = [];
  const claimedBy = new Map<string, string>();

  for (const [spec, paths] of Object.entries(wanted)) {
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
        const owner = claimedBy.get(entry.name);
        if (owner) {
          throw new Error(
            `Two sources both provide the skill name "${entry.name}":\n` +
              `  ${owner}\n  ${spec} (${entry.path})\n` +
              `  Claude Code keys skills by directory name, so one would silently win.`,
          );
        }
        claimedBy.set(entry.name, `${spec} (${entry.path})`);

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
