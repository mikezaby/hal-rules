---
name: project-clean-tasks
description: Use when finished branches and worktrees have piled up, invoked as /project-clean-tasks. Compares every local branch and worktree against main and develop, reports which are merged, and asks one at a time before deleting anything.
---

# Project Clean Tasks

Tidy what `/project-new-task` left behind. Every local branch and worktree gets
reported with its state against the base branches, then a yes or no for each,
one at a time. Nothing is deleted without that yes.

## 1. Find the base branches

```
git fetch --prune origin
```

The bases are `main` and `develop`, whichever of the two exist on `origin`. If
neither does, use what `git symbolic-ref refs/remotes/origin/HEAD` names.
Compare against `origin/<base>`, not the local copy, which may be behind.

## 2. Gather the candidates

- Worktrees: `git worktree list --porcelain`, minus the main checkout.
- Branches: `git branch --format='%(refname:short)'`, minus the bases and the
  branch checked out in the main checkout.

For each candidate work out, and keep for the report:

- **merged**: which base contains it. `git branch --merged origin/<base>`
  catches merge commits and fast-forwards. A squash merge leaves the branch
  unmerged in git's eyes, so when `gh auth status` succeeds also check
  `gh pr list --state merged --head <branch> --json number,baseRefName`.
  A merged PR counts as merged into its base.
- **unmerged commits**: `git log --oneline origin/<base>..<branch>` against the
  base it is closest to. Show the count and the first few subjects.
- **dirty**: for a worktree, `git -C <path> status --porcelain` is non-empty.
  Uncommitted work is lost on delete, so say so.

Print the whole list first, one line each, merged ones on top:

```
merged into main    feat/42-login-redirect     worktree .claude/worktrees/feat/42-login-redirect
merged into main    bugfix/17-null-name        (squash, PR #58)
not merged          feat/dark-mode             3 commits ahead of develop
not merged          spike/perf                 worktree, uncommitted changes
```

## 3. Ask, one at a time

Go down the list in that order. For each item ask a single question and wait
for the answer before moving to the next:

```
Delete feat/42-login-redirect and its worktree? Merged into main. [y/N]
```

For an unmerged one, put the commits in the question so the answer is made
with them in view. For a dirty worktree, name the uncommitted files.

Only `y` or `yes` deletes. Anything else, including silence or a question,
skips the item and moves on. Never batch the questions into one list to
approve at once, and never delete first and report after.

## 4. Delete

Worktree before branch, since a branch checked out somewhere cannot be
deleted:

```
git worktree remove <path>            # --force only for a dirty one that got a yes
git branch -d <branch>                # -D only for an unmerged one that got a yes
```

If a command fails, print its output and go on to the next item; do not retry
with a stronger flag on your own.

Never touch `origin`. Remote branches are deleted by the merge or by a human.

## 5. Report

Deleted, skipped, and failed, each as a list of names. Then
`git worktree prune` and stop.
