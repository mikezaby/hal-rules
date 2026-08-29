import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadConfig, readLock, validate, writeLock } from "../src/index.ts";
import {
  PACK_SOURCE,
  groupForDisplay,
  indexSkills,
  installSkills,
  parseSource,
} from "../src/skills.ts";

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

/** A registry as `extends` finds one: a preset beside rules/ and skills/. */
function registry(name: string, slugs: string[]) {
  const dir = join(root, name);
  mkdirSync(join(dir, "rules"), { recursive: true });
  writeFileSync(join(dir, "recommended.json"), "{}");
  for (const slug of slugs) {
    mkdirSync(join(dir, "skills", slug), { recursive: true });
    writeFileSync(
      join(dir, "skills", slug, "SKILL.md"),
      `---\nname: ${slug.split("/").pop() ?? slug}\n---\nfrom ${name}\n`,
    );
  }
  return dir;
}

function consumer(name: string, config: Record<string, unknown>) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hal-rules.json"), JSON.stringify(config));
  return dir;
}

test("a pack skill installs flat, by slug, with no network", async () => {
  const pack = registry("pack-a", ["research/manual-analyzer", "review/adr"]);
  const dir = consumer("uses-pack", {
    extends: [{ registry: pack }],
    skills: { "research/manual-analyzer": "on", "review/adr": "off" },
  });

  const config = loadConfig(join(dir, "hal-rules.json"));
  const report = await installSkills(config.skills, dir, {}, config.skillsDirs);

  assert.deepEqual(Object.keys(report.lock), ["manual-analyzer"]);
  assert.equal(report.lock["manual-analyzer"]?.source, PACK_SOURCE);
  assert.ok(existsSync(join(dir, ".claude/skills/manual-analyzer/SKILL.md")));
  assert.ok(
    !existsSync(join(dir, ".claude/skills/adr")),
    'a skill set to "off" is not installed',
  );
});

test("a project's own skills/ shadows the pack's, last dir wins", async () => {
  const pack = registry("pack-b", ["research/manual-analyzer"]);
  const dir = consumer("shadows", {
    extends: [{ registry: pack }],
    skills: { "research/manual-analyzer": "on" },
  });
  mkdirSync(join(dir, "skills/research/manual-analyzer"), { recursive: true });
  writeFileSync(
    join(dir, "skills/research/manual-analyzer/SKILL.md"),
    "---\nname: manual-analyzer\n---\nours\n",
  );

  const config = loadConfig(join(dir, "hal-rules.json"));
  await installSkills(config.skills, dir, {}, config.skillsDirs);

  const body = readFileSync(
    join(dir, ".claude/skills/manual-analyzer/SKILL.md"),
    "utf8",
  );
  assert.match(body, /ours/);
});

test("a skill nobody provides is a validate error, not a silent skip", () => {
  const pack = registry("pack-c", []);
  const dir = consumer("missing", {
    extends: [{ registry: pack }],
    skills: { "research/nope": "on" },
  });
  const errors = validate(join(dir, "hal-rules.json"));
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /No skill "research\/nope"/);
});

test("the two shapes on the skills key are told apart", () => {
  const pack = registry("pack-d", ["research/manual-analyzer"]);
  const dir = consumer("shapes", {
    extends: [{ registry: pack }],
    skills: {
      "research/manual-analyzer": "maybe",
      "github:matt/skills": "engineering/tdd",
    },
  });
  const errors = validate(join(dir, "hal-rules.json"));
  assert.match(
    errors.join("\n"),
    /skill "research\/manual-analyzer" is set to/,
  );
  assert.match(
    errors.join("\n"),
    /skill source "github:matt\/skills" is set to .* Expected a list/,
  );
});
