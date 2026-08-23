import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
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
  assert.deepEqual(written.extends, ["hal-rules/recommended.json"]);
  assert.deepEqual(written.rulesDir, ["rules"]);
  assert.deepEqual(
    (written.rules as Record<string, unknown>)["workflow/before-finish"],
    ["off", { checks: ["pnpm tsc", "pnpm lint", "pnpm test"] }],
    "scaffolded off but filled in: JSON has no comments, so show the shape",
  );
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
  const rules = written.rules as Record<string, unknown>;
  assert.equal(
    rules["demo/one"],
    "on",
    "an installed pack wins over the bundled one",
  );
  assert.deepEqual(
    rules["demo/two"],
    ["on", { a: "b" }],
    "vars survive expansion",
  );
  assert.ok(
    rules["workflow/before-finish"],
    "the scaffolded starter rule survives expansion",
  );
});

test("--expand falls back to the bundled pack when there is no node_modules", () => {
  // The npx case: a Rails or Python repo with nowhere to install a pack.
  const dir = project("nonode");
  init(dir, { expand: true });
  const written = JSON.parse(read(dir, "hal-rules.json")) as Record<
    string,
    unknown
  >;

  assert.deepEqual(written.extends, ["hal-rules/recommended.json"]);
  const rules = written.rules as Record<string, unknown>;
  assert.ok(
    Object.keys(rules).length > 0,
    "should expand from the packaged recommended.json",
  );
  assert.equal(rules["git/never-push"], "on");
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

test("every rule that needs a variable is scaffolded", () => {
  // Without this, enabling such a rule is a build error rather than a rule.
  // A new var-taking rule added to the pack must be added to the scaffold too.
  const packRules = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "rules",
  );
  const needsVars = readdirSync(packRules, {
    recursive: true,
    encoding: "utf8",
  })
    .filter((f) => f.endsWith(".md"))
    .filter((f) => /\{\{\w+\}\}/.test(readFileSync(join(packRules, f), "utf8")))
    .map((f) => f.replace(/\.md$/, "").replaceAll("\\", "/"));

  const dir = project("allvars");
  init(dir);
  const scaffolded = JSON.parse(read(dir, "hal-rules.json")) as {
    rules: Record<string, unknown>;
  };

  const recommended = JSON.parse(
    readFileSync(join(packRules, "..", "recommended.json"), "utf8"),
  ) as { rules: Record<string, unknown> };

  for (const slug of needsVars) {
    // Either the scaffold offers it, or recommended already supplies the value.
    const covered =
      slug in scaffolded.rules || Array.isArray(recommended.rules[slug]);
    assert.ok(covered, `${slug} needs a variable but nothing supplies one`);
  }
});
