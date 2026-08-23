# hal-rules

> **"I'm sorry Dave, I'm afraid I can't do that."**
>
> **Don't let the agent decide what your team's standards are.**

Compose Claude Code rules from shareable packs, the way eslint composes lint rules.

Claude Code already shares plugins and MCP servers with a team: commit
`.claude/settings.json` and `.mcp.json` and everyone who clones gets them. What it
has no answer for is **partial adoption**. Plugins are all-or-nothing — you enable
a pack whole, you cannot take one rule from it and drop another. `claudeMdExcludes`
matches file paths, not rule names.

So a team's shared standards end up copy-pasted between `CLAUDE.md` files and drift
apart. This closes that gap: inherit a pack, switch rules off, retune them, add
your own — all in one committed file your team edits in review.

## Use it

```bash
npx hal-rules init      # scaffold hal-rules.json and gitignore the output
npx hal-rules           # generate
npx hal-rules validate  # check the config without writing anything
```

**No JavaScript project required.** Nothing is installed and no `package.json` or
`node_modules` is created — the rule pack ships inside the package itself. It
works the same in a Rails, Python, Go or Elixir repo.

In a JS project you can install it and use the shorter `hal` binary instead:

```bash
pnpm add -D hal-rules && pnpm hal
```

Use `npx hal-rules`, never `npx hal` — `hal` on npm is an unrelated package
(Hypertext Application Language).

`init` never overwrites an existing `hal-rules.json` — re-running it is safe.

`hal init --expand` writes the inherited rules out as explicit entries, so you can
read and toggle them without opening `node_modules`. The trade-off: an expanded
config pins today's set, so rules added to the pack later won't switch themselves
on. A bare `extends` keeps inheriting; expand when you want to see the menu.

The generate step reads `hal-rules.json` and writes `.claude/rules/generated/<slug>.md`. Gitignore the
output — the config is the artifact under review, not what it compiles to.

```gitignore
.claude/rules/generated/
```

## Configure

```json
{
  "extends": ["node_modules/hal-rules/recommended.json"],
  "rulesDir": ["rules"],

  "rules": {
    "architecture/reuse-existing-components": "off",
    "workflow/before-finish": ["on", { "checks": ["pnpm tsc", "pnpm lint"] }],
    "ours/deploy-checklist": "on"
  },

  "marketplaces": {
    "my-team": {
      "source": { "source": "github", "repo": "org/claude-plugins" }
    }
  },
  "plugins": { "figma@claude-plugins-official": "on" },
  "mcp": { "internal-api": { "command": "./bin/mcp-server" } },
  "settings": { "permissions": { "allow": ["Bash(pnpm test:*)"] } }
}
```

| Key            | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `extends`      | Paths to other configs. Merged in order, later wins.        |
| `rulesDir`     | Where to find rule files by slug. Defaults to `rules`.      |
| `rules`        | `"on"`, `"off"`, or `["on", { var: value }]` per rule slug. |
| `marketplaces` | Verbatim into `extraKnownMarketplaces`.                     |
| `plugins`      | `"name@marketplace"` → on/off, into `enabledPlugins`.       |
| `mcp`          | Server name → config, into `mcpServers`.                    |
| `settings`     | Spliced into `settings.json` as-is.                         |

Every key composes through `extends` the same way.

### How `extends` resolves

A **path** — `./base.json`, `/abs/base.json` — resolves against the config file.
A git submodule or a vendored pack works this way.

Anything else is a **bare specifier**: an installed package if there is one, and
otherwise the pack bundled inside `hal-rules`. That fallback is what makes
`hal-rules/recommended.json` work in a repo with no `node_modules`.

Either way there is no registry lookup, no fetch step, and no cache to go stale.

### Validation happens before anything is written

`hal validate` reports every problem in the config at once — unknown keys,
rule slugs that resolve to no file, bad rule states, malformed plugin ids — and
exits non-zero, so it drops straight into CI or a pre-commit hook.

`hal` runs the same checks itself and **writes nothing if any of them fail**.
A config error leaves the previous generated output exactly as it was, rather
than half-wiped. Errors name the file they came from, which matters once
`extends` chains more than one config.

### Turning a rule off, and tuning one

`"off"` drops an inherited rule. The output directory is wiped on every build, so a
rule you disable stops instructing Claude rather than lingering as a stale file.

A variable is a **string** or a **list**. A list renders as markdown bullets, so
commands are written the obvious way rather than as one string with `\n` in it:

```json
"workflow/before-finish": ["on", { "checks": ["pnpm tsc", "pnpm lint", "pnpm test"] }]
```

An **empty** list is an error, not an empty section — a rule saying "all of these
must pass" followed by nothing is broken. Set the rule `"off"` until you have the
values; a disabled rule may keep its variables, which is how `hal init` scaffolds
`before-finish` with example commands ready to edit.

`{{var}}` placeholders in a rule body are filled from the config. `before-finish` is
the reason they exist: the same rule needs `pnpm tsc` in one repo and `bin/rubocop`
in the next. **An unset variable fails the build** — shipping a literal
`{{framework}}` to Claude as an instruction is worse than a red CI run.

### Overriding a rule's text

Drop your own `<slug>.md` into your `rulesDir` and it wins over the pack's copy —
last `rulesDir` wins. This replaces the whole file, `paths:` frontmatter included.

## Writing a rule

One markdown file per rule, at `<rulesDir>/<category>/<name>.md`:

```markdown
---
name: Before Finish
description: The checks that must pass before work is called done
paths:
  - "**/*.test.*"
---

# Before Finish

Work is not done until these pass:

{{checks}}
```

`paths:` is Claude Code's own frontmatter: the rule stays out of context until
Claude reads a matching file. Use it for anything stack-specific — it costs nothing
in a repo it doesn't apply to.

Rules are advisory context, not enforcement. Something that must _block_ belongs in
a [hook](https://code.claude.com/docs/en/hooks-guide). A multi-step procedure
belongs in a [skill](https://code.claude.com/docs/en/skills).

## The bundled pack

Every rule was carved from a `CLAUDE.md` that was actually in use, across a
TypeScript monorepo, a Rails service and a Nuxt app. None were invented — and
three have since been removed for carrying one stack's assumptions into a pack
that claims to be generic.

| Rule                                           |                                                                                                     | in `recommended` | vars           | path-scoped |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- | :--------------: | -------------- | :---------: |
| `architecture/mark-deliberate-simplifications` | A knowing shortcut carries a comment naming its ceiling and upgrade path                            |        ✓         | `marker`       |             |
| `architecture/reuse-existing-components`       | Read the component library before building any control                                              |        ✓         |                |             |
| `code-style/comments`                          | Default to no comments; write one only where the code cannot say it                                 |        ✓         |                |             |
| `documentation/architecture-decisions`         | A decision made during a change gets an ADR in the same commit, and is never worked around silently |                  | `adrDir`       |             |
| `documentation/docs-in-the-same-commit`        | A change that invalidates a doc fixes that doc too                                                  |        ✓         |                |             |
| `documentation/no-scratch-files`               | Plans and checklists belong in the conversation, not the repo                                       |        ✓         |                |             |
| `git/never-push`                               | Commit locally when asked; pushing is the human's call                                              |        ✓         |                |             |
| `git/worktrees-for-risky-work`                 | Work in the current checkout for small changes                                                      |                  |                |             |
| `testing/test-organization`                    | One test file per unit, grouped with describe blocks                                                |        ✓         |                |      ✓      |
| `workflow/before-finish`                       | The checks that must pass before work is called done                                                |                  | `checks`       |             |
| `workflow/incremental-delivery`                | Ship one agreed item at a time so each can be tested                                                |        ✓         |                |             |
| `workflow/out-of-scope-findings`               | Record problems you are not fixing instead of fixing or dropping them                               |                  | `findingsFile` |             |
| `workflow/scope-discipline`                    | Change only what the request asks for                                                               |        ✓         |                |             |

The four outside `recommended` are opt-in: three need a project-specific value
(`checks`, `findingsFile`, `adrDir`) and one is a team preference.

Worth knowing before you treat the pack as settled: only four of these appeared in
more than one of the three source projects — `scope-discipline`, `before-finish`,
`never-push` and `mark-deliberate-simplifications`. The rest are single-source.

## settings.json and .mcp.json are bootstrapped, not owned

Declared `plugins`, `marketplaces`, `mcp` and `settings` are written **only when the
target file does not exist**. After that the file is left alone and each run reports
what it lacks:

```
11 rules -> .claude/rules/generated
.claude/settings.json exists — left alone
  ! declared but absent: enabledPlugins.figma@claude-plugins-official
```

Claude Code never writes `.claude/settings.json` itself — standing approvals and
`/config` toggles go to `settings.local.json`, which it gitignores for you. But
people do, and so does `/plugin install --scope project`. Overwriting that to assert
a source of truth costs more than it buys, so for now the tool reports and you
decide. `settings.local.json` is never touched: it stays each developer's private
override lane.

One thing this does **not** do: install plugins. A project-scoped plugin from an
external source doesn't auto-install — the teammate still runs `claude plugin install`.

## Not built yet

- `--check` to fail CI on stale or drifted output (distinct from `validate`,
  which checks the config rather than the output)
- Drift _resolution_ — the run reports, it does not merge
- Emitting `.claude/agents/*.md`

`npx hal-rules init` scaffolds a project today. `pnpm create hal-rules` can work
too once `create-hal-rules` is published — that name is free, unlike the
`create-ai-rules` that closed this path under the old name.

## Develop

```bash
pnpm build    # tsdown -> dist/*.mjs + .d.mts
pnpm test     # node --test on src/*.test.ts
pnpm tsc      # typecheck
pnpm lint     # eslint src
pnpm format   # prettier . --write
```

## License

ISC
