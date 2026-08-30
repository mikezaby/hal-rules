---
name: Worktrees by Default
description: Real work gets its own worktree; a fast one-off does not
---

# Worktrees by Default

**Start a worktree for anything that is real work**: a feature, a refactor, a
bug that takes more than a line, anything you will come back to across several
prompts.

```
git worktree add {{worktreesDir}}/<branch> -b <branch>
```

Worktrees live in `{{worktreesDir}}`. If that path is inside the repository, it
belongs in `.gitignore`, or every worktree shows up as untracked files.

A fresh worktree only has what git tracks, so the ignored files the project
needs to run are missing: `.env`, `.env.local`, and anything else the setup
depends on. Copy or symlink them across before running anything, and in a
monorepo look **recursively**, since every package can have its own:

```
cd <worktree> && (cd <main checkout> && git ls-files --others --ignored \
  --exclude-standard -- ':(glob)**/.env*') | while read -r f; do
  mkdir -p "$(dirname "$f")" && cp "<main checkout>/$f" "$f"
done
```

If something still fails to start, it is usually another untracked file, not the
code.

The exception is the fast one-off. One or two light prompts, a small diff, and
nothing to return to. Do that in the current checkout.

If you cannot tell which one it is, make the worktree. Moving work into one
after the fact costs more than making one you turned out not to need.

Remove it once the branch is merged, so `git worktree list` stays a list of
things actually in flight.
