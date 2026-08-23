# ai-rules

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
npx ai-rules init     # scaffold ai-rules.json and gitignore the output
pnpm add -D ai-rules
pnpm ai-rules         # generate
```

`init` never overwrites an existing `ai-rules.json` — re-running it is safe.

The generate step reads `ai-rules.json` and writes `.claude/rules/generated/<slug>.md`. Gitignore the
output — the config is the artifact under review, not what it compiles to.

```gitignore
.claude/rules/generated/
```

## Configure

```json
{
  "extends": ["node_modules/ai-rules/recommended.json"],
  "rulesDir": ["rules"],

  "rules": {
    "architecture/reuse-existing-components": "off",
    "workflow/before-finish": [
      "on",
      { "checks": "- `pnpm tsc`\n- `pnpm lint`\n- `pnpm test`" }
    ],
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

### `extends` is just a path

Resolved relative to the config file, so `node_modules/@you/pack/recommended.json`,
a git submodule directory and `./base.json` all work. There is no registry, no fetch
step and no cache to go stale — distribution is whatever your project already uses.

### Turning a rule off, and tuning one

`"off"` drops an inherited rule. The output directory is wiped on every build, so a
rule you disable stops instructing Claude rather than lingering as a stale file.

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
TypeScript monorepo, a Rails service and a Nuxt app. None were invented.

| Rule                                           |                                                                          | in `recommended` | vars           | path-scoped |
| ---------------------------------------------- | ------------------------------------------------------------------------ | :--------------: | -------------- | :---------: |
| `architecture/mark-deliberate-simplifications` | A knowing shortcut carries a comment naming its ceiling and upgrade path |        ✓         | `marker`       |             |
| `architecture/reuse-existing-components`       | Read the component library before building any control                   |        ✓         |                |             |
| `code-style/comments`                          | Default to no comments; write one only where the code cannot say it      |        ✓         |                |             |
| `code-style/no-namespace-react`                | Import named or default bindings from react, never the namespace         |                  |                |      ✓      |
| `code-style/no-nested-ternaries`               | A ternary whose branch is another ternary becomes guard clauses          |        ✓         |                |      ✓      |
| `documentation/docs-in-the-same-commit`        | A change that invalidates a doc fixes that doc too                       |        ✓         |                |             |
| `documentation/no-scratch-files`               | Plans and checklists belong in the conversation, not the repo            |        ✓         |                |             |
| `git/never-push`                               | Commit locally when asked; pushing is the human's call                   |        ✓         |                |             |
| `git/worktrees-for-risky-work`                 | Work in the current checkout for small changes                           |                  |                |             |
| `safety/never-apply-migrations`                | Generating a migration is fine; running it against a database is not     |                  |                |             |
| `testing/test-organization`                    | One test file per unit, grouped with describe blocks                     |        ✓         |                |      ✓      |
| `workflow/before-finish`                       | The checks that must pass before work is called done                     |                  | `checks`       |             |
| `workflow/incremental-delivery`                | Ship one agreed item at a time so each can be tested                     |        ✓         |                |             |
| `workflow/out-of-scope-findings`               | Record problems you are not fixing instead of fixing or dropping them    |                  | `findingsFile` |             |
| `workflow/scope-discipline`                    | Change only what the request asks for                                    |        ✓         |                |             |

The five outside `recommended` are opt-in because they need a project-specific value
or only fit some stacks.

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

- `--check` to fail CI on stale or drifted output
- Drift _resolution_ — the run reports, it does not merge
- Emitting `.claude/agents/*.md`

`pnpm create ai-rules` will not work: `create-ai-rules` on npm belongs to an
unrelated package. Use `pnpm dlx ai-rules`.

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
