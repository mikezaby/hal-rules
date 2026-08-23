#!/usr/bin/env node
import { rmSync } from "node:fs";
import {
  DEFAULT_CONFIG,
  DEFAULT_OUT,
  bootstrap,
  build,
  init,
  loadConfig,
  readLock,
  validate,
  writeLock,
} from "./index.ts";
import { fetchSource, groupForDisplay, installSkills } from "./skills.ts";

const args = process.argv.slice(2);

if (args[0] === "skills" && args[1] === "list") {
  const spec = args[2];
  if (!spec) {
    console.error("usage: hal skills list github:owner/repo[#ref]");
    process.exit(1);
  }
  try {
    const { root, index, sha } = await fetchSource(spec);
    rmSync(root, { recursive: true, force: true });
    console.log(`${spec}  @ ${sha.slice(0, 8)}\n`);
    for (const [group, names] of groupForDisplay(index)) {
      console.log(`${group.padEnd(14)}${names.join(" · ")}\n`);
    }
    console.log('copy a path into your config, e.g. "engineering/tdd"');
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "validate") {
  try {
    const errors = validate(args[1] ?? DEFAULT_CONFIG);
    for (const error of errors) console.error(`  ${error}`);
    console.log(
      errors.length === 0 ? "config is valid" : `${errors.length} problem(s)`,
    );
    process.exit(errors.length === 0 ? 0 : 1);
  } catch (error) {
    // A malformed or unreadable config throws rather than returning a list.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "init") {
  for (const { path, status } of init(".", {
    expand: args.includes("--expand"),
  })) {
    console.log(
      status === "exists" ? `${path} exists — left alone` : `${status} ${path}`,
    );
  }
  console.log("\nnext:\n  edit hal-rules.json, then run: npx hal-rules");
  process.exit(0);
}

const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? DEFAULT_OUT : (args[outFlag + 1] ?? DEFAULT_OUT);
const config =
  args.find((arg, i) => !arg.startsWith("--") && i !== outFlag + 1) ??
  DEFAULT_CONFIG;

try {
  const written = build(config, out);
  console.log(`${written.length} rules -> ${out}`);

  const resolved = loadConfig(config);
  if (
    Object.keys(resolved.skills).length > 0 ||
    Object.keys(readLock().skills).length > 0
  ) {
    const previous = readLock().skills;
    const report = await installSkills(resolved.skills, ".", previous);
    for (const line of report.installed) console.log(`  skill ${line}`);
    for (const name of report.removed)
      console.log(`  removed skill ${name} (no longer in config)`);
    writeLock({ skills: report.lock });
  }

  for (const result of bootstrap(loadConfig(config))) {
    if (result.status === "empty") continue;
    if (result.status === "created") {
      console.log(`created ${result.path}`);
      continue;
    }
    console.log(`${result.path} exists — left alone`);
    for (const entry of result.missing)
      console.log(`  ! declared but absent: ${entry}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
