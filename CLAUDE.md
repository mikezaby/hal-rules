# modular-skills

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
  "extends": ["node_modules/@you/hal-rules/recommended.json"],
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

`npx hal-rules` (or `pnpm dlx hal-rules`) writes `.claude/rules/generated/<slug>.md`. Gitignore that dir —
the config is the artifact under review, not the output.

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

- `extends` is a **path**, resolved relative to the config file. `node_modules/...`,
  a submodule dir, `./base.json` all work; no fetch or registry layer exists.
- Configs merge in order, later wins — extends first, own `rules` last.
- Rule _files_ resolve last-`rulesDir`-first, so a project shadows a pack rule by
  dropping its own `<slug>.md` in place. Shadowing replaces the whole file, `paths:`
  frontmatter included.
- `"off"` drops an inherited rule. The out dir is wiped each build, so a rule turned
  off stops instructing Claude instead of lingering as a stale file.
- `{{var}}` in a rule body is substituted from the config. An unset one is a build
  error, never passed through to Claude.

## Toolchain

TypeScript in `src/`, ESM, built with tsdown. Config extracted from blibliki:
eslint flat config (`strictTypeChecked` + `stylisticTypeChecked`, `projectService`),
prettier with the trivago import sorter, strict tsconfig with `noUncheckedIndexedAccess`.

`hal validate` reports every config problem at once and exits non-zero.
`build` runs the same checks and writes nothing if any fail, so a bad config
cannot leave the previous output half-wiped.

```
pnpm build   tsdown -> dist/*.mjs + .d.mts
pnpm test    node --test on src/*.test.ts (Node strips types natively, no test dep)
pnpm tsc     typecheck
pnpm lint    eslint src
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

`rules/` holds the registry, one file per rule, foldered by topic:
`workflow` · `git` · `documentation` · `testing` · `code-style` · `architecture`

Every rule was carved from a CLAUDE.md that was actually in use, blibliki among
them. No rule exists here without a source line in one of them — the pack is
evidence, not invention.

`recommended.json` enables nine of them; the rest need a project-specific value
(`checks`, `findingsFile`, `adrDir`) or are a team preference. Left opt-in because
they need a project-specific value or only fit some stacks:
`workflow/before-finish` (`checks`), `workflow/out-of-scope-findings` (`findingsFile`),
`git/worktrees-for-risky-work`.

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

**The full remaining-work list — eight items, three of them decisions — lives in
`docs/plans/2026-08-23-modular-rules-design.md` under "Remaining work".** Keep it
there rather than in chat.

Requirements and the open questions: `docs/plans/2026-08-23-modular-rules-design.md`.

**Adding or changing a rule? Follow `docs/verifying-a-change.md`.**
`./scripts/verify-loading.sh` automates the loading half: canary rule, real
`claude -p` session in a throwaway project, plus the rule-off control run.
`./scripts/verify-subagent.sh` does the same for subagent inheritance. A green test
suite proves the file was written, never that Claude follows it — a rule is only
verified when the same prompt behaves differently with it on and off.

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
