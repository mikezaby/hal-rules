---
name: project-update-task
description: Use when a conversation has reached conclusions about the work in progress and the ticket should reflect them, invoked as /project-update-task with no arguments or an explicit ticket id. Finds the ticket from the branch name, rewrites its title, description and acceptance criteria from what the conversation settled on, and shows the result before writing to GitHub Issues or Linear.
---

# Project Update Task

Write what this conversation has settled back to the ticket the work started
from. The ticket must end up with a proper title, a short description and
acceptance criteria. Anything else goes in only when this work actually
produced it.

## 1. Find the ticket

An explicit argument wins: a Linear key `WEB-39`, a GitHub `#42` / `42`, or an
issue URL.

Otherwise read the branch: `git rev-parse --abbrev-ref HEAD`. A branch made
by `/project-new-task` is `<type>/<ticket>-<name>`, so the ticket is the first
segment after the slash when it is a number (`feat/42-login-redirect` is `42`)
or a Linear key (`bugfix/web-39-cookie-banner` is `WEB-39`, upper-cased).

If the branch carries no ticket, or you are on `main`, do not guess. Say so
and ask for the id:

```
No ticket in the branch name. Run /project-update-task <ticket>.
```

The tracker is `{{tracker}}`, set in `hal-rules.json`: `github`, `linear` or
`none`. With `none` there is nothing to update; say so and stop.

## 2. Fetch the current ticket

Tokens live in `.env.hal` at the repository root, gitignored. Load it first:
`set -a; . ./.env.hal; set +a`. Updating always needs a token, even on a
public repo. If `.env.hal` is missing, print the lines and ask for the file:

```
GITHUB_TOKEN=...          # fine-grained token with Issues: read and write; or log in with gh
GITHUB_REPO=owner/repo    # only when issues live in another repo than the code
LINEAR_API_KEY=...        # Settings > Security & access > Personal API keys
```

Read the ticket the same way `/project-new-task` does: title, body, labels,
state, every comment. `gh issue view 42 --json title,body,labels,state,comments`
when `gh` is installed and logged in, else the REST API with the token. For
Linear, the GraphQL query for `issue(id:)` with `title description state
comments`. `<owner>/<repo>` is `GITHUB_REPO` when set, else
`git remote get-url origin`.

If the fetch fails, say which request and stop.

## 3. Draft the new content

Merge, do not replace. Start from what the ticket already says and fold in
what the conversation settled: keep every statement that still holds, correct
the ones the work showed to be wrong, add what was missing. A near-empty
ticket gets written from the conversation; a full one mostly gets its
criteria sharpened. Never drop a constraint the ticket had without saying so
in the draft you show.

Always:

- **Title**: one line naming the outcome, not the activity.
- **Description**: two to five sentences. What is being done and why, in the
  reporter's terms, not the branch's.
- **Acceptance criteria**: a checklist (`- [ ]`) of observable outcomes. Each
  one is checkable by someone who did not do the work.

Only when this work produced them:

- decisions taken and the alternatives dropped
- out of scope, named explicitly
- open questions still needing an answer
- links: PR, ADR, design doc

Do not write implementation notes, file lists or a diary of the session. The
ticket is for the reader who has to accept the work, not the one who did it.

Keep the tracker's own formatting: GitHub and Linear both take markdown.

## 4. Show it, then write it

Print the full new title and body and ask for a yes before writing. A ticket
is shared with people who are not in this conversation; overwriting it is not
yours to decide alone. Only the title and body change. Labels, state,
assignees and comments stay as they are.

**GitHub**: `gh issue edit 42 --title "..." --body-file <file>` when `gh` is
available, else:

```
curl -sf -X PATCH -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/<owner>/<repo>/issues/42" \
  -d "$(jq -n --arg t "$TITLE" --rawfile b body.md '{title:$t, body:$b}')"
```

**Linear**: `issueUpdate` accepts the key as `id`:

```
curl -sf https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg k "WEB-39" --arg t "$TITLE" --rawfile b body.md \
    '{query:"mutation($k:String!,$t:String!,$b:String!){ issueUpdate(id:$k, input:{title:$t, description:$b}){ success } }", variables:{k:$k,t:$t,b:$b}}')"
```

Write the body to a temporary file outside the repository, not to a scratch
file in it.

If the write fails, print the error and the drafted content so nothing is
lost, then stop.

## 5. Report

The ticket link, and a one-line list of what changed: title, description,
criteria, and any extra section added. Then stop. Do not commit, push or
continue implementing; the update is a side step in the conversation, not its
end.
