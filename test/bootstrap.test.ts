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
import { bootstrap, loadConfig } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-bootstrap-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a config (plus any extra files) into a fresh project dir. */
function project(
  name: string,
  config: unknown,
  files: Record<string, unknown> = {},
) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "hal-rules.json");
  writeFileSync(path, JSON.stringify(config));
  for (const [rel, body] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(body));
  }
  return { dir, path };
}

const read = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

test("creates settings.json with the object-of-booleans plugin shape", () => {
  const { dir, path } = project("plugXX", {
    marketplaces: {
      "my-team": { source: { source: "github", repo: "org/plugins" } },
    },
    plugins: {
      "figma@claude-plugins-official": "on",
      "noisy@claude-community": "off",
    },
    settings: { permissions: { allow: ["Bash(pnpm test:*)"] } },
  });

  const [settings] = bootstrap(loadConfig(path), dir);
  assert.equal(settings?.status, "created");

  const written = read(join(dir, ".claude/settings.json"));
  assert.deepEqual(written.enabledPlugins, {
    "figma@claude-plugins-official": true,
    "noisy@claude-community": false,
  });
  assert.deepEqual(written.extraKnownMarketplaces, {
    "my-team": { source: { source: "github", repo: "org/plugins" } },
  });
  assert.deepEqual(
    written.permissions,
    { allow: ["Bash(pnpm test:*)"] },
    "passthrough survives",
  );
});

test("wraps mcp servers under mcpServers, and skips the file when none declared", () => {
  const withMcp = project("mcpXXX", {
    mcp: { "internal-api": { command: "./bin/mcp" } },
  });
  const [, mcp] = bootstrap(loadConfig(withMcp.path), withMcp.dir);
  assert.equal(mcp?.status, "created");
  assert.deepEqual(read(join(withMcp.dir, ".mcp.json")), {
    mcpServers: { "internal-api": { command: "./bin/mcp" } },
  });

  const without = project("bareXX", { rules: {} });
  const [settings, none] = bootstrap(loadConfig(without.path), without.dir);
  assert.equal(none?.status, "empty");
  assert.equal(
    settings?.status,
    "empty",
    "nothing declared means nothing written",
  );
  assert.ok(
    !existsSync(join(without.dir, ".mcp.json")),
    "no empty file left behind",
  );
});

test("an existing file is never rewritten; what it lacks is reported", () => {
  const { dir, path } = project(
    "driftX",
    {
      plugins: {
        "figma@claude-plugins-official": "on",
        "linear@claude-plugins-official": "on",
      },
    },
    { ".mcp.json": { mcpServers: { kept: { command: "x" } } } },
  );
  const settingsPath = join(dir, ".claude/settings.json");
  const hand = {
    enabledPlugins: { "figma@claude-plugins-official": true },
    model: "opus",
  };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(hand));

  const [settings] = bootstrap(loadConfig(path), dir);
  assert.equal(settings?.status, "exists");
  assert.deepEqual(settings.missing, [
    "enabledPlugins.linear@claude-plugins-official",
  ]);
  assert.deepEqual(
    read(settingsPath),
    hand,
    "the hand-written file is untouched",
  );
});

test("plugins and mcp compose through extends, later wins", () => {
  const base = project("baseXX", {
    plugins: {
      "figma@claude-plugins-official": "on",
      "noisy@claude-community": "on",
    },
    mcp: { shared: { command: "base" } },
  });
  const { dir, path } = project("childX", {
    extends: [base.path],
    plugins: { "noisy@claude-community": "off" },
    mcp: { own: { command: "child" } },
  });

  const resolved = loadConfig(path);
  assert.deepEqual(resolved.plugins, {
    "figma@claude-plugins-official": "on",
    "noisy@claude-community": "off",
  });
  assert.deepEqual(Object.keys(resolved.mcp).sort(), ["own", "shared"]);

  bootstrap(resolved, dir);
  const written = read(join(dir, ".claude/settings.json"));
  assert.deepEqual(written.enabledPlugins, {
    "figma@claude-plugins-official": true,
    "noisy@claude-community": false,
  });
});
