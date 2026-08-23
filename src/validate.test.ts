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
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { build, validate } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-validate-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project with a one-rule pack of its own. */
function project(name: string, config: unknown) {
  const dir = join(root, name);
  mkdirSync(join(dir, "rules/ours"), { recursive: true });
  writeFileSync(join(dir, "rules/ours/real.md"), "# Real\n- a real rule\n");
  const path = join(dir, "hal.json");
  writeFileSync(path, JSON.stringify(config));
  return { dir, path, out: join(dir, "out") };
}

test("reports every problem at once, not just the first", () => {
  const { path } = project("many", {
    rulesDir: ["rules"],
    rules: {
      "ours/real": "on",
      "ours/missing": "on",
      "ours/other-missing": "on",
    },
    plugins: {
      "figma@official": "on",
      "no-marketplace": "on",
      "bad-state@x": "yes",
    },
  });

  const errors = validate(path);
  assert.equal(errors.length, 4, errors.join(" | "));
  assert.ok(errors.some((e) => e.includes("ours/missing")));
  assert.ok(errors.some((e) => e.includes("ours/other-missing")));
  assert.ok(errors.some((e) => e.includes("no-marketplace")));
  assert.ok(errors.some((e) => e.includes("bad-state@x")));
});

test("a valid config reports nothing", () => {
  const { path } = project("clean", {
    rulesDir: ["rules"],
    rules: { "ours/real": "on" },
  });
  assert.deepEqual(validate(path), []);
});

test("a bad rule state is named, with what was expected", () => {
  const { path } = project("badstate", {
    rulesDir: ["rules"],
    rules: { "ours/real": true },
  });
  const [error] = validate(path);
  assert.match(String(error), /"ours\/real" is set to true/);
  assert.match(
    String(error),
    /expected "on", "off", or \["on", \{ var: "value" \}\]/,
  );
});

test("a failed build leaves the previous output untouched", () => {
  const good = project("atomic", {
    rulesDir: ["rules"],
    rules: { "ours/real": "on" },
  });
  build(good.path, good.out);
  const before = readFileSync(join(good.out, "ours/real.md"), "utf8");

  writeFileSync(
    good.path,
    JSON.stringify({
      rulesDir: ["rules"],
      rules: { "ours/real": "on", "ours/gone": "on" },
    }),
  );
  assert.throws(
    () => build(good.path, good.out),
    /1 problem\(s\) in the config/,
  );

  assert.equal(
    readFileSync(join(good.out, "ours/real.md"), "utf8"),
    before,
    "a config error must not destroy output that was already good",
  );
});

test("an unknown top-level key names the file that has it", () => {
  const { path } = project("typo", {
    rulesDir: ["rules"],
    rule: { "ours/real": "on" },
  });
  assert.throws(
    () => validate(path),
    (error: Error) => {
      assert.match(
        error.message,
        /unknown key\(s\) rule$|unknown key\(s\) rule\n/m,
      );
      assert.ok(
        error.message.includes(path),
        "the message must say which file",
      );
      return true;
    },
  );
});

test("an unknown key in an extended pack names that pack, not the project", () => {
  const base = project("basebad", { rulesDir: ["rules"], ruless: {} });
  const child = project("childok", { extends: [base.path], rules: {} });
  assert.throws(
    () => validate(child.path),
    (error: Error) => {
      assert.ok(error.message.includes(base.path));
      assert.ok(!error.message.includes(dirname(child.path) + "/hal.json"));
      return true;
    },
  );
  assert.ok(existsSync(base.path));
});
