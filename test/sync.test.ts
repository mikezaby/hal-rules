import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  applyVars,
  available,
  findAvailable,
  outdated,
  setState,
  sync,
} from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-sync-test-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A pack of three rules, one of which takes a variable. */
function project(name: string, rules: Record<string, unknown>) {
  const dir = join(root, name);
  mkdirSync(join(dir, "rules/ours"), { recursive: true });
  writeFileSync(join(dir, "rules/ours/one.md"), "# One\n");
  writeFileSync(join(dir, "rules/ours/two.md"), "# Two\n");
  writeFileSync(
    join(dir, "rules/ours/needy.md"),
    "# Needy\n\nUse {{place}} and {{other}}.\n",
  );
  const path = join(dir, "hal-rules.json");
  writeFileSync(path, JSON.stringify({ rulesDir: ["rules"], rules }));
  return { dir, path };
}

const config = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as { rules: Record<string, unknown> };

test("available lists every rule and skill with what the config says", () => {
  const { dir, path } = project("all", {
    "ours/one": "on",
    "ours/two": "off",
  });
  mkdirSync(join(dir, "skills/topic/go"), { recursive: true });
  writeFileSync(join(dir, "skills/topic/go/SKILL.md"), "Track {{tracker}}\n");
  mkdirSync(join(dir, "skills/topic/stay"), { recursive: true });
  writeFileSync(join(dir, "skills/topic/stay/SKILL.md"), "# Stay\n");
  writeFileSync(
    path,
    JSON.stringify({
      rulesDir: ["rules"],
      rules: { "ours/one": "on", "ours/two": ["off", {}] },
      skills: { "topic/go": ["on", { tracker: "github" }] },
    }),
  );

  const { rules, skills } = available(path);
  assert.deepEqual(
    rules.map((r) => [r.slug, r.state]),
    [
      ["ours/needy", "unset"],
      ["ours/one", "on"],
      ["ours/two", "off"],
    ],
  );
  assert.deepEqual(
    skills.map((s) => [s.slug, s.state, s.vars]),
    [
      ["topic/go", "on", ["tracker"]],
      ["topic/stay", "unset", []],
    ],
  );
});

test("enable and disable edit one entry, keeping vars across the toggle", () => {
  const { path } = project("toggle", { "ours/one": "on" });

  const needy = findAvailable(path, "ours/needy");
  assert.equal(needy.kind, "rules");
  assert.deepEqual(needy.missing, ["place", "other"]);

  setState(path, needy, "on", { place: "here", other: "there" });
  assert.deepEqual(config(path).rules["ours/needy"], [
    "on",
    { place: "here", other: "there" },
  ]);
  assert.deepEqual(findAvailable(path, "ours/needy").missing, []);

  setState(path, findAvailable(path, "ours/needy"), "off");
  assert.deepEqual(config(path).rules["ours/needy"], [
    "off",
    { place: "here", other: "there" },
  ]);
  assert.equal(config(path).rules["ours/one"], "on", "others untouched");

  setState(path, findAvailable(path, "ours/two"), "off");
  assert.equal(config(path).rules["ours/two"], "off", "no vars, no tuple");
});

test("an unknown slug names near misses", () => {
  const { path } = project("unknown", {});
  assert.throws(
    () => findAvailable(path, "needy"),
    /Did you mean: ours\/needy/,
  );
  assert.throws(() => findAvailable(path, "nope"), /hal-rules@latest list/);
});

test("lists rules in the pack that the config never mentions", () => {
  const { path } = project("gaps", { "ours/one": "on" });
  assert.deepEqual(
    outdated(path).map((r) => r.slug),
    ["ours/needy", "ours/two"],
  );
});

test("a rule that is explicitly off is not outdated, it was decided", () => {
  const { path } = project("decided", { "ours/one": "on", "ours/two": "off" });
  assert.deepEqual(
    outdated(path).map((r) => r.slug),
    ["ours/needy"],
  );
});

test("reports the variables a rule needs", () => {
  const { path } = project("vars", { "ours/one": "on", "ours/two": "on" });
  assert.deepEqual(outdated(path)[0]?.vars, ["place", "other"]);
});

test("sync adds them as off, never on", () => {
  const { path } = project("adds", { "ours/one": "on" });
  const added = sync(path);

  assert.deepEqual(
    added.map((r) => r.slug),
    ["ours/needy", "ours/two"],
  );
  const rules = config(path).rules;
  assert.equal(rules["ours/one"], "on", "existing decisions are untouched");
  assert.equal(rules["ours/two"], "off");
  assert.deepEqual(rules["ours/needy"], ["off", { place: "", other: "" }]);

  assert.deepEqual(outdated(path), [], "nothing left to report");
});

test("sync is a no-op when nothing is new", () => {
  const { path } = project("full", {
    "ours/one": "on",
    "ours/two": "off",
    "ours/needy": "off",
  });
  const before = readFileSync(path, "utf8");
  assert.deepEqual(sync(path), []);
  assert.equal(
    readFileSync(path, "utf8"),
    before,
    "no rewrite when there is nothing to add",
  );
});

test("a blank scaffolded value fails loudly if the rule is switched on", () => {
  assert.throws(
    () => applyVars("Use {{place}}.", { place: "" }, "ours/needy"),
    /\{\{place\}\} has no value/,
    "otherwise the sentence renders with a hole in it",
  );
});
