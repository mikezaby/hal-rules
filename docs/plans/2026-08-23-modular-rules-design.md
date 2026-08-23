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

`ai-rules.json`, resolved by `npx ai-rules`:

```json
{
  "extends": ["node_modules/@you/ai-rules/recommended.json"],
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

15 rules in `rules/`, carved from real CLAUDE.md files in use, blibliki
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

## Open — deliberately not answered yet

1. **Drift.** Once `settings.json` and `.mcp.json` are bootstrapped, how does a
   later change to the base reach an existing project? Report only, prompt,
   three-way merge? Undecided.
2. **Conflict management** when a bootstrapped file has been hand-edited and the
   pack also moved. Undecided.
3. Whether `plugins` and `mcp` compose through `extends` like `rules` do, or stay
   bootstrap-only.
4. Whether the tool ever shells out to `claude plugin install`, or only prints
   the commands a fresh clone still needs.
5. Per-rule `paths:` override from config. Today shadowing is whole-file only.
6. `.claude/agents/*.md` as a second emit target — the subagent finding says
   per-agent behavior can't be expressed as a rule.

## Not doing

- `type: "steps"` phase files (ai-rulesmith) — a procedure is a skill, not a rule.
- LLM-based rule testing (ai-rulesmith `scenario-tester`) — needs an API key,
  non-deterministic.
- Multi-agent fan-out to `.cursorrules` etc. until a second agent is actually in use.
