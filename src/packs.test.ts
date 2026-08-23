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
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import {
  build,
  check,
  init,
  loadConfig,
  readLock,
  writeLock,
} from "./index.ts";
import {
  PACK_DIR,
  RULES_DIR,
  collectPacks,
  installPacks,
  packDir,
  packFromRef,
  parsePack,
  resolveExtends,
} from "./packs.ts";

const root = mkdtempSync(join(tmpdir(), "hal-packs-test-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

function project(name: string, config: Record<string, unknown>) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "hal-rules.json");
  writeFileSync(path, JSON.stringify(config));
  return { dir, path };
}

/** A checkout as `installPacks` would have left it: config plus its rules. */
function checkout(dir: string, spec: string, config: Record<string, unknown>) {
  const pack = parsePack(spec);
  const at = packDir(pack, dir);
  mkdirSync(join(at, "rules/pack"), { recursive: true });
  writeFileSync(join(at, "rules/pack/one.md"), "# One\n- from the pack\n");
  writeFileSync(join(at, pack.path), JSON.stringify(config));
  return at;
}

const locked = (spec: string, sha = "abc123def456") => ({
  [spec]: { source: spec, ref: "main", sha, path: PACK_DIR },
});

test("a spec splits into repo, path and ref, path before the ref", () => {
  assert.deepEqual(parsePack("github:me/pack/recommended.json#v2"), {
    source: { owner: "me", repo: "pack", ref: "v2" },
    path: "recommended.json",
    spec: "github:me/pack",
  });
  assert.deepEqual(
    parsePack("github:me/pack/configs/strict.json").path,
    "configs/strict.json",
  );
  assert.equal(parsePack("github:me/pack").path, "recommended.json");
  assert.equal(parsePack("github:me/pack#main").source.ref, "main");
});

test("a malformed spec says what was expected", () => {
  assert.throws(() => parsePack("github:me"), /expected github:owner\/repo/);
});

test("an unfetched pack names the path it looked in, not a missing rule", () => {
  const { dir } = project("cold", {});
  assert.throws(
    () => resolveExtends("github:me/pack/recommended.json", dir, dir),
    /is not fetched yet[\s\S]*npx hal-rules/,
  );
});

test("a fetched pack resolves, and its rulesDir points inside the checkout", () => {
  const { dir, path } = project("warm", {
    extends: ["github:me/pack/recommended.json"],
    rules: { "pack/one": "on" },
  });
  const at = checkout(dir, "github:me/pack", {
    rulesDir: ["rules"],
    rules: { "pack/one": "off" },
  });

  const config = loadConfig(path);
  assert.ok(
    config.rulesDirs.includes(join(at, "rules")),
    "the pack's own rules must be reachable after the config is read",
  );
  assert.equal(config.rules["pack/one"], "on", "the project still wins");
});

test("packs are found through a local extends, and through another pack", () => {
  const { dir, path } = project("nested", { extends: ["./base.json"] });
  writeFileSync(
    join(dir, "base.json"),
    JSON.stringify({ extends: ["github:me/outer/recommended.json"] }),
  );
  checkout(dir, "github:me/outer", {
    extends: ["github:me/inner/recommended.json"],
  });

  const found = collectPacks(path, dir).map((p) => p.spec);
  assert.deepEqual(found, ["github:me/outer", "github:me/inner"]);
});

test("a pinned pack that is already on disk is never refetched", async () => {
  const { dir, path } = project("pinned", {
    extends: ["github:me/pack/recommended.json#main"],
  });
  checkout(dir, "github:me/pack#main", { rulesDir: ["rules"] });

  // No network is reachable in a test; a fetch attempt would throw, not pass.
  const report = await installPacks(path, dir, locked("github:me/pack"));
  assert.deepEqual(
    report.installed,
    [],
    "nothing to do, so nothing was fetched",
  );
  assert.equal(report.lock["github:me/pack"]?.sha, "abc123def456");
});

test("dropping a pack from the config deletes its checkout", async () => {
  const { dir, path } = project("dropped", {});
  const at = checkout(dir, "github:me/gone", {});

  const report = await installPacks(path, dir, locked("github:me/gone"));
  assert.deepEqual(report.removed, ["github:me/gone"]);
  assert.deepEqual(collectPacks(path, dir), []);
  assert.equal(readLock(dir).packs["github:me/gone"], undefined);
  assert.ok(!existsSync(at), "a checkout nothing extends is left behind");
});

test("a lock written before packs existed still reads", () => {
  const dir = join(root, "old-lock");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "hal-rules.lock.json"),
    JSON.stringify({
      skills: {
        tdd: { source: "github:a/b", ref: "main", sha: "x", path: "p" },
      },
    }),
  );
  assert.deepEqual(readLock(dir).packs, {}, "no packs key is not a crash");
  assert.ok(readLock(dir).skills.tdd);
});

test("a pack pin survives a build that installs no skills", () => {
  const dir = join(root, "pack-only-lock");
  mkdirSync(dir, { recursive: true });
  writeLock({ skills: {}, packs: locked("github:me/pack") }, dir);
  assert.equal(readLock(dir).packs["github:me/pack"]?.sha, "abc123def456");
});

test("check reports an unfetched pack instead of drift in every rule", () => {
  const { dir, path } = project("check-cold", {
    extends: ["github:me/pack/recommended.json"],
    rules: { "pack/one": "on" },
  });
  const problems = check(path, dir);
  assert.equal(problems.length, 1, "one fact, not one per rule");
  assert.match(problems[0]?.what ?? "", /github:me\/pack is not fetched/);
});

test("check reports a checkout that no lock pins", () => {
  const { dir, path } = project("check-unpinned", {
    extends: ["github:me/pack/recommended.json"],
    rules: { "pack/one": "on" },
  });
  checkout(dir, "github:me/pack", { rulesDir: ["rules"] });
  const problems = check(path, dir);
  assert.match(problems[0]?.what ?? "", /absent from hal-rules.lock.json/);
});

test("init --expand survives a pack that is not fetched yet", () => {
  const dir = join(root, "expand-cold");
  mkdirSync(dir, { recursive: true });
  // The starter extends a bundled pack today; a `github:` one must not crash
  // init, which runs before anything has been fetched.
  assert.doesNotThrow(() => init(dir, { expand: true }));
  const written = JSON.parse(
    readFileSync(join(dir, "hal-rules.json"), "utf8"),
  ) as { rules: Record<string, unknown> };
  assert.ok(Object.keys(written.rules).length > 0, "a bare config still works");
});

test("a registry is a directory: preset beside a rules/ folder", () => {
  const { dir, path } = project("reg-basic", {
    extends: [{ registry: "./pack" }],
    rules: { "x/r": "on" },
  });
  mkdirSync(join(dir, "pack/rules/x"), { recursive: true });
  writeFileSync(join(dir, "pack/rules/x/r.md"), "# R\n");
  writeFileSync(join(dir, "pack/recommended.json"), "{}");
  writeFileSync(join(dir, "pack/strict.json"), '{"rules":{"x/r":"on"}}');

  const config = loadConfig(path);
  assert.ok(
    config.rulesDirs.includes(join(dir, "pack/rules")),
    "the convention supplies the rules dir, with no rulesDir declared anywhere",
  );
  assert.equal(
    resolveExtends({ registry: "./pack", preset: "strict" }, dir, dir),
    join(dir, "pack/strict.json"),
    "preset names the file",
  );
});

test("a registry missing its rules/ is named, not silently empty", () => {
  const dir = join(root, "reg-norules");
  mkdirSync(join(dir, "pack"), { recursive: true });
  writeFileSync(join(dir, "pack/recommended.json"), "{}");
  assert.throws(
    () => resolveExtends({ registry: "./pack" }, dir, dir),
    /has no rules\/ directory/,
  );
});

test("a preset that is not there names what it looked for", () => {
  const dir = join(root, "reg-nopreset");
  mkdirSync(join(dir, "pack/rules"), { recursive: true });
  writeFileSync(join(dir, "pack/recommended.json"), "{}");
  assert.throws(
    () => resolveExtends({ registry: "./pack", preset: "nope" }, dir, dir),
    /has no preset "nope"/,
  );
});

test("a ref on a path registry is a mistake, not ignored", () => {
  const dir = join(root, "reg-badref");
  mkdirSync(join(dir, "pack/rules"), { recursive: true });
  writeFileSync(join(dir, "pack/recommended.json"), "{}");
  assert.throws(
    () => resolveExtends({ registry: "./pack", ref: "main" }, dir, dir),
    /"ref" means nothing here/,
  );
});

test("a github registry may live in a subdirectory of its repo", () => {
  const entry = { registry: "github:me/pack/registry", preset: "strict" };
  const pack = packFromRef(entry);
  assert.equal(pack.path, join("registry", "strict.json"));
  assert.equal(pack.spec, "github:me/pack", "still one checkout per repo");

  const { dir, path } = project("reg-sub", {
    extends: [entry],
    rules: { "x/r": "on" },
  });
  const at = join(packDir(pack, dir), "registry");
  mkdirSync(join(at, "rules/x"), { recursive: true });
  writeFileSync(join(at, "rules/x/r.md"), "# R\n");
  writeFileSync(join(at, "strict.json"), "{}");

  assert.ok(loadConfig(path).rulesDirs.includes(join(at, "rules")));
  assert.deepEqual(
    collectPacks(path, dir).map((p) => p.spec),
    ["github:me/pack"],
  );
});

test("a github registry ref is pinned the same as a spec", async () => {
  const entry = { registry: "github:me/pack", ref: "main" };
  const { dir, path } = project("reg-pin", { extends: [entry] });
  checkout(dir, "github:me/pack", {});
  const report = await installPacks(path, dir, locked("github:me/pack"));
  assert.deepEqual(report.installed, [], "pinned and present, so no fetch");
});

test("a bare specifier names a registry, bundled or installed", () => {
  const dir = join(root, "reg-bare");
  mkdirSync(dir, { recursive: true });
  // Nothing is installed here, so this is the npx path: the registry shipped
  // inside this package, found without a node_modules to look in.
  const file = resolveExtends({ registry: "hal-rules" }, dir, dir);
  assert.equal(basename(file), "recommended.json");
  assert.ok(
    existsSync(join(dirname(file), RULES_DIR)),
    "and the rules/ convention holds for it too",
  );
});

test("an implicit rules dir that is not there is not searched", () => {
  const { dir, path } = project("no-own-rules", {
    extends: [{ registry: "./pack" }],
  });
  mkdirSync(join(dir, "pack/rules"), { recursive: true });
  writeFileSync(join(dir, "pack/recommended.json"), "{}");

  assert.deepEqual(
    loadConfig(path).rulesDirs,
    [join(dir, "pack/rules")],
    "no phantom ./rules from a project that never declared one",
  );
});

test("a declared rules dir that is not there still counts, so a typo shows", () => {
  const { dir, path } = project("typo-rules", {
    extends: [{ registry: "./pack" }],
    rulesDir: ["rulez"],
    rules: { "x/r": "on" },
  });
  mkdirSync(join(dir, "pack/rules"), { recursive: true });
  writeFileSync(join(dir, "pack/recommended.json"), "{}");

  assert.ok(loadConfig(path).rulesDirs.includes(join(dir, "rulez")));
  assert.throws(
    () => build(path, join(dir, "out")),
    /rulez/,
    "the searched paths name the typo rather than hiding it",
  );
});
