---
name: Worktrees by Default
description: Real work gets its own worktree; a fast one-off does not
---

# Worktrees by Default

**Start a worktree for anything that is real work**: a feature, a refactor, a
bug that takes more than a line, anything you will come back to across several
prompts.

```
git worktree add ../<repo>-<branch> -b <branch>
```

The exception is the fast one-off. One or two light prompts, a small diff, and
nothing to return to. Do that in the current checkout.

If you cannot tell which one it is, make the worktree. Moving work into one
after the fact costs more than making one you turned out not to need.

Remove it once the branch is merged, so `git worktree list` stays a list of
things actually in flight.
