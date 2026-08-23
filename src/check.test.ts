import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build, check, writeLock } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-check-test-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const OUT = ".claude/rules/generated";

/** A project with a one-rule pack of its own. */
function project(name: string, config: Record<string, unknown> = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, "rules/ours"), { recursive: true });
  writeFileSync(join(dir, "rules/ours/one.md"), "# One\n- a rule\n");
  writeFileSync(join(dir, "rules/ours/two.md"), "# Two\n- another\n");
  const path = join(dir, "hal-rules.json");
  writeFileSync(
    path,
    JSON.stringify({
      rulesDir: ["rules"],
      rules: { "ours/one": "on" },
      ...config,
    }),
  );
  return { dir, path };
}

const generate = (p: { dir: string; path: string }) =>
  build(p.path, join(p.dir, OUT));

test("clean when the output matches the config", () => {
  const p = project("clean");
  generate(p);
  assert.deepEqual(check(p.path, p.dir), []);
});

test("nothing generated is reported once, not once per rule", () => {
  const p = project("ungenerated");
  const problems = check(p.path, p.dir);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0]?.what ?? "",
    /nothing generated yet \(1 rules expected\)/,
  );
});

test("a rule switched off but still on disk is stale", () => {
  const p = project("stale");
  generate(p);
  writeFileSync(
    p.path,
    JSON.stringify({ rulesDir: ["rules"], rules: { "ours/one": "off" } }),
  );

  const problems = check(p.path, p.dir);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0]?.what ?? "",
    /stale rule still on disk: ours\/one\.md/,
  );
});

test("a rule added to the config but not generated is missing", () => {
  const p = project("added");
  generate(p);
  writeFileSync(
    p.path,
    JSON.stringify({
      rulesDir: ["rules"],
      rules: { "ours/one": "on", "ours/two": "on" },
    }),
  );

  assert.match(
    check(p.path, p.dir)[0]?.what ?? "",
    /missing rule: ours\/two\.md/,
  );
});

test("a hand-edited generated file is out of date", () => {
  const p = project("tampered");
  generate(p);
  appendFileSync(join(p.dir, OUT, "ours/one.md"), "\nsomeone edited this\n");

  assert.match(
    check(p.path, p.dir)[0]?.what ?? "",
    /out of date: ours\/one\.md/,
  );
});

test("an invalid config short-circuits, so later comparisons are not noise", () => {
  const p = project("invalid");
  generate(p);
  writeFileSync(
    p.path,
    JSON.stringify({ rulesDir: ["rules"], rules: { "ours/nope": "on" } }),
  );

  const problems = check(p.path, p.dir);
  assert.equal(problems.length, 1, "one real cause, not a cascade");
  assert.match(problems[0]?.what ?? "", /Rule not found: ours\/nope/);
});

test("never writes into the project it checks", () => {
  const p = project("readonly");
  generate(p);
  const before = readdirSync(p.dir, {
    recursive: true,
    encoding: "utf8",
  }).sort();

  check(p.path, p.dir);
  assert.deepEqual(
    readdirSync(p.dir, { recursive: true, encoding: "utf8" }).sort(),
    before,
    "a check must be safe to run anywhere, including CI on a clean tree",
  );
});

test("skills: declared but not installed, and installed but undeclared", () => {
  const p = project("skills", {
    skills: { "github:matt/skills": ["engineering/tdd"] },
  });
  generate(p);

  const declared = check(p.path, p.dir);
  assert.ok(
    declared.some((x) =>
      x.what.includes("skill declared but not installed: engineering/tdd"),
    ),
  );

  writeLock(
    {
      skills: {
        tdd: {
          source: "github:matt/skills",
          ref: "main",
          sha: "abc",
          path: "skills/engineering/tdd",
        },
      },
    },
    p.dir,
  );
  const onDisk = check(p.path, p.dir);
  assert.ok(
    onDisk.some((x) =>
      x.what.includes("skill in the lock but missing on disk: tdd"),
    ),
    "locked but no SKILL.md: skills are committed, so this is a real problem",
  );

  writeFileSync(
    p.path,
    JSON.stringify({ rulesDir: ["rules"], rules: { "ours/one": "on" } }),
  );
  assert.ok(
    check(p.path, p.dir).some((x) =>
      x.what.includes("skill installed but no longer declared: tdd"),
    ),
  );
});
