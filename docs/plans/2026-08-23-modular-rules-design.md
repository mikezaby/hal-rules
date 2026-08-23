# Design: project-scoped modular agent config

**Date:** 2026-08-23 · **Status:** requirements agreed, partially built

## Purpose

One committed config per project that a team evolves together, the way they
evolve `.eslintrc`: inherit a shared base, switch rules off, retune them, add
their own. The unit of reuse is the project, not the developer.

## Platform facts this rests on

Verified against code.claude.com/docs, 2026-08-23.

- `.claude/rules/*.md` load every session; `paths:` frontmatter defers a rule
  until a matching file is read. Symlinks in the directory are supported.
- **Subagents inherit the whole CLAUDE.md hierarchy, project rules included.**
  Built-in Explore and Plan agents skip it. Custom agents get their own system
  prompt, so per-agent behavior is a separate artifact, not a rule.
- Plugins and MCP are _already_ project-scoped and committed: `enabledPlugins`
  and `extraKnownMarketplaces` in `.claude/settings.json`, `mcpServers` in
  `.mcp.json`. superpowers, mattpocock/skills and figma all install this way.
- **Claude Code never writes `.claude/settings.json` itself.** Standing
  approvals, `/config` toggles and MCP approvals all land in
  `.claude/settings.local.json`, which it gitignores automatically.
- Settings files are strict JSON — no comments, so a generated one cannot
  announce itself in a header.
- A project-enabled plugin from an external source does not auto-install; the
  teammate must run `claude plugin install`.

## What this project owns

Only the gap: **plugins are all-or-nothing.** You enable superpowers whole; you
cannot take `test-driven-development` and drop `brainstorming`.
`claudeMdExcludes` is a path glob, not a rule name. Nothing native lets a team
inherit a rule pack and disable rule #3.

## Ownership model

| Artifact                                    | Mode                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `.claude/rules/generated/**`                | Generated. Wiped and rewritten every build. Hand edits here are lost by design. |
| `.claude/settings.json`                     | **Bootstrapped** — written if missing, then left alone.                         |
| `.mcp.json`                                 | **Bootstrapped** — same.                                                        |
| `.claude/rules/*.md` (outside `generated/`) | Never touched. Hand-written rules live here.                                    |
| `.claude/settings.local.json`               | Never touched. The per-developer override lane.                                 |

Bootstrapping rather than overwriting keeps the generator out of files that
hold team `permissions`, `hooks`, `env` and `model` — things it has no business
modeling, and modeling them is how a config tool becomes a strictly-worse
`settings.json` with a schema to maintain forever.

## Config

`hal-rules.json`, resolved by `npx hal-rules`:

```json
{
  "extends": ["node_modules/@you/hal-rules/recommended.json"],
  "rulesDir": ["rules"],
  "rules": {
    "code-style/no-hardcoded-values": "off",
    "testing/never-weaken-tests": ["on", { "framework": "vitest" }],
    "ours/deploy-checklist": "on"
  }
}
```

- `extends` is a **path** relative to the config file. `node_modules/…`, a
  submodule dir and `./base.json` all work, so distribution needs no fetch
  layer, cache or registry.
- Configs merge in order, later wins: extends first, own `rules` last.
- Rule _files_ resolve last-`rulesDir`-first, so a project shadows a pack's rule
  by dropping its own `<slug>.md` in place. Shadowing replaces the whole file,
  `paths:` frontmatter included.
- `"off"` drops an inherited rule; the out dir is wiped each build so it stops
  instructing Claude rather than lingering.
- `{{var}}` is substituted from the config. An unset one **fails the build** —
  shipping a literal `{{framework}}` as an instruction is worse than a red CI.

## Built

`index.js`, ~90 lines, no dependencies. Rules only. `node --test` covers
resolution order, shadowing, `off`, stale-file removal and the unset-var guard.

## Pack

16 rules in `rules/`, carved from real CLAUDE.md files in use, blibliki
among them. Folders: `workflow`, `git`, `documentation`,
`testing`, `code-style`, `architecture`, `safety`.

Recurrence across them is thin and worth recording honestly — only four
rules showed up in more than one project (`scope-discipline`, `before-finish`,
`never-push`, `mark-deliberate-simplifications`). Everything else is single-source.

Two findings the carve confirmed about the design:

- **`before-finish` is the case that justifies `{{vars}}`.** Identical rule,
  different commands depending on the stack: `pnpm tsc/lint/test/format` in
  blibliki, a Rails project's own test/lint/security commands elsewhere.
- **`scope-discipline` and `out-of-scope-findings` are one rule with a
  project-specific tail**, not two rules — only one of the source projects
  names a findings file.

Most of what is in a CLAUDE.md is not a rule at all — architecture prose,
command lists, file inventories. That stays in each project's own file.

## Remaining work

Eight items. Three are decisions with no code until they are made; five are
buildable now.

### Blocked on a decision

1. **Drift resolution.** Bootstrap _reports_ what an existing file lacks
   (`! declared but absent: enabledPlugins.figma@claude-plugins-official`).
   How a change actually reaches that file — prompt, patch, three-way merge —
   is undecided.
2. **Conflict management** when a bootstrapped file has been hand-edited _and_
   the pack moved. Undecided. This and (1) are one question wearing two hats:
   what happens when the config and an existing file disagree.
3. **`claude plugin install`.** Does the tool shell out, or only print the
   commands a fresh clone still needs? Printing is the safer default — shelling
   out to a network-installing command unasked is the kind of thing that
   surprises people.

### Buildable

4. ~~**`--check` for CI.**~~ **Built as `hal check`.** Read-only comparison of
   generated output against the config. One finding along the way: because
   generated rules are gitignored, a fresh CI checkout has nothing to compare, so
   for rules this is a local pre-flight rather than a CI gate. It is a true CI
   gate for skills, which are committed. Making generated rules committable would
   turn it into a full gate — an open option, not a decision.
5. **Per-rule `paths:` override from config.** Shadowing replaces the whole file
   today, frontmatter included, so a rule's globs cannot be retargeted without
   copying it.
6. **`.claude/agents/*.md` emit.** The second target the subagent finding turned
   up: per-agent behaviour cannot be expressed as a rule.
7. **Publish to npm.** Nothing works via `npx` for anyone until this happens.
8. **Prove it on a real repo.** Point blibliki's `hal-rules.json` at the pack and
   diff the generated rules against what its CLAUDE.md says today.

### Suggested order

**(8) first, before any of the code.** Everything so far is verified against
fixtures and scratch directories. Running it on blibliki is what turns the pack
from a plausible artifact into a used one — and it answers (1) and (2) with
evidence rather than speculation, because it meets a real `settings.json` that
disagrees with the config.

### Decided along the way

- `plugins` and `mcp` compose through `extends` like `rules`. Same merge, later
  wins, one code path for every declaration kind.
- Published flat as `hal`, not user-scoped. A personal scope reads as a side
  project for something teams are asked to commit as shared infrastructure, and
  `init` covers the `pnpm create` path that scoping would have preserved.

## Not doing

- `type: "steps"` phase files (ai-rulesmith) — a procedure is a skill, not a rule.
- LLM-based rule testing (ai-rulesmith `scenario-tester`) — needs an API key,
  non-deterministic.
- Multi-agent fan-out to `.cursorrules` etc. until a second agent is actually in use.
