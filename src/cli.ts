#!/usr/bin/env node
import { rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  DEFAULT_CONFIG,
  DEFAULT_OUT,
  available,
  bootstrap,
  buildWithChanges,
  check,
  findAvailable,
  formatDiff,
  init,
  isListVar,
  loadConfig,
  readLock,
  setState,
  sync,
  summarise,
  validate,
  writeLock,
} from "./index.ts";
import { installPacks } from "./packs.ts";
import { fetchSource, groupForDisplay, installSkills } from "./skills.ts";

const args = process.argv.slice(2);

const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? DEFAULT_OUT : (args[outFlag + 1] ?? DEFAULT_OUT);
// Flags, and the value after --out, are not arguments. Reading args[1] directly
// made `check --out dir` treat the flag itself as the config path.
const positional = args.filter(
  (arg, i) => !arg.startsWith("--") && (outFlag === -1 || i !== outFlag + 1),
);
/** The config a subcommand was given, or the default. */
const configArg = (after: number): string =>
  positional[after] ?? DEFAULT_CONFIG;

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

const needs = (vars: string[]): string =>
  vars.length > 0 ? `   (needs ${vars.join(", ")})` : "";

if (args[0] === "list") {
  try {
    const { rules, skills } = available(configArg(1));
    for (const [title, items] of [
      ["rules", rules],
      ["skills", skills],
    ] as const) {
      console.log(`${title} (${items.length})`);
      for (const { slug, state, vars } of items)
        console.log(`  ${state.padEnd(6)}${slug}${needs(vars)}`);
      console.log();
    }
    const unset = [...rules, ...skills].filter((i) => i.state === "unset");
    if (unset.length > 0)
      console.log(
        `${unset.length} unset: your config never mentions them. Add the rules as "off" with: npx hal-rules@latest sync`,
      );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "enable" || args[0] === "disable") {
  const slug = positional[1];
  if (!slug) {
    console.error(`usage: hal ${args[0]} <slug> [var=value ...] [config]`);
    process.exit(1);
  }
  const state = args[0] === "enable" ? "on" : "off";
  const assignments = positional.slice(2).filter((a) => a.includes("="));
  const configPath =
    positional.slice(2).find((a) => !a.includes("=")) ?? DEFAULT_CONFIG;
  try {
    const item = findAvailable(configPath, slug);
    const values = Object.fromEntries(
      assignments.map((a) => {
        const at = a.indexOf("=");
        return [a.slice(0, at), a.slice(at + 1)];
      }),
    );
    const missing = item.missing.filter((name) => !(name in values));
    if (state === "on" && missing.length > 0) {
      if (!process.stdin.isTTY) {
        throw new Error(
          `"${slug}" needs ${missing.join(", ")}.\n` +
            `  Pass them: hal enable ${slug} ${missing.map((n) => `${n}=...`).join(" ")}`,
        );
      }
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      for (const name of missing) {
        const hint = isListVar(slug, name) ? " (comma separated)" : "";
        const answer = (await rl.question(`${name}${hint}: `)).trim();
        if (answer === "") {
          rl.close();
          throw new Error(`${name} is required to enable "${slug}"`);
        }
        values[name] = answer;
      }
      rl.close();
    }
    setState(configPath, item, state, values);
    console.log(
      `${slug} -> "${state}"${state === "on" ? ". Apply it: npx hal-rules@latest" : ""}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "sync") {
  try {
    const found = sync(configArg(1));
    if (found.length === 0) {
      console.log("nothing new. Every rule in your packs is in your config");
      process.exit(0);
    }
    console.log(`${found.length} rule(s) added as "off":`);
    for (const { slug, vars } of found) console.log(`  ${slug}${needs(vars)}`);
    console.log(
      '\nfill in any values, switch what you want to "on", then: npx hal-rules@latest',
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "check") {
  try {
    const problems = check(configArg(1), ".", out);
    for (const { what, fix } of problems)
      console.error(`  ${what}\n      ${fix}`);
    console.log(
      problems.length === 0
        ? "up to date"
        : `${problems.length} problem(s). Generated output does not match the config`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args[0] === "validate") {
  try {
    const errors = validate(configArg(1));
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
      status === "exists" ? `${path} exists, left alone` : `${status} ${path}`,
    );
  }
  console.log("\nnext:\n  edit hal-rules.json, then run: npx hal-rules@latest");
  process.exit(0);
}

const config = configArg(0);

try {
  const previous = readLock();
  // Packs land before anything reads the config: resolution is synchronous.
  const packs = await installPacks(config, ".", previous.packs, {
    update: args.includes("--update"),
  });
  for (const line of packs.installed) console.log(`  pack ${line}`);
  for (const spec of packs.removed)
    console.log(`  removed pack ${spec} (no longer in config)`);
  // An --update that found nothing new still hit the network; say so.
  if (
    args.includes("--update") &&
    packs.installed.length === 0 &&
    Object.keys(packs.lock).length > 0
  ) {
    console.log("  packs already current");
  }

  const { written, changes } = buildWithChanges(config, out);
  console.log(`${written.length} rules -> ${out}`);

  if (changes.length > 0) {
    console.log(`\n${changes.length} change(s) since the last run:`);
    for (const line of summarise(changes)) console.log(line);
    if (args.includes("--diff")) {
      for (const change of changes) {
        console.log(`\n${change.kind} ${change.slug}`);
        console.log(formatDiff(change));
      }
    } else {
      console.log("  (--diff to see what moved)");
    }
  }

  const resolved = loadConfig(config);
  let skills = previous.skills;
  if (
    Object.keys(resolved.skills).length > 0 ||
    Object.keys(previous.skills).length > 0
  ) {
    const report = await installSkills(
      resolved.skills,
      ".",
      previous.skills,
      resolved.skillsDirs,
    );
    for (const line of report.installed) console.log(`  skill ${line}`);
    for (const name of report.removed)
      console.log(`  removed skill ${name} (no longer in config)`);
    skills = report.lock;
  }
  writeLock({ skills, packs: packs.lock });

  for (const result of bootstrap(loadConfig(config))) {
    if (result.status === "empty") continue;
    if (result.status === "created") {
      console.log(`created ${result.path}`);
      continue;
    }
    console.log(`${result.path} exists, left alone`);
    for (const entry of result.missing)
      console.log(`  ! declared but absent: ${entry}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
