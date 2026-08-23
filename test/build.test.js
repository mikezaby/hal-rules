import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, applyVars } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = join(here, 'fixtures/project/ai-rules.json');
const out = join(here, 'fixtures/.out');
const read = (slug) => readFileSync(join(out, `${slug}.md`), 'utf8');

test('project config extends a pack and overrides it', () => {
  const written = build(config, out);

  assert.ok(!written.includes('code-style/no-magic'), 'off should drop an inherited rule');
  assert.ok(!existsSync(join(out, 'code-style/no-magic.md')));

  assert.match(read('code-style/naming'), /our house style/, 'project rules dir shadows the pack by slug');
  assert.match(read('testing/framework'), /vitest/, 'project vars override pack vars');

  rmSync(out, { recursive: true, force: true });
});

test('header lands after frontmatter, never before it', () => {
  build(join(here, 'fixtures/pack/recommended.json'), out); // unshadowed: this one has frontmatter
  assert.ok(read('code-style/naming').startsWith('---\n'), 'YAML must stay on line 1');
  assert.match(read('code-style/naming'), /---\n<!-- generated/);
  assert.ok(read('testing/framework').startsWith('<!-- generated'), 'no frontmatter: header goes first');
  rmSync(out, { recursive: true, force: true });
});

test('a rule turned off is deleted on rebuild, not left behind', () => {
  build(join(here, 'fixtures/pack/recommended.json'), out);
  assert.ok(existsSync(join(out, 'code-style/no-magic.md')));
  build(config, out);
  assert.ok(!existsSync(join(out, 'code-style/no-magic.md')), 'stale rule would keep instructing Claude');
  rmSync(out, { recursive: true, force: true });
});

test('an unset variable fails the build instead of shipping the placeholder', () => {
  assert.throws(
    () => build(join(here, 'fixtures/project/missing-var.json'), out),
    /uses \{\{framework\}\}/,
  );
});

test('applyVars replaces every occurrence', () => {
  assert.equal(applyVars('{{a}} and {{a}}', { a: 'x' }, 's'), 'x and x');
});
