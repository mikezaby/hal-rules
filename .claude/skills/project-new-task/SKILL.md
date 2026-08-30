---
name: project-new-task
description: Use when starting a feature or bug fix, invoked as /project-new-task with a ticket id, a type (feat or bugfix) and a short name in any order. Reads the ticket from GitHub Issues or Linear when one is given, creates the feat/... or bugfix/... branch and its worktree, and hands over a summary of the work.
---

# Project New Task

Start a piece of work: branch, worktree, and the ticket's content in front of
you. Nothing else. Do not begin implementing.

## 1. Read the arguments

The arguments come in any order. Pick out three things:

| Piece  | Looks like                                                                |
| ------ | ------------------------------------------------------------------------- |
| type   | `feat`, `feature`, `bugfix`, `bug`, `fix`                                 |
| ticket | `github` issue: Linear key `WEB-39`, GitHub `#42` / `42`, or an issue URL |
| name   | whatever is left, free text                                               |

`feat` and `feature` mean `feat`. `bug`, `fix` and `bugfix` mean `bugfix`.

If a word could be two of these at once, or the type is missing and there is no
ticket to infer it from, stop and ask for the fixed form:

```
/project-new-task <feat|bugfix> <ticket> <name>
```

Both ticket and name are optional. No ticket means plain-text work with no
tracker lookup. No name means the name comes from the ticket title.

The tracker is `github`, set in `hal-rules.json`: `github`, `linear` or
`none`. With `none`, treat every argument as type or name and never look a
ticket up.

## 2. Fetch the ticket

Skip this step when there is no ticket.

Tokens live in `.env.hal` at the repository root, gitignored:

```
GITHUB_TOKEN=...          # private repos only, fine-grained token with Issues: read; or log in with gh
GITHUB_REPO=owner/repo    # only when issues live in another repo than the code
LINEAR_API_KEY=...        # Settings > Security & access > Personal API keys
```

Load it before any request: `set -a; . ./.env.hal; set +a`. If `.env.hal`
is missing and the ticket needs a token, print the lines above and ask for
the file. Nothing else needs configuring: the GitHub repo comes from the
remote and a Linear key is unique across the workspace, so no board or team
is named.

**Linear** (key like `WEB-39`, needs `LINEAR_API_KEY`):

```
curl -sf https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"{ issue(id: \"WEB-39\") { identifier title description priorityLabel state { name } labels { nodes { name } } comments { nodes { body user { name } } } } }"}'
```

**GitHub** (`#42`, `42`, or an issue URL). Use
`gh issue view 42 --json number,title,body,labels,comments` when `gh` is
installed and logged in. Otherwise:

```
curl -sf -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/<owner>/<repo>/issues/42"
```

A public repo needs no token: drop the header. Do the same for the comments,
at `.../issues/42/comments`.

`<owner>/<repo>` is `GITHUB_REPO` when set, else `git remote get-url origin`.

If the request fails, or the token is missing, say exactly which one and stop.
Do not guess the ticket's content and do not create the branch under a name
you could not confirm.

Read the whole ticket: title, body, labels, state, every comment. A comment
often reverses the body.

Infer a missing type from the ticket: a `bug` label or a title that describes
broken behaviour is `bugfix`, anything else is `feat`. Say which you picked.

## 3. Name the branch

```
<type>/<ticket>-<name>
<type>/<name>            when there is no ticket
```

Ticket lowercased as the tracker writes it: `web-39`, `42`. Name lowercased,
words joined with `-`, only `[a-z0-9-]`, at most five words. The ticket title
is the name when none was given.

`feat/web-39-cookie-banner`, `bugfix/42-login-redirect`, `feat/dark-mode`.

## 4. Create the worktree

From the default branch, up to date:

```
git fetch origin
git worktree add .claude/worktrees/<branch> -b <branch> origin/<default>
```

`<default>` is what `git symbolic-ref refs/remotes/origin/HEAD` names, else
`main`. If the project's worktree rule names another directory, use that.
If the branch already exists, say so and stop rather than creating a second
one.

Copy the ignored files the project needs to run, recursively, as the worktree
rule describes (`.env*` and the like). `.env.hal` is one of them.

## 5. Hand over

Report, in this order:

- the branch and the worktree path
- the ticket, restated in your own words: what is asked, the acceptance
  criteria, anything a comment changed, open questions the ticket leaves
- for plain-text work, the name as you understood it

Then stop. The next prompt decides what happens in the worktree.
