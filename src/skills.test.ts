import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readLock, writeLock } from "./index.ts";
import { groupForDisplay, indexSkills, parseSource } from "./skills.ts";

const root = mkdtempSync(join(tmpdir(), "hal-skills-test-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

function repo(name: string, skillDirs: string[]) {
  const dir = join(root, name);
  for (const path of skillDirs) {
    mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(join(dir, path, "SKILL.md"), "---\nname: x\n---\n");
  }
  return dir;
}

test("parses github sources with and without a ref", () => {
  assert.deepEqual(parseSource("github:matt/skills"), {
    owner: "matt",
    repo: "skills",
    ref: undefined,
  });
  assert.deepEqual(parseSource("github:matt/skills#v1.2.0"), {
    owner: "matt",
    repo: "skills",
    ref: "v1.2.0",
  });
});

test("rejects a source it cannot fetch, rather than guessing", () => {
  assert.throws(
    () => parseSource("matt/skills"),
    /expected github:owner\/repo/,
  );
  assert.throws(
    () => parseSource("https://example.com/x.git"),
    /Unrecognised skill source/,
  );
});

test("a skills/ root is addressable with or without the prefix", () => {
  const dir = repo("grouped", [
    "skills/engineering/tdd",
    "skills/writing/beats",
  ]);
  const index = indexSkills(dir);

  assert.equal(index.get("engineering/tdd")?.name, "tdd");
  assert.equal(
    index.get("skills/engineering/tdd")?.name,
    "tdd",
    "full path works too",
  );
  assert.equal(
    index.get("engineering/tdd")?.repoPath,
    "skills/engineering/tdd",
  );
});

test("a repo with no skills/ root still indexes", () => {
  const index = indexSkills(repo("flat", ["tdd", "docs/writing"]));
  assert.equal(index.get("tdd")?.name, "tdd");
  assert.equal(index.get("docs/writing")?.name, "writing");
});

test("dot directories and node_modules are skipped", () => {
  const dir = repo("noisy", ["skills/real"]);
  mkdirSync(join(dir, "node_modules/pkg/skills/fake"), { recursive: true });
  writeFileSync(join(dir, "node_modules/pkg/skills/fake/SKILL.md"), "x");
  mkdirSync(join(dir, ".git/skills/hidden"), { recursive: true });
  writeFileSync(join(dir, ".git/skills/hidden/SKILL.md"), "x");

  const names = [...new Set([...indexSkills(dir).values()].map((s) => s.name))];
  assert.deepEqual(names, ["real"]);
});

test("groups by the source's own folders, for browsing", () => {
  const index = indexSkills(
    repo("groups", [
      "skills/engineering/tdd",
      "skills/engineering/spec",
      "skills/writing/beats",
    ]),
  );
  const groups = groupForDisplay(index);
  assert.deepEqual(groups.get("engineering/"), ["spec", "tdd"]);
  assert.deepEqual(groups.get("writing/"), ["beats"]);
});

test("the lock round-trips, and disappears when empty", () => {
  const dir = join(root, "locked");
  mkdirSync(dir, { recursive: true });
  const entry = {
    source: "github:a/b",
    ref: "main",
    sha: "abc",
    path: "skills/x/tdd",
  };

  writeLock({ skills: { tdd: entry } }, dir);
  assert.deepEqual(readLock(dir).skills.tdd, entry);

  writeLock({ skills: {} }, dir);
  assert.deepEqual(readLock(dir).skills, {}, "no stale lock left behind");
});
