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

const root = mkdtempSync(join(tmpdir(), "ai-rules-init-"));
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

  const written = JSON.parse(read(dir, "ai-rules.json")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(written.extends, ["node_modules/ai-rules/recommended.json"]);
  assert.deepEqual(written.rulesDir, ["rules"]);
  assert.deepEqual(written.rules, {});
  assert.equal(read(dir, ".gitignore"), ".claude/rules/generated/\n");
});

test("never overwrites an existing config", () => {
  const dir = project("existing");
  writeFileSync(join(dir, "ai-rules.json"), '{"rules":{"ours/keep-me":"on"}}');

  const [config] = init(dir);
  assert.equal(config?.status, "exists");
  assert.match(
    read(dir, "ai-rules.json"),
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
