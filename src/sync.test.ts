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
import { applyVars, outdated, sync } from "./index.ts";

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

test("lists rules in the pack that the config never mentions", () => {
  const { path } = project("gaps", { "ours/one": "on" });
  assert.deepEqual(
    outdated(path).map((r) => r.slug),
    ["ours/needy", "ours/two"],
  );
});

test("a rule that is explicitly off is not outdated — it was decided", () => {
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
