import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bootstrap, build, loadConfig } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "hal-readme-test-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const README = join(dirname(fileURLToPath(import.meta.url)), "..", "README.md");

/** The json block under a heading, as written. */
function example(heading: string): string {
  const source = readFileSync(README, "utf8");
  const found = new RegExp(
    `## ${heading}\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``,
  ).exec(source);
  assert.ok(found, `no json example under "## ${heading}"`);
  return found[1] ?? "";
}

// The README is the config reference, and the format has changed under it more
// than once. Running the example is the only thing that keeps it honest.
test("the Configure example is a config that actually builds", () => {
  const dir = join(root, "configure");
  mkdirSync(join(dir, "rules/ours"), { recursive: true });
  writeFileSync(
    join(dir, "rules/ours/deploy-checklist.md"),
    "---\nname: Deploy Checklist\n---\n# Deploy Checklist\n- ours\n",
  );
  const path = join(dir, "hal-rules.json");
  writeFileSync(path, example("Configure"));

  const written = build(path, join(dir, "out"));
  assert.ok(
    written.includes("ours/deploy-checklist"),
    "a project's own rule resolves through its rulesDir",
  );
  assert.ok(
    written.includes("workflow/before-finish"),
    "a rule tuned with vars renders",
  );
  assert.ok(
    !written.includes("architecture/reuse-existing-components"),
    'a rule switched "off" is dropped from an inherited pack',
  );

  // The bootstrap keys in the same example must land where the table says.
  const config = loadConfig(path);
  assert.equal(
    config.skills["research/manual-analyzer"],
    "on",
    "a pack skill in the example resolves; build would have thrown otherwise",
  );
  const [settings, mcp] = bootstrap(config, dir);
  assert.equal(settings?.status, "created");
  assert.equal(mcp?.status, "created");
  const wrote = JSON.parse(
    readFileSync(join(dir, ".claude/settings.json"), "utf8"),
  ) as Record<string, Record<string, unknown>>;
  assert.ok(wrote.extraKnownMarketplaces?.["my-team"]);
  assert.equal(wrote.enabledPlugins?.["figma@claude-plugins-official"], true);
});
