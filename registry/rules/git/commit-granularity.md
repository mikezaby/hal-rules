---
name: Commit Granularity
description: One commit per coherent change, not one per work session
---

# Commit Granularity

Slice commits **one per context**, so a reviewer reads one coherent change per
area instead of following the author's trial and error.

- Squash all iteration on the same thing into one commit. Not one commit per
  work session.
- Keep a feature and the code that wires it up together: a component and its
  page usage belong in the same commit.
- Keep changes to pre-existing shared code (design system, adapters, docs) in
  their own commits, separate from the feature that motivated them. A shared
  fix a ticket happens to need keeps the ticket prefix with no scope tag.
- Every commit stands on its own: it must not reference a file, export or
  token that a later commit introduces.
- Explain **why** in the description, not what the diff already shows.
