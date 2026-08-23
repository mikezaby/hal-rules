> **Superseded on premise (2026-08-23).** This documents a _personal_ ruleset
> symlinked into `~/.claude/`. The project is a _project-scoped_ generator instead —
> see `../CLAUDE.md`. The mechanism research below is still accurate.

# Modular Claude rules — handoff

**Date:** 2026-08-23
**Status:** decided, not implemented
**Owner:** Michalis

## The question

The blibliki CLAUDE.md has grown a mix of project-specific and generic
instructions. The generic ones (scope discipline, before-finish checks, test
organization) should be shared across all projects and all machines.

The ask, refined over the conversation: not "where do I put shared prose" but
**"is there a tool with eslint's configuration model"** — a registry of named
rules, each independently enabled/disabled, tunable, composable, with shareable
base configs and per-path overrides.

## Answer

Mostly yes, and it's native to Claude Code. No dependency required.

`.claude/rules/` is a directory of one-topic-per-file markdown, auto-loaded,
with YAML frontmatter for glob scoping. It maps onto eslint's model:

| ESLint                     | Claude Code equivalent                                        |
| -------------------------- | ------------------------------------------------------------- |
| one rule = one module      | one rule = one `.md` in `.claude/rules/`                      |
| `extends` shareable config | symlink a shared dir into `.claude/rules/`                    |
| user → project cascade     | `~/.claude/rules/` loads first, project rules take priority   |
| `overrides[].files` glob   | `paths:` frontmatter on the rule file                         |
| turn a rule off            | `claudeMdExcludes` glob in settings (per layer, arrays merge) |
| `severity`                 | **no analogue**                                               |
| rule `options`             | **no analogue**                                               |

### Why the two gaps don't matter

- **severity** — eslint's `error`/`warn` means fail-the-build or don't. There is
  no build. The real binary is mechanism: CLAUDE.md/rules are always advisory,
  a hook is always blocking. Choosing where a rule lives _is_ the severity.
- **options/vars** — templating matters when shipping rules to strangers. For a
  personal ruleset, write the value into the file.

### `paths:` is the feature worth having

A rule scoped `paths: ["**/*.test.ts"]` is not loaded into context until a
matching file is opened. That's eslint `overrides` plus a token saving eslint
never needed to care about.

## Options evaluated and rejected

### mattpocock/skills

Skill bundle (`tdd`, `diagnosing-bugs`, `code-review`, `to-spec`, `to-tickets`,
...). Installable as a plugin or copied editable via `npx skills@latest add`.

**Rejected as a wholesale install.** Near 1:1 trigger overlap with superpowers,
which is already installed (`test-driven-development`, `systematic-debugging`,
`requesting-code-review`, `brainstorming`, `writing-plans`). Two skills both
claiming "use before writing implementation code" don't compose, they compete,
and the agent picks one arbitrarily. Cherry-picking individual skills later is
still fine.

### ai-rulesmith

`npm i -g ai-rulesmith` — explicitly eslint's mental model for agent rules.
`AI_RULES.json` lists rules by slug, include-to-enable, override hierarchy
project → global → built-in, `vars` for rule options, 29 built-in rules,
compiles to CLAUDE.md / .cursorrules / .windsurfrules / copilot-instructions.md
/ AGENTS.md.

**Right shape, dead vehicle.** Verified 2026-08-23:

- v0.4.3, created 2026-02-28, last publish 2026-03-01 — no release in ~6 months
- 24 downloads in the trailing month

Its genuine differentiator is multi-agent fan-out from one source. Only Claude
Code is in use here, so adopting it means taking an unmaintained dependency for
the one feature that isn't needed. Revisit only if a second agent enters the
picture.

## Decision

Build a personal ruleset on native `.claude/rules/`, version-controlled in this
repo, symlinked into `~/.claude/rules/`.

```
~/.claude/rules/  ->  symlink to this repo
  scope-discipline.md          # always on
  before-finish.md             # always on
  test-organization.md         # paths: ["**/*.test.*", "**/test/**"]
  no-namespace-react.md        # paths: ["**/*.tsx"]

blibliki/.claude/rules/        # stays in the blibliki repo
  audioworklet-init.md         # paths: ["packages/engine/src/modules/**"]
  web-audio-spec.md            # paths: ["packages/utils/src/Context*"]
```

Setup: `ln -s ~/projects/me/modular-skills/rules ~/.claude/rules`

Gets: version-controlled rules, same set on every machine, per-project disable
via one `claudeMdExcludes` glob, no build step to forget to run.

## Next steps

1. `git init` this repo, add a `rules/` directory
2. Carve the generic sections out of `blibliki/CLAUDE.md` into rule files:
   - Scope Discipline → `scope-discipline.md`
   - Before Finish → `before-finish.md` (phrase as "the project's" commands, not `pnpm`)
   - Test Structure and Organization → `test-organization.md` + `paths:`
   - "no namespace React imports" (under Style and Formatting) → `no-namespace-react.md` + `paths:`
3. Leave in `blibliki/CLAUDE.md`: repo structure, engine/transport architecture,
   the AudioWorklet init pattern, Web Audio spec compliance, the `pnpm` command list
4. Symlink, then verify with `/context` → **Memory files**, and `/doctor`
5. Consider moving the blibliki-specific pitfalls into that repo's own
   `.claude/rules/` with `paths:` scoping, so they stop loading on every session

## Notes

- Nothing under `~/.claude/` is version-controlled today. That's the actual gap
  this repo closes.
- No hooks are configured in either `~/.claude/settings.json` or the project's
  `settings.local.json`. Separate concern — rules are advisory by design; if a
  rule must be _enforced_ (blocking), it belongs in a hook, not here.
- Skills are a different mechanism from rules: rules load every session (or on
  path match), skills load on demand when invoked or judged relevant. A rule
  that's a multi-step procedure should be a skill instead.
- Caveat on research: "best skills 2026" listicles are SEO content farms and
  their star counts contradicted each other badly (one claimed 233k stars for a
  repo, another 40.9k for a different one). Treat popularity signals from those
  as unverified. The npm figures above came from the registry directly.

## Sources

- https://code.claude.com/docs/en/memory
- https://github.com/Luzgan/ai-rulesmith
- https://github.com/mattpocock/skills
