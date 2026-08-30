# modular-skills

**Status: work in progress, pre-1.0.** The config format is not frozen — a minor
bump may break it. Rules are still being added and removed as they prove
themselves. Published to npm as `hal-rules`; this repo directory is still named
`modular-skills`.

A rule registry and generator for AI-agent config, checked into the _project_
it configures. One team, one committed source of truth: run the generator, get
`CLAUDE.md` / `.claude/` files every developer on the repo shares.

Not a personal `~/.claude` setup. Not a skill bundle. The unit of reuse is the
project, not the developer.

## The model is eslint's

- a **registry** of small, named, independently-addressable rules
- a **shareable base config** a project extends
- each rule **on or off** per project
- each rule **tunable** (options), because "which" is rarely the whole answer
- projects **add their own** rules that ship with nobody else's
- config is **committed**, so the team evolves it in review like any other code

Teams don't adopt a ruleset, they negotiate one. The config file is where that
negotiation lives.

## Prior art

`docs/ai-rulesmith-review.md` — teardown of the closest existing thing. Take
its rule file format, slug namespace, `vars` substitution and target adapters;
it has no `extends` and no disable, which is the half that matters here.

`docs/HANDOFF.md` — earlier conversation. Its research on Claude Code's native
`.claude/rules/` mechanism stands; its conclusion (personal ruleset symlinked
into `~/.claude/`) was the wrong problem.

## How it works

`hal-rules.json` per project, eslint-shaped:

```json
{
  "extends": [{ "registry": "@you/hal-rules" }],
  "rulesDir": ["rules"],
  "rules": {
    "code-style/no-hardcoded-values": "off",
    "testing/never-weaken-tests": ["on", { "framework": "vitest" }],
    "ours/deploy-checklist": "on"
  }
}
```

Plus the bootstrap keys:

```json
{
  "marketplaces": {
    "my-team": { "source": { "source": "github", "repo": "org/plugins" } }
  },
  "plugins": { "figma@claude-plugins-official": "on" },
  "mcp": { "internal-api": { "command": "./bin/mcp-server" } },
  "settings": { "permissions": { "allow": ["Bash(pnpm test:*)"] } }
}
```

`npx hal-rules@latest` writes `.claude/rules/generated/<slug>.md`. Gitignore that dir —
the config is the artifact under review, not the output.

**Works in non-JS repos.** `extends` accepts a bare specifier, which falls back to
the pack bundled in this package when there is no `node_modules`, so a Rails or
Python project needs no install and gets no `package.json`. Two bin names ship:
`hal` for local installs, `hal-rules` because `npx hal` would fetch an unrelated
package of that name.

`.claude/settings.json` and `.mcp.json` are **bootstrapped, not owned**: written when
absent, and on every later run left untouched with a report of what they lack.
Claude Code never writes `settings.json` itself, but people and `/plugin install`
do, and overwriting that to assert a source of truth costs more than it buys.
Merging is still an open decision.

`plugins` maps `"name@marketplace"` to on/off and lands as
`enabledPlugins`, an **object of booleans** — `"off"` writes `false`, which
actively disables, rather than being omitted. `settings` is spliced in verbatim,
so no Claude Code setting needs modelling here. All four keys compose through
`extends` exactly as `rules` do.

Resolution:

- `extends` entries are either `{ registry, preset?, ref? }` — a directory holding
  `<preset>.json` beside a `rules/`, by convention, so no `rulesDir` is needed;
  `registry` takes a path, a package name (what `init` scaffolds) or
  `github:owner/repo[/dir]` —
  or a config file directly: a **path** relative to the config file
  (`node_modules/...`, a submodule dir, `./base.json`), a bare specifier falling
  back to the bundled pack, or `github:owner/repo[/config.json][#ref]`. A
  registry with no `rules/` is an error, not an empty search. A GitHub source is fetched
  into `.hal/packs/` (committed, like skills) and pinned by SHA in the lock file;
  a pinned pack already on disk is never refetched, so builds and `check` stay
  offline until `--update`.
- Configs merge in order, later wins — extends first, own `rules` last.
- Rule _files_ resolve last-`rulesDir`-first, so a project shadows a pack rule by
  dropping its own `<slug>.md` in place. Shadowing replaces the whole file, `paths:`
  frontmatter included.
- `"off"` drops an inherited rule. The out dir is wiped each build, so a rule turned
  off stops instructing Claude instead of lingering as a stale file.
- `rulesDir` is for a project's **own** rule files. An unset default that is not
  on disk is not searched; a declared one that is missing still is, so a typo
  surfaces instead of resolving to nothing.
- `{{var}}` in a rule body is substituted from the config. An unset one is a build
  error, never passed through to Claude.

## Toolchain

TypeScript in `src/`, ESM, built with tsdown. Config extracted from blibliki:
eslint flat config (`strictTypeChecked` + `stylisticTypeChecked`, `projectService`),
prettier with the trivago import sorter, strict tsconfig with `noUncheckedIndexedAccess`.

`hal list` prints every rule and skill on offer with its config state (`on`,
`off`, `unset`) and the vars it needs; `hal sync` adds the unset rules as
`"off"`. `outdated` was folded into `list`. `hal enable <slug> [var=value]` and
`hal disable <slug>` flip one rule or skill in the project's own config,
prompting for any var still blank when there is a terminal. `hal check` compares generated output against the config, read-only, exiting
non-zero on drift. Rules are gitignored so it is a local pre-flight for them;
for committed skills it is a real CI gate.

`hal validate` reports every config problem at once and exits non-zero.
`build` runs the same checks and writes nothing if any fail, so a bad config
cannot leave the previous output half-wiped.

```
pnpm build   tsdown -> dist/*.mjs + .d.mts
pnpm test    node --test on test/*.test.ts (Node strips types natively, no test dep)
pnpm tsc     typecheck
pnpm lint    eslint src test
pnpm format  prettier . --write
```

Published flat as `hal-rules`, not scoped: a personal scope reads as a side
project for something teams are asked to commit as shared infrastructure. The bin
is `hal`, the config is `hal-rules.json`. `create-hal-rules` is free, so `pnpm create
hal-rules` stays open — unlike `create-ai-rules`, which is taken and closed that
path under the old name.

Taglines: **"I'm sorry Dave, I'm afraid I can't do that."** and **"Don't let the
agent decide what your team's standards are."** HAL fits because it failed on
_contradictory instructions it could not reconcile_ — the exact hazard Claude
Code's own docs warn about when rules conflict.

## The pack

`registry/` holds the pack, kept apart from the generator's code in `src/`.
`registry/skills/` sits beside it, one `<topic>/<name>/SKILL.md` directory per
skill. `registry/rules/` is one file per rule, foldered by topic:
`workflow` · `git` · `documentation` · `testing` · `code-style` · `architecture` · `safety`

Every rule was carved from a CLAUDE.md that was actually in use, blibliki among
them. No rule exists here without a source line in one of them — the pack is
evidence, not invention. One exception: `git/commit-granularity`, added on
direct instruction rather than lifted from any real CLAUDE.md.

The pack's skills carry no such provenance rule. `research/manual-analyzer`, the
first one, `workflow/project-new-task` and its counterparts
`workflow/project-update-task` and `workflow/project-pull-request` were specified directly. Skills are procedures rather than standing
constraints, so none is in `recommended`.

`registry/recommended.json` enables fifteen of them. The three left opt-in each need
a project-specific value: `workflow/before-finish` (`checks`),
`workflow/out-of-scope-findings` (`findingsFile`),
`documentation/architecture-decisions` (`adrDir`).

Only four rules appeared in more than one project: `scope-discipline`,
`before-finish`, `never-push`, `mark-deliberate-simplifications`. The rest are
single-source, which is worth remembering before treating the pack as settled.

## Status

Rules generator and the `settings.json` / `.mcp.json` bootstrap both work;
10 tests cover resolution, composition and drift reporting.

README covers usage, the config reference, rule authoring and the pack; its example
config is verified by running it.

`hal init` scaffolds a config and gitignores the output; it never overwrites an
existing config. `--expand` spells out the inherited rules so they can be toggled,
at the cost of pinning today's set instead of inheriting later additions.

**The full remaining-work list — nine items, three of them decisions — lives in
`docs/plans/2026-08-23-modular-rules-design.md` under "Remaining work".** Keep it
there rather than in chat. This is the deliberate exception to
`documentation/no-scratch-files`, which is on here and otherwise forbids a plan
file: the design doc is a real doc in its proper place, not a scratch pad, and it
outlives the conversation that produced it. The usual fix — shadow the rule from
your own `rulesDir` — is unavailable to the one repo whose `rulesDir` _is_ the
pack, so the carve-out is stated here.

Requirements and the open questions: `docs/plans/2026-08-23-modular-rules-design.md`.

**Adding or changing a rule? Follow `docs/verifying-a-change.md`.**
`./scripts/verify-loading.sh` automates the loading half: canary rule, real
`claude -p` session in a throwaway project, plus the rule-off control run.
`./scripts/verify-subagent.sh` does the same for subagent inheritance. A green test
suite proves the file was written, never that Claude follows it — a rule is only
verified when the same prompt behaves differently with it on and off.

## Skills

The `skills` key carries two shapes. A `github:owner/repo` key fetches selected
skills from that repo into `.claude/skills/<name>/`, pinned by SHA in
`hal-rules.lock.json`. Any other key is a slug under a registry's `skills/`
directory, `"on"`, `"off"` or `["on", { vars }]` the way a rule is, with the
same `{{var}}` substitution over `SKILL.md`, resolved last-dir-wins so a
project shadows a pack skill by dropping the slug in its own `skills/`. There is
no `skillsDir` key: a `skills/` beside a config counts when it is there, which is
also how a registry contributes its own. An `mcp.json` beside a pack skill's
`SKILL.md`, keyed var → value → servers, adds those servers to `.mcp.json` when
the skill is on with that value; the project's own `mcp` wins on a name clash.
Config names fetched skills by the
source's own folders (`engineering/tdd`); disk is flat because **Claude Code discovers skills
exactly one level deep and the directory name is the command** — measured, and a
nested directory silently never loads. Installed skills are committed, not
gitignored: a fetched one is not reproducible from anything local, and a pack one
lands in the same directory, so the whole of `.claude/skills/` is committed
rather than half of it.

## Mechanism facts (verified 2026-08-23, code.claude.com/docs)

- `.claude/rules/*.md` load every session at `.claude/CLAUDE.md` priority;
  a `paths:` glob in frontmatter defers loading until a matching file is read.
- **Subagents inherit the whole CLAUDE.md hierarchy, project rules included.**
  Not inherited: conversation history, read files, invoked skills, parent auto memory.
  **Measured** — `./scripts/verify-subagent.sh`.
- Built-in **Explore and Plan agents skip CLAUDE.md and rules entirely.**
  **Measured** — `AGENT=Explore ./scripts/verify-subagent.sh`.
- Custom agents (`.claude/agents/*.md`) supply their own system prompt and get
  "only this system prompt plus basic environment details" — so per-agent
  behavior is a second emit target, not something a rule file can express.
- Rules are advisory context, never enforcement. Blocking belongs in a hook.
- `claudeMdExcludes` (glob, any settings layer, arrays merge) is the only native
  off switch — path-based, not rule-name-based.
