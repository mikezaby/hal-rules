# hal-rules

> **"I'm sorry Dave, I'm afraid I can't do that."**

**Don't let the agent decide what your team's standards are.**

> [!WARNING]
> **Work in progress. Expect things to move.**
>
> Pre-1.0 and young. While on `0.x`, a **minor bump may break the config format**.
> Pin an exact version if that matters to you.
>
> Rules get added, reworded and removed as they prove themselves; three have been
> dropped already for carrying one stack's assumptions. **A reworded rule changes
> what your agent does**, so read `CHANGELOG.md` on update and use
> `npx hal-rules@latest --diff` to see exactly which instructions moved.
>
> Least settled: how a bootstrapped `settings.json` or `.mcp.json` should
> reconcile when it disagrees with the config (today it only reports), and the
> `skills` fetcher, which has had far less exercise than the rules path.

Compose Claude Code rules from shareable packs, the way eslint composes lint rules.

Claude Code already shares plugins and MCP servers with a team: commit
`.claude/settings.json` and `.mcp.json` and everyone who clones gets them. What it
has no answer for is **partial adoption**. Plugins are all-or-nothing. You enable a
pack whole, and you cannot take one rule from it and drop another. `claudeMdExcludes`
matches file paths, not rule names.

So a team's shared standards end up copy-pasted between `CLAUDE.md` files and drift
apart. This closes that gap: inherit a pack, switch rules off, retune them, add
your own, all in one committed file your team edits in review.

## Use it

```bash
npx hal-rules@latest init      # scaffold hal-rules.json and gitignore the output
npx hal-rules@latest           # generate
npx hal-rules@latest validate  # is the config itself valid?
npx hal-rules@latest check     # does what is on disk match the config?
npx hal-rules@latest list      # every rule and skill on offer, and what the config says
npx hal-rules@latest enable workflow/before-finish   # switch one on, asking for its vars
npx hal-rules@latest disable git/never-push          # switch one off
```

Two flags worth knowing:

```bash
npx hal-rules@latest --update           # move a pinned github: registry to its ref
npx hal-rules@latest --out docs/rules   # write somewhere other than the default
```

`--out` overrides `.claude/rules/generated`, and `check --out <dir>` compares
against the same place. Whatever you choose, that directory is wiped and
rewritten on every run, so point it at generated output and nothing else.

**Use `@latest`, not a bare `npx hal-rules`.** npx caches by semver range, and a
bare name is stored as `^<version you first ran>`. A newer `0.x` still satisfies
that range, so npx can keep running the old copy. While the config format can
change on a minor bump, the releases most likely to matter are exactly the ones
a bare `npx` may skip.

**No JavaScript project required.** Nothing is installed and no `package.json` or
`node_modules` is created. The rule pack ships inside the package itself, so it
works the same in a Rails, Python, Go or Elixir repo.

In a JS project, installing it is better than either: the version lands in your
lockfile, so everyone on the team runs the same one and an update is a reviewed
change rather than whatever each person's npx cache happens to hold. You also get
the shorter `hal` binary.

```bash
pnpm add -D hal-rules && pnpm hal
```

Use `npx hal-rules@latest`, never `npx hal`. On npm, `hal` is an unrelated package
(Hypertext Application Language).

`init` never overwrites an existing `hal-rules.json`, so re-running it is safe.

It scaffolds **every rule that needs a variable**, switched `"off"` with a worked
example value. JSON has no comments, so that is the only way to show the shape.
Without it, enabling one of those rules is a build error rather than a rule.
Edit the values, flip the ones you want to `"on"`.

`hal init --expand` writes the inherited rules out as explicit entries, so you can
read and toggle them without opening `node_modules`. The trade-off: an expanded
config pins today's set, so rules added to the pack later won't switch themselves
on. A bare `extends` keeps inheriting; expand when you want to see the menu.

The generate step reads `hal-rules.json` and writes
`.claude/rules/generated/<slug>.md`. Gitignore the output. The config is the
artifact under review, not what it compiles to.

```gitignore
.claude/rules/generated/
```

## Configure

```json
{
  "extends": [{ "registry": "hal-rules" }],
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
  "skills": { "research/manual-analyzer": "on" },
  "mcp": { "internal-api": { "command": "./bin/mcp-server" } },
  "settings": { "permissions": { "allow": ["Bash(pnpm test:*)"] } }
}
```

| Key            | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `extends`      | Registries or config files. Merged in order, later wins.    |
| `rulesDir`     | Where **your own** rule files live. Defaults to `rules`.    |
| `rules`        | `"on"`, `"off"`, or `["on", { var: value }]` per rule slug. |
| `marketplaces` | Verbatim into `extraKnownMarketplaces`.                     |
| `plugins`      | `"name@marketplace"` → on/off, into `enabledPlugins`.       |
| `skills`       | Pack slug → on/off, or `github:owner/repo` → skill paths.   |
| `mcp`          | Server name → config, into `mcpServers`.                    |
| `settings`     | Spliced into `settings.json` as-is.                         |

`rulesDir` appears here only because of `ours/deploy-checklist`, a rule this
project wrote itself. Extending a registry needs no `rulesDir` — the registry
brings its own `rules/` — so a config that enables nothing of its own can drop
the line, which is what `hal init` scaffolds.

Every key composes through `extends` the same way.

### Turn on a skill the pack ships

A registry keeps skill directories under `skills/`, next to its `rules/`. They
are addressed by slug and switched on or off exactly like a rule:

```json
"skills": {
  "research/manual-analyzer": "on"
}
```

`registry/skills/research/manual-analyzer/SKILL.md` lands as
`.claude/skills/manual-analyzer/`. A `skills/` directory beside your own
`hal-rules.json` is searched last, so dropping the same slug in it replaces the
pack's copy whole.

### Cherry-pick skills from a repo

Plugins are all-or-nothing. `mattpocock/skills` ships 36 skills and you probably
want three. Name them the way the source groups them:

```json
"skills": {
  "github:mattpocock/skills#v1.4.0": [
    "engineering/tdd",
    "engineering/to-tickets",
    "productivity/writing-for-agents"
  ]
}
```

Browse what a source offers:

```bash
npx hal-rules@latest skills list github:mattpocock/skills
```

```
engineering/  ask-matt · code-review · diagnosing-bugs · tdd · to-spec · to-tickets …
productivity/ grill-me · handoff · teach · writing-for-agents …
```

Both shapes share the `skills` key: a `github:` key maps to a list of paths in
that repo, any other key is a pack slug set to `"on"` or `"off"`. A pack slug
also takes options the way a rule does, `["on", { "tracker": "linear" }]`,
substituted for `{{tracker}}` in its `SKILL.md`; an unset one fails the build.

The folder is the **config's** vocabulary, not a layout on disk. Claude Code
discovers skills exactly one level deep and treats the directory name as the
command, so `engineering/tdd` installs to `.claude/skills/tdd/` and runs as
`/tdd`. A nested directory would never load. That is measured, not assumed.
The whole skill directory is copied, since most skills ship supporting files
alongside `SKILL.md`.

`hal-rules.lock.json` records the source, the resolved commit and the original
path for each skill, so provenance survives the flattening. A ref is always
pinned to a SHA, because otherwise someone else's edit silently changes
instructions your agent follows.

**Commit the installed skills.** Unlike generated rules, a fetched one is not
reproducible from anything local, and a pack one sits in the same directory, so
the whole of `.claude/skills/` is committed rather than half of it. Having them in the repo means the team reviews the diff when
a version moves, and nobody needs the network to work. Drop a skill from
the config and the next run deletes it.

Two sources providing the same skill name is an error, not a silent overwrite.

### How `extends` resolves

An entry is either a **registry** you name a preset out of, or a **config file**
directly.

#### A registry

A registry is a directory holding presets beside the rules they turn on:

```
your-pack/
  recommended.json     the default preset
  strict.json          another one
  rules/
    code-style/comments.md
```

`rules/` is convention, not configuration. Nothing declares it and nothing can
move it, which is why extending a registry needs no `rulesDir` — that key is
only for rule files of your own, and an unset one that is not on disk is not
searched:

```json
{
  "extends": [
    { "registry": "hal-rules" },
    { "registry": "./vendor/your-pack" },
    { "registry": "github:acme/rules", "preset": "strict", "ref": "main" }
  ]
}
```

A bare name is a package: an installed one, and otherwise the registry bundled
inside `hal-rules`. That is what `hal init` scaffolds, and what makes
`npx hal-rules` work in a repo with no `node_modules`.

| Field      | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `registry` | A directory: a path, a package, or `github:owner/repo[/dir]`. |
| `preset`   | Which `<preset>.json` in it. Defaults to `recommended`.       |
| `ref`      | Branch, tag or commit. `github:` registries only.             |

A registry missing its `rules/`, or a preset that is not there, is an error
naming the path it looked for. A registry that resolves to nothing would
otherwise fail once per rule.

#### A config file

A **path** (`./base.json`, `/abs/base.json`) resolves against the config file.
A git submodule or a vendored pack works this way.

A **`github:` source** is fetched and pinned exactly as a `github:` registry is:

```json
{
  "extends": ["github:you/your-pack/recommended.json#main"]
}
```

The form is `github:owner/repo[/path/to/config.json][#ref]` — path first so it
can nest, ref last. It defaults to `recommended.json` at the repo root.

Either way a `github:` source lands in `.hal/packs/`, pinned by commit in
`hal-rules.lock.json`, one checkout per repo however many presets you take
out of it.

**Commit `.hal/packs/`.** A pack is not reproducible from anything local, the
same reason skills are committed. It also means a build never needs the network
twice: a pinned pack already on disk is not refetched, so `hal check` stays
offline in CI and a push upstream cannot change what instructs Claude until
someone asks:

```
$ npx hal-rules@latest --update
  pack github:you/your-pack  @ main (a1b2c3d4)
```

Anything else is a **bare specifier**: an installed package if there is one, and
otherwise the pack bundled inside `hal-rules`. That fallback is what makes
`hal-rules/recommended.json` work in a repo with no `node_modules`, and it needs
no network at all.

### Seeing what is on offer

`list` prints every rule and skill your packs and your own dirs provide, with
what your config says about each: `on`, `off`, or `unset` when the config never
mentions it. Variables a rule or skill needs are shown beside it.

```
$ npx hal-rules@latest list
rules (18)
  on    architecture/mark-deliberate-simplifications   (needs marker)
  off   code-style/comments
  unset documentation/architecture-decisions   (needs adrDir)
  ...

skills (2)
  on    research/manual-analyzer
  unset workflow/project-new-task   (needs tracker)

2 unset: your config never mentions them. Add the rules as "off" with: npx hal-rules@latest sync
```

`enable <slug>` and `disable <slug>` flip one entry in your own config, rule or
skill. Enabling something that uses `{{vars}}` asks for each value it does not
have yet; a list-valued one (`checks`) is entered comma separated. Pass them on
the command line to skip the prompt, which is also the only way from a script
where there is no terminal to ask on:

```
$ npx hal-rules@latest enable workflow/before-finish "checks=pnpm test, pnpm lint"
workflow/before-finish -> "on". Apply it: npx hal-rules@latest
```

Disabling keeps the values, so enabling again later asks nothing. A slug the
packs do not have is an error that names the nearest matches.

A sparse config inherits new pack rules automatically. An expanded one pins
today's list, so a rule that ships later never appears and nothing tells you it
exists; `list` is how you find out.

`sync` writes the unset rules into your config as `"off"`, with a worked example for any
variable they need. **Adoption stays a deliberate edit.** Nothing switches itself
on, and rules you already set to `"off"` are left alone, because that was a
decision rather than an omission.

### Seeing what changed after an update

Rule bodies come from the installed pack, so updating it changes what your agent
is told. Generating reports what moved:

```
13 rules -> .claude/rules/generated

3 change(s) since the last run:
  - git/never-push
  ~ workflow/scope-discipline
  + safety/never-publish
  (--diff to see what moved)
```

`--diff` shows the lines. It compares against the output already on disk, so it
needs no git, no `diff` binary, and nothing committed. The generated directory
stays gitignored. A first run reports nothing, since there is nothing to compare.

`CHANGELOG.md` in this package lists rule wording changes alongside code ones.

### Checking what is on disk

`hal-rules check` compares the generated output against the config and exits
non-zero if they disagree. It is strictly read-only: it generates into a temp
directory, so it never writes into the repository it is checking.

```
  stale rule still on disk: git/never-push.md
      run: npx hal-rules@latest
1 problem(s). Generated output does not match the config
```

It catches a rule you switched off that is still on disk, a rule you added but
did not generate, a generated file someone hand-edited, skills that disagree with
the lock, and declared plugins missing from `settings.json`. An invalid config
short-circuits, so you get the one real cause instead of a cascade.

**Where this is worth wiring up.** Generated rules are gitignored, so a fresh CI
checkout has nothing to compare and `check` only reports "nothing generated yet".
For rules it earns its keep **locally**: a pre-commit hook, or before starting a
session, catching the case where you edited the config and your agent is still
reading yesterday's rules. For **skills** it is a genuine CI gate, because those
are committed and can drift from the config.

### Validation happens before anything is written

`hal validate` reports every problem in the config at once (unknown keys, rule
slugs that resolve to no file, bad rule states, malformed plugin ids), and exits
non-zero, so it drops straight into CI or a pre-commit hook.

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

An **empty** list is an error, not an empty section. A rule saying "all of these
must pass" followed by nothing is broken. Set the rule `"off"` until you have the
values; a disabled rule may keep its variables, which is how `hal init` scaffolds
`before-finish` with example commands ready to edit.

`{{var}}` placeholders in a rule body are filled from the config. `before-finish` is
the reason they exist: the same rule needs `pnpm tsc` in one repo and `bin/rubocop`
in the next. **An unset variable fails the build.** Shipping a literal
`{{framework}}` to Claude as an instruction is worse than a red CI run.

### Overriding a rule's text

Drop your own `<slug>.md` into your `rulesDir` and it wins over the pack's copy:
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
Claude reads a matching file. Use it for anything stack-specific, since it costs
nothing in a repo it doesn't apply to.

Rules are advisory context, not enforcement. Something that must _block_ belongs in
a [hook](https://code.claude.com/docs/en/hooks-guide). A multi-step procedure
belongs in a [skill](https://code.claude.com/docs/en/skills).

## The bundled pack

Every rule was carved from a `CLAUDE.md` that was actually in use, across a
TypeScript monorepo, a Rails service and a Nuxt app, with one exception:
`git/commit-granularity`, added on direct instruction rather than lifted from
any of those three. Three others have since been removed for carrying one
stack's assumptions into a pack that claims to be generic.

| Rule                                           |                                                                                                     | in `recommended` | vars           | path-scoped |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- | :--------------: | -------------- | :---------: |
| `architecture/mark-deliberate-simplifications` | A knowing shortcut carries a comment naming its ceiling and upgrade path                            |        ✓         | `marker`       |             |
| `architecture/reuse-existing-components`       | Read the component library before building any control                                              |        ✓         |                |             |
| `code-style/comments`                          | Default to no comments; write one only where the code cannot say it                                 |        ✓         |                |             |
| `documentation/architecture-decisions`         | A decision made during a change gets an ADR in the same commit, and is never worked around silently |                  | `adrDir`       |             |
| `documentation/docs-in-the-same-commit`        | A change that invalidates a doc fixes that doc too                                                  |        ✓         |                |             |
| `documentation/no-scratch-files`               | Plans and checklists belong in the conversation, not the repo                                       |        ✓         |                |             |
| `documentation/plain-prose`                    | Write like the person who did the work, not like a tool announcing it                               |        ✓         |                |             |
| `git/commit-granularity`                       | One commit per coherent change, not one per work session                                            |        ✓         |                |             |
| `git/never-push`                               | Commit locally when asked; pushing is the human's call                                              |        ✓         |                |             |
| `safety/never-publish`                         | Preparing a release is fine; pushing it to a registry is a human's call                             |        ✓         |                |             |
| `safety/bump-only-when-asked`                  | A version number is a release decision; wait to be told                                             |        ✓         |                |             |
| `safety/never-deploy`                          | Build it, plan it, diff it, then hand the command to a human                                        |        ✓         |                |             |
| `git/worktrees-by-default`                     | Real work gets its own worktree; a fast one-off does not                                            |        ✓         | `worktreesDir` |             |
| `testing/test-organization`                    | One test file per unit, grouped with describe blocks                                                |        ✓         |                |      ✓      |
| `workflow/before-finish`                       | The checks that must pass before work is called done                                                |                  | `checks`       |             |
| `workflow/incremental-delivery`                | Ship one agreed item at a time so each can be tested                                                |        ✓         |                |             |
| `workflow/out-of-scope-findings`               | Record problems you are not fixing instead of fixing or dropping them                               |                  | `findingsFile` |             |
| `workflow/scope-discipline`                    | Change only what the request asks for                                                               |        ✓         |                |             |

The three outside `recommended` are opt-in, each because it needs a
project-specific value: `checks`, `findingsFile`, `adrDir`.

Worth knowing before you treat the pack as settled: only four of these appeared in
more than one of the three source projects: `scope-discipline`, `before-finish`,
`never-push` and `mark-deliberate-simplifications`. The rest are single-source.

### Skills in the pack

| Skill                       |                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research/manual-analyzer`  | Read another product's manual, from a URL, a local file, or a folder of them, and write down what our project should do about it                                                                                                  |
| `workflow/project-new-task` | `/project-new-task WEB-39 feat cookies`, arguments in any order: read the ticket from the `tracker` (`github`, `linear` or `none`; tokens in `.env.hal`), create the `feat/` or `bugfix/` branch and worktree, summarise the work |

None are in `recommended`. A rule is a standing constraint and belongs on by
default; a skill is a procedure you invoke, so turning one on is a choice about
how a team works. Unlike the rules, this one was not carved from a `CLAUDE.md`
in use anywhere. It was specified directly.

## settings.json and .mcp.json are bootstrapped, not owned

Declared `plugins`, `marketplaces`, `mcp` and `settings` are written **only when the
target file does not exist**. After that the file is left alone and each run reports
what it lacks:

```
11 rules -> .claude/rules/generated
.claude/settings.json exists, left alone
  ! declared but absent: enabledPlugins.figma@claude-plugins-official
```

Claude Code never writes `.claude/settings.json` itself. Standing approvals and
`/config` toggles go to `settings.local.json`, which it gitignores for you. But
people do, and so does `/plugin install --scope project`. Overwriting that to assert
a source of truth costs more than it buys, so for now the tool reports and you
decide. `settings.local.json` is never touched: it stays each developer's private
override lane.

One thing this does **not** do: install plugins. A project-scoped plugin from an
external source doesn't auto-install, so the teammate still runs
`claude plugin install`.

## Not built yet

- Drift _resolution_. The run reports a disagreement, it does not merge one.
- Emitting `.claude/agents/*.md`.

`npx hal-rules@latest init` scaffolds a project today. `pnpm create hal-rules` can work
too once `create-hal-rules` is published. That name is free, unlike the
`create-ai-rules` that closed this path under the old name.

## Develop

```bash
pnpm build    # tsdown -> dist/*.mjs + .d.mts
pnpm test     # node --test on test/*.test.ts
pnpm tsc      # typecheck
pnpm lint     # eslint src test
pnpm format   # prettier . --write
```

## License

ISC
