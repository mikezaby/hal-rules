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
import { init } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-init-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

function project(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string) =>
  readFileSync(join(dir, file), "utf8");

test("scaffolds a config that extends the installed pack", () => {
  const dir = project("fresh");
  const [config, gitignore] = init(dir);

  assert.equal(config?.status, "created");
  assert.equal(gitignore?.status, "created");

  const written = JSON.parse(read(dir, "hal-rules.json")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(written.extends, [
    "node_modules/hal-rules/recommended.json",
  ]);
  assert.deepEqual(written.rulesDir, ["rules"]);
  assert.deepEqual(written.rules, {});
  assert.equal(read(dir, ".gitignore"), ".claude/rules/generated/\n");
});

test("--expand writes the inherited rules out so they can be toggled", () => {
  const dir = project("expanded");
  // Stand in for an installed pack at the path the starter config points to.
  const pack = join(dir, "node_modules/hal-rules");
  mkdirSync(join(pack, "rules/demo"), { recursive: true });
  writeFileSync(join(pack, "rules/demo/one.md"), "# One\n");
  writeFileSync(
    join(pack, "recommended.json"),
    JSON.stringify({
      rulesDir: ["rules"],
      rules: { "demo/one": "on", "demo/two": ["on", { a: "b" }] },
    }),
  );

  init(dir, { expand: true });
  const written = JSON.parse(read(dir, "hal-rules.json")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(written.rules, {
    "demo/one": "on",
    "demo/two": ["on", { a: "b" }],
  });
});

test("--expand on a project with no pack installed still writes a usable config", () => {
  const dir = project("nopack");
  init(dir, { expand: true });
  const written = JSON.parse(read(dir, "hal-rules.json")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(
    written.rules,
    {},
    "no pack to read: empty rules, not a crash",
  );
  assert.deepEqual(written.extends, [
    "node_modules/hal-rules/recommended.json",
  ]);
});

test("never overwrites an existing config", () => {
  const dir = project("existing");
  writeFileSync(join(dir, "hal-rules.json"), '{"rules":{"ours/keep-me":"on"}}');

  const [config] = init(dir);
  assert.equal(config?.status, "exists");
  assert.match(
    read(dir, "hal-rules.json"),
    /keep-me/,
    "the team's config must survive re-init",
  );
});

test("appends to an existing .gitignore without duplicating", () => {
  const dir = project("gitignored");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");

  const [, first] = init(dir);
  assert.equal(first?.status, "updated");
  assert.equal(
    read(dir, ".gitignore"),
    "node_modules/\n.claude/rules/generated/\n",
  );

  const [, second] = init(dir);
  assert.equal(second?.status, "exists");
  assert.equal(
    read(dir, ".gitignore"),
    "node_modules/\n.claude/rules/generated/\n",
  );
});

test("handles a .gitignore with no trailing newline", () => {
  const dir = project("nonewline");
  writeFileSync(join(dir, ".gitignore"), "dist/");

  init(dir);
  assert.equal(read(dir, ".gitignore"), "dist/\n.claude/rules/generated/\n");
});
