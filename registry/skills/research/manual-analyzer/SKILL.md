---
name: manual-analyzer
description: Use when given another product's manual, datasheet, spec or docs site, as a URL, a local file, or a folder of manuals to scan in bulk, and asked what our project should learn from it. Reads all of each document and writes a record into docs/research/ covering overlapping features, gaps worth closing, and things deliberately not worth copying.
---

# Manual Analyzer

Turn another product's manual into a written record of what our project should
do about it. The output is a document, never a code change.

## Input

A manual, datasheet, reference guide or docs site, as any of:

- a URL
- a path to a file already on disk
- a path to a **directory**, meaning every PDF under it, recursively

If a product is named with none of those, ask for one. Do not analyze from memory. A
manual is versioned and specific, and a recalled feature list is wrong in
exactly the details that decide whether a feature is worth copying.

## 1. Get the whole thing

A PDF behind a URL:

```
curl -fL -o /tmp/<slug>.pdf '<url>'
```

A PDF already on disk needs no download. Read it where it is, and do not copy it
into the repo.

A directory: list what you found before reading anything, so the size of the job
is visible.

```
find <dir> -iname '*.pdf' | sort
```

Then work through them **one at a time**, finishing each document's write-up
before opening the next, and say which one you are on. A folder of twenty
manuals is twenty passes, not one blurred pass over everything. If one file
fails to open, say so, skip it, and keep going.

Either way, read each document with the Read tool's `pages` parameter, twenty pages per call,
from page 1 until Read runs off the end. **Read all of it.** The first twenty
pages are the marketing and the safety notices; the flows worth stealing are in
the middle, and the limits worth knowing are in the appendix tables.

A docs site: fetch the index, then every page it links inside the same section.

If the fetch fails, or the path is not there, say so and stop. Do not substitute
a web search summary for the document.

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

Source: <url, or the file path and where it came from>
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
  rather than adding another. This is what keeps a folder scan from producing
  five near-identical files for one product's five manuals.
- Finish with one short list of which documents produced which file, and which
  were skipped. After a folder scan that list is the only way to tell what was
  actually read.
