# Changelog

**Pre-1.0: a minor bump may break the config format.** Rule wording changes are
listed as carefully as code changes, because a reworded rule changes what your
agent does.

Rule wording changes are listed as carefully as code changes: a reworded rule
changes what your agent does. After updating, `npx hal-rules --diff` shows
exactly which instructions moved.

## 0.6.0 (2026-08-24)

### Rules

- **Added** `documentation/plain-prose` (in `recommended`). No em dashes, no
  marketing vocabulary, no reflexive three-item lists. Applies to docs, commit
  messages, PR text and comments.

### Tool

- Command output, error messages and the generated file header no longer use em
  dashes. The header text changed, so the first run after updating reports every
  rule as changed.
- Docs and command hints say `npx hal-rules@latest`. npx caches a bare name as
  `^<version you first ran>`, so a newer `0.x` satisfies the range and the old
  copy keeps running.
- **Added** registries in `extends`. An entry can be
  `{ "registry": ..., "preset": ..., "ref": ... }`, naming a directory that holds
  `<preset>.json` beside a `rules/` folder. `rules/` is convention, so extending
  a registry needs no `rulesDir` at all. `registry` takes a path, a package name,
  or `github:owner/repo[/dir]`; `preset` defaults to `recommended`. A registry
  with no `rules/`, a preset that is not there, or a `ref` on a path registry are
  each an error naming the path it looked for.
- **Added** `github:` sources. A pack can be a repo rather than a published
  package, so rules reach a project without waiting for a release. The checkout
  lands in `.hal/packs/`, pinned by commit in `hal-rules.lock.json`. Commit that
  directory: a pinned pack already on disk is never refetched, so builds and
  `check` stay offline and an upstream push cannot change what instructs Claude
  until someone runs `--update`.
- **Added** `--update`, which moves a pinned `github:` registry to its ref.
- **Changed** `init` scaffolds `{ "registry": "hal-rules" }` and no `rulesDir`.
  Existing configs are unaffected; every string form still resolves exactly as
  before, `github:owner/repo/config.json#ref` included.
- **Changed** `rulesDir` no longer defaults to a directory that is not there.
  The implicit `rules` counts only when it exists, so a chain of configs stops
  contributing phantom search paths. A `rulesDir` you declared is still searched
  either way, so a typo surfaces in the not-found error instead of resolving to
  nothing.
- **Fixed** `check --out <dir>` compared against the default directory. Every
  subcommand read its first argument as the config path, so the flag itself
  became a filename and the command failed on `ENOENT`.
- The rule pack moved to `registry/` inside the package. No config changes:
  `hal-rules/recommended.json` still resolves, through the published `exports`
  map for an install and through the bundled fallback without one.

## 0.5.0 — 2026-08-23

Versions 0.3.0 and 0.4.0 were prepared but never published; their changes are
included here.

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
- `hal outdated` and `hal sync` — find rules a pack offers that your config never
  mentions, and add them as `"off"` with example values. Nothing switches itself
  on.
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
