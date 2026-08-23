# Changelog

Rule wording changes are listed as carefully as code changes: a reworded rule
changes what your agent does. After updating, `npx hal-rules --diff` shows
exactly which instructions moved.

## Unreleased

### Rules

- **Added** `safety/never-publish` — never run a publish or release command for
  any registry; prepare, dry-run, then hand the command to a human.
- **Added** `safety/never-deploy` — never run a command that changes a running
  system; build, plan and diff are yours, `apply` is not.
- **Added** `safety/bump-only-when-asked` — a version number states that a
  release is intended, which is a human's call.
- **Added** `documentation/architecture-decisions` — an ADR in the same commit,
  and never silently work around a recorded decision. Needs `adrDir`.
- **Removed** `code-style/no-nested-ternaries` — the guidance was Vue-specific.
- **Removed** `code-style/no-namespace-react` — house preference, not a principle.
- **Removed** `safety/never-apply-migrations` — half of it described Drizzle's
  workflow specifically.

### Tool

- `hal check` — read-only comparison of generated output against the config.
- `hal skills list` and the `skills` config key — cherry-pick individual skills
  from a GitHub repo instead of adopting a whole plugin. Pinned by SHA in
  `hal-rules.lock.json`.
- Generating now reports what changed since the last run, with `--diff` for the
  detail. No git and no `diff` binary involved.
- `checks` and other variables accept a list, rendered as markdown bullets.
- `hal init` scaffolds every rule that needs a variable, `"off"` with a worked
  example; `--expand` writes the inherited rules out to be toggled.
- Works in non-JS repos: `extends` accepts a bare specifier that falls back to
  the pack bundled in this package, so no `node_modules` is required.
- Config is validated before anything is written, so a bad config leaves the
  previous output untouched.

## 0.2.0

- Bootstrap `.claude/settings.json` and `.mcp.json` from the config; existing
  files are never rewritten, only reported on.
- `plugins`, `marketplaces`, `mcp` and `settings` compose through `extends`.

## 0.1.0

First release. Compose `.claude/rules/` from a shareable pack: `extends`,
per-rule `"off"`, `{{var}}` substitution, and project-shadows-pack resolution.
