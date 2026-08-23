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
import { check, init, loadConfig, readLock, writeLock } from "./index.ts";
import {
  PACK_DIR,
  collectPacks,
  installPacks,
  packDir,
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
