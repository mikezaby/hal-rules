---
name: Architecture Decisions
description: A decision made during a change gets an ADR in the same commit, and is never worked around silently
---

# Architecture Decisions

Decisions live in `{{adrDir}}`, one short markdown file each, recording what was
decided and **why**, not only what the code does.

## Writing one

- A change that settles an architectural question gets its ADR in the **same
  commit**. A decision recorded later is a decision reconstructed from memory.
- Record the constraint and the alternatives rejected. The "why" is the whole
  point; the "what" is already in the code.
- A **reversed** decision gets a new ADR that supersedes the old one. Do not edit
  history to match the present. The old reasoning is why the new one exists.
  Small factual corrections edit in place.

## Working under one

- Touching an area covered by a decision? Read that document before changing it.
- **If your plan conflicts with a recorded decision, say so. Do not quietly work
  around it.** The decision may be wrong or stale, and revisiting it deliberately
  is fine. Routing around it without a word is not: it leaves the codebase
  disagreeing with its own documentation, and nobody finds out until the next
  person trusts the ADR.
