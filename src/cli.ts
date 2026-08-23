#!/usr/bin/env node
import { DEFAULT_CONFIG, DEFAULT_OUT, build } from "./index.ts";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? DEFAULT_OUT : (args[outFlag + 1] ?? DEFAULT_OUT);
const config =
  args.find((arg, i) => !arg.startsWith("--") && i !== outFlag + 1) ??
  DEFAULT_CONFIG;

try {
  const written = build(config, out);
  console.log(`${written.length} rules -> ${out}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
