---
name: manual-analyzer
description: Use when given a URL to another product's manual, datasheet, spec or docs site and asked what our project should learn from it. Downloads the document, reads all of it, and writes a record into docs/research/ covering overlapping features, gaps worth closing, and things deliberately not worth copying.
---

# Manual Analyzer

Turn another product's manual into a written record of what our project should
do about it. The output is a document, never a code change.

## Input

A URL to a manual, datasheet, reference guide or docs site.

If a product is named with no URL, ask for one. Do not analyze from memory. A
manual is versioned and specific, and a recalled feature list is wrong in
exactly the details that decide whether a feature is worth copying.

## 1. Fetch the whole thing

A PDF:

```
curl -fL -o /tmp/<slug>.pdf '<url>'
```

Then read it with the Read tool's `pages` parameter, twenty pages per call,
from page 1 until Read runs off the end. **Read all of it.** The first twenty
pages are the marketing and the safety notices; the flows worth stealing are in
the middle, and the limits worth knowing are in the appendix tables.

A docs site: fetch the index, then every page it links inside the same section.

If the fetch fails, say so and stop. Do not substitute a web search summary for
the document.

## 2. Read for four things

- **Overlap.** Something we already do. Record how theirs differs: what it does
  that ours does not, what it refuses to do, what it names differently.
- **Gaps.** Something we do not have. A feature, but more often a _flow_: the
  order they put steps in, the state they let a user come back to, the thing
  they do automatically that we make someone ask for.
- **Constraints.** Numbers and limits: ranges, resolutions, timings, formats,
  quotas. These are the reusable part. They are why the design is shaped that
  way, and they transfer even when the feature does not.
- **Rejects.** Something they do that we should not copy, and the reason. This
  section is the one that saves time later, because without it the same idea
  comes back every six months.

Everything else is noise. Do not summarise the manual.

## 3. Write it down

One file per document: `docs/research/<product>-<document>.md`.

```markdown
# <Product> <Document>

Source: <url>
Version/date on the document: <as printed, not today's date>
Read: pages 1-<n>

## What it is

Two or three sentences. What the product does and who it is for.

## Overlap

Features we also have. For each: what theirs does, how it differs, and whether
the difference is better, worse or just a different call.

## Gaps

What it has that we do not. For each: the flow in their words, and one line on
what adopting it would cost us.

## Constraints

The numbers. Table them.

## Not worth copying

With the reason, so this does not get re-argued.

## Open questions

What the manual does not answer.
```

## Rules

- **Cite the page for every claim**: `(p. 34)`. An uncited claim in this
  document is indistinguishable from a guess, and the whole point is that it is
  not one.
- Quote the manual's own wording for a flow. Paraphrase loses the ordering.
- Say "the manual does not say" rather than inferring. A gap in the manual is
  itself a finding.
- Do not open a PR, file issues, or start implementing. Adopting any of this is
  a separate decision by a person.
- Analyzing a second document about the same product edits the existing file
  rather than adding another.
