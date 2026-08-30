---
name: project-pull-request
description: Use when the work on a branch is ready for review, invoked as /project-pull-request. Opens the GitHub pull request for the current branch with gh, or updates the one that already exists, with a title and a reviewer-facing description that links the ticket without repeating it.
---

# Project Pull Request

Open the pull request for the current branch, or update the one that is
already open. Write the description for the reviewer, not for the ticket.

## 1. Check the ground

- `gh auth status` must succeed. If `gh` is missing or logged out, say so and
  stop; do not fall back to anything else.
- The branch must not be the default branch
  (`git symbolic-ref refs/remotes/origin/HEAD`, else `main`).
- Everything meant for the PR must be committed. Uncommitted changes are not
  part of it; say what is left out.
- The branch must be on the remote. If it is not, and the project's rules let
  you push, `git push -u origin <branch>`. If they do not (a `Never Push`
  rule is loaded), print the push command, ask for it to be run, and stop.

## 2. Find the ticket

The branch was named by `/project-new-task`: `<type>/<ticket>-<name>` or
`<type>/<name>`. The tracker is `{{tracker}}`, set in `hal-rules.json`.

- `github`: a leading number is the issue. The link is the issue URL:
  `gh issue view <n> --json url,title`.
- `linear`: a leading key like `web-39` is the issue, uppercased. Load
  `.env.hal` (`set -a; . ./.env.hal; set +a`) and ask for the link:
  ```
  curl -sf https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
    -d '{"query":"{ issue(id: \"WEB-39\") { url title } }"}'
  ```
- `none`, or a branch with no ticket: there is no link. Do not invent one.

If the lookup fails, say which request failed and stop rather than opening a
PR with a guessed link.

## 3. Write the title and description

Read the whole branch first: `git log origin/<default>..HEAD` and
`git diff origin/<default>...HEAD`. The description is about what is on the
branch, not what the ticket asked for.

**Title**: the ticket key then a short imperative summary of the change,
`WEB-39: Add cookie banner`, `#42: Fix login redirect`. Without a ticket, the
summary alone. Under 70 characters.

**Description**, in this order, plain prose, no headings for a paragraph:

1. The ticket link on its own line, first. `Closes #42` on GitHub so the
   issue closes on merge; the Linear URL as it is.
2. What a reviewer needs that the ticket does not say: the approach taken and
   why, the tradeoffs, anything touched that the ticket did not mention,
   what was deliberately left out.
3. How to test it: the commands to run, the pages to open, the data to set
   up, in the order that works.

Do not restate the ticket. The link is there for the reader who wants it;
repeating its body is noise between the reviewer and the technical notes.
Leave out anything the diff already shows on its own.

## 4. Create or update

Find out whether a PR for this branch exists:

```
gh pr view --json number,url,title,body
```

Exit 0 means it exists: keep what a person has edited into it, fold in what
changed on the branch since, and write it back:

```
gh pr edit <number> --title "<title>" --body-file <file>
```

Otherwise create it against the default branch:

```
gh pr create --base <default> --title "<title>" --body-file <file>
```

Write the body to a temporary file and pass `--body-file`; a body on the
command line loses its newlines and backticks. Do not open the PR as a draft
and do not request reviewers unless asked.

## 5. Report

Print the PR URL, whether it was created or updated, and the description as
written. Then stop.
