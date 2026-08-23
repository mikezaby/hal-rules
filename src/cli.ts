#!/usr/bin/env node
import {
  DEFAULT_CONFIG,
  DEFAULT_OUT,
  bootstrap,
  build,
  loadConfig,
} from "./index.ts";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? DEFAULT_OUT : (args[outFlag + 1] ?? DEFAULT_OUT);
const config =
  args.find((arg, i) => !arg.startsWith("--") && i !== outFlag + 1) ??
  DEFAULT_CONFIG;

try {
  const written = build(config, out);
  console.log(`${written.length} rules -> ${out}`);

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
