#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const DEFAULT_CONFIG = 'ai-rules.json';
const DEFAULT_OUT = '.claude/rules/generated';

// Later configs win, exactly like eslint: extends first, own `rules` last.
export function loadConfig(file, loaded = new Set()) {
  const path = resolve(file);
  const out = { rulesDirs: [], rules: {} };
  if (loaded.has(path)) return out; // diamond or cycle: first load already applied it
  loaded.add(path);

  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  const base = dirname(path);
  for (const ext of cfg.extends ?? []) {
    const sub = loadConfig(resolve(base, ext), loaded);
    out.rulesDirs.push(...sub.rulesDirs);
    Object.assign(out.rules, sub.rules);
  }
  out.rulesDirs.push(...(cfg.rulesDir ?? ['rules']).map((d) => resolve(base, d)));
  Object.assign(out.rules, cfg.rules ?? {});
  return out;
}

// Last dir wins so a project can shadow a pack's rule by slug.
function findRule(slug, dirs) {
  for (const dir of [...dirs].reverse()) {
    const path = join(dir, `${slug}.md`);
    if (existsSync(path)) return path;
  }
  throw new Error(`Rule not found: ${slug}\n  looked in:\n    ${[...dirs].reverse().join('\n    ')}`);
}

export function applyVars(body, vars, slug) {
  let out = body;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  const left = out.match(/\{\{(\w+)\}\}/);
  // Shipping "{{framework}}" to Claude as an instruction is worse than failing.
  if (left) throw new Error(`Rule "${slug}" uses {{${left[1]}}} but no value was given.\n  Set it: "${slug}": ["on", { "${left[1]}": "..." }]`);
  return out;
}

// Header goes after frontmatter — YAML has to start at line 1.
function withHeader(body, slug, src) {
  const note = `<!-- generated from ${slug} (${src}) — edit the source, then rerun ai-rules -->`;
  const fm = body.match(/^---\n[\s\S]*?\n---\n/);
  return fm ? `${fm[0]}${note}\n${body.slice(fm[0].length)}` : `${note}\n${body}`;
}

export function build(configPath, outDir) {
  const { rulesDirs, rules } = loadConfig(configPath);
  rmSync(outDir, { recursive: true, force: true });
  const written = [];
  for (const [slug, state] of Object.entries(rules)) {
    const [on, vars = {}] = Array.isArray(state) ? state : [state];
    if (on === 'off') continue;
    const src = findRule(slug, rulesDirs);
    const body = applyVars(readFileSync(src, 'utf8'), vars, slug);
    const dest = join(outDir, `${slug}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, withHeader(body, slug, src));
    written.push(slug);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const out = outFlag === -1 ? DEFAULT_OUT : args[outFlag + 1];
  const config = args.find((a, i) => !a.startsWith('--') && i !== outFlag + 1) ?? DEFAULT_CONFIG;
  try {
    const written = build(config, out);
    console.log(`${written.length} rules -> ${out}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
