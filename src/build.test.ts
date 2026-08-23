import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyVars, build } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const config = join(here, "fixtures/project/hal-rules.json");
const pack = join(here, "fixtures/pack/recommended.json");
const out = join(here, "fixtures/.out");
const read = (slug: string) => readFileSync(join(out, `${slug}.md`), "utf8");

test("a project config extends a pack and overrides it", () => {
  const written = build(config, out);

  assert.ok(
    !written.includes("code-style/no-magic"),
    "off should drop an inherited rule",
  );
  assert.ok(!existsSync(join(out, "code-style/no-magic.md")));
  assert.match(
    read("code-style/naming"),
    /our house style/,
    "project rulesDir shadows the pack",
  );
  assert.match(
    read("testing/framework"),
    /vitest/,
    "project vars override pack vars",
  );

  rmSync(out, { recursive: true, force: true });
});

test("the header lands after frontmatter, never before it", () => {
  build(pack, out); // unshadowed: the pack's copy has frontmatter

  assert.ok(
    read("code-style/naming").startsWith("---\n"),
    "YAML must stay on line 1",
  );
  assert.match(read("code-style/naming"), /---\n<!-- generated/);
  assert.ok(
    read("testing/framework").startsWith("<!-- generated"),
    "no frontmatter: header first",
  );

  rmSync(out, { recursive: true, force: true });
});

test("a rule turned off is deleted on rebuild, not left behind", () => {
  build(pack, out);
  assert.ok(existsSync(join(out, "code-style/no-magic.md")));

  build(config, out);
  assert.ok(
    !existsSync(join(out, "code-style/no-magic.md")),
    "a stale rule file would keep instructing Claude",
  );

  rmSync(out, { recursive: true, force: true });
});

test("the header drops a source path that climbs out of the project", () => {
  build(pack, out); // cwd is the repo: the pack is inside it, so the path is useful
  assert.match(
    read("code-style/no-magic"),
    /generated from code-style\/no-magic \(src\//,
  );
  rmSync(out, { recursive: true, force: true });

  const cwd = process.cwd();
  const elsewhere = mkdtempSync(join(tmpdir(), "hal-"));
  try {
    process.chdir(elsewhere); // now the pack lives outside the project, as node_modules would
    build(pack, out);
    const text = read("code-style/no-magic");
    assert.doesNotMatch(text, /\.\.\//, "a ../../.. path helps nobody");
    assert.match(
      text,
      /generated from code-style\/no-magic — edit it in the pack/,
    );
  } finally {
    process.chdir(cwd);
    rmSync(elsewhere, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("an unset variable fails the build instead of shipping the placeholder", () => {
  assert.throws(
    () => build(join(here, "fixtures/project/missing-var.json"), out),
    /uses \{\{framework\}\}/,
  );
});

test("applyVars replaces every occurrence", () => {
  assert.equal(applyVars("{{a}} and {{a}}", { a: "x" }, "slug"), "x and x");
});
