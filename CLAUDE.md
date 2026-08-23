# modular-skills

A rule registry and generator for AI-agent config, checked into the *project*
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

`ai-rules.json` per project, eslint-shaped:

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

`npx ai-rules` writes `.claude/rules/generated/<slug>.md`. Gitignore that dir —
the config is the artifact under review, not the output.

Resolution:

- `extends` is a **path**, resolved relative to the config file. `node_modules/...`,
  a submodule dir, `./base.json` all work; no fetch or registry layer exists.
- Configs merge in order, later wins — extends first, own `rules` last.
- Rule *files* resolve last-`rulesDir`-first, so a project shadows a pack rule by
  dropping its own `<slug>.md` in place. Shadowing replaces the whole file, `paths:`
  frontmatter included.
- `"off"` drops an inherited rule. The out dir is wiped each build, so a rule turned
  off stops instructing Claude instead of lingering as a stale file.
- `{{var}}` in a rule body is substituted from the config. An unset one is a build
  error, never passed through to Claude.

## Status

Rules generator works, `node --test` covers resolution. No rule pack written yet.
`settings.json` and `.mcp.json` bootstrapping is designed, not built.

Requirements and the open questions: `docs/plans/2026-08-23-modular-rules-design.md`.

## Mechanism facts (verified 2026-08-23, code.claude.com/docs)

- `.claude/rules/*.md` load every session at `.claude/CLAUDE.md` priority;
  a `paths:` glob in frontmatter defers loading until a matching file is read.
- **Subagents inherit the whole CLAUDE.md hierarchy, project rules included.**
  Not inherited: conversation history, read files, invoked skills, parent auto memory.
- Built-in **Explore and Plan agents skip CLAUDE.md and rules entirely.**
- Custom agents (`.claude/agents/*.md`) supply their own system prompt and get
  "only this system prompt plus basic environment details" — so per-agent
  behavior is a second emit target, not something a rule file can express.
- Rules are advisory context, never enforcement. Blocking belongs in a hook.
- `claudeMdExcludes` (glob, any settings layer, arrays merge) is the only native
  off switch — path-based, not rule-name-based.
