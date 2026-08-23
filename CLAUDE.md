# modular-skills

Version control for `~/.claude/`. Holds a personal, shareable ruleset built on
Claude Code's native `.claude/rules/` — one topic per markdown file, symlinked
into the home config so every machine gets the same set.

Rationale, options rejected, and the eslint-model comparison: `docs/HANDOFF.md`.

## Layout

```
rules/     one-topic-per-file .md, YAML frontmatter (`paths:` to glob-scope)
docs/      decision records
```

## Setup

```sh
ln -s ~/projects/me/modular-skills/rules ~/.claude/rules
```

Verify with `/context` (→ Memory files) and `/doctor`.

## Conventions

- One rule per file, named for the rule (`scope-discipline.md`).
- Generic rules live here; project-specific ones stay in that project's `.claude/rules/`.
- Rules are advisory. Anything that must *block* is a hook, not a rule.
- A multi-step procedure is a skill, not a rule.
- Write values inline — no templating, no vars.
