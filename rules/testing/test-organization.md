---
name: Test Organization
description: One test file per unit, grouped with describe blocks
paths:
  - "**/*.test.*"
  - "**/*_test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/spec/**"
---

# Test Organization

Keep the test layout simple and consistent, so there is exactly one obvious
place for a given test.

- **One test file per class or module.** All of a unit's tests live in its file.
- **Group with describe blocks** inside that file rather than splitting it.
- **Adding a test for a bug fix?** Put it in the EXISTING file for that unit.
  Name it for the scenario, and comment why it exists if the case is subtle.

Anti-patterns:

- Files named after a problem (`InitializationBug.test.ts`)
- Files named after a pattern (`EnvelopePattern.test.ts`)
- "Comprehensive" or "systemic check" files separate from the unit's own tests
- The same behavior tested in more than one file

Never weaken or delete a test to make a suite pass. A failing test is a finding.
