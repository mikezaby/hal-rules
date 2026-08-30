# Changelog

**Pre-1.0: a minor bump may break the config format.** Rule wording changes are
listed as carefully as code changes, because a reworded rule changes what your
agent does.

Rule wording changes are listed as carefully as code changes: a reworded rule
changes what your agent does. After updating, `npx hal-rules --diff` shows
exactly which instructions moved.

## 0.8.0 (2026-08-30)

### Rules

- **Renamed and reversed** `git/worktrees-for-risky-work`, now
  `git/worktrees-by-default`. The old rule said to stay in the current checkout
  unless the work was risky. The new one says the opposite: real work gets a
  worktree, and only a fast one-off, one or two light prompts with nothing to
  return to, stays in the current checkout. The slug changed because the old one
  now describes the wrong policy, so a config naming the old slug fails the build
  until it is updated. That break is why this is a minor, not a patch.
- `git/worktrees-by-default` now takes a `worktreesDir` var, so a project picks
  where its worktrees go. `recommended` sets it to `.claude/worktrees`, keeping
  them inside the repo instead of scattering siblings next to it; the rule also
  says to gitignore that path. A config enabling the rule without extending
  `recommended` has to supply the var.
- `git/worktrees-by-default` now says to carry the ignored files a fresh
  worktree lacks (`.env` and friends) over from the main checkout, searching
  recursively so a monorepo's per-package ones come too.
- **Enabled** `git/worktrees-by-default` in `recommended`, so extending the pack
  now turns it on. The three rules still outside `recommended` are the ones
  needing a project-specific value.
- Adherence is unverified.

### Skills

- `research/manual-analyzer` now takes a local file path or a directory as well
  as a URL. The reading half always worked on a file on disk; the skill's own
  description said "given a URL", which is what decides when Claude reaches for
  it. A directory means every PDF under it, read one at a time with the file list
  printed first, so a twenty-manual scan is twenty passes and its size is visible
  before it starts. The rule generates and loads, but the probe in
  `docs/verifying-a-change.md` behaved the same with it on and off.

## 0.7.0 (2026-08-29)

### Rules

- **Added** `git/commit-granularity` (in `recommended`). One commit per coherent
  change, not one per work session. The first rule in the pack not carved from a
  `CLAUDE.md` in use somewhere; it was specified directly, and the README says so
  rather than letting the pack's provenance claim quietly cover it.

### Skills

- **Added** skills to the pack. A registry can hold a `skills/` directory beside
  its `rules/`, one `<topic>/<name>/SKILL.md` each, and the `skills` key now
  carries two shapes: a `github:owner/repo` key still maps to a list of paths to
  fetch, and any other key is a pack slug set to `"on"` or `"off"` the way a rule
  is. Existing configs are unaffected.
- There is no `skillsDir` key. A `skills/` beside a config counts when it is
  there, which is how a registry contributes its own and how a project shadows a
  pack skill by dropping the same slug in its own `skills/`. Last dir wins,
  matching how rule files resolve.
- **Added** `research/manual-analyzer`, the first skill in the pack. Give it a
  URL to another product's manual and it downloads the document, reads all of it,
  and writes `docs/research/<product>-<document>.md` covering overlapping
  features, gaps worth closing, the constraint numbers, and what is deliberately
  not worth copying. Every claim cites a page.
- No skill is in `recommended`. A rule is a standing constraint and belongs on by
  default; a skill is a procedure you invoke, so turning one on is a choice about
  how a team works.
- A config error in the `skills` key is now reported by `validate` alongside
  everything else: a slug no registry provides, a state that is not `"on"` or
  `"off"`, or a `github:` key that does not map to a list.

### Tool

- `hal-rules.lock.json` records a pack skill with its slug and no pin, since it
  came off disk. Fetched skills keep their ref and sha as before.
- Installed skills are committed either way. A fetched one is not reproducible
  from anything local, and a pack one lands in the same directory, so the whole
  of `.claude/skills/` is committed rather than half of it.

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
