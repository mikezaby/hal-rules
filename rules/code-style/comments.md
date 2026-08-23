---
name: Comments Explain Why
description: Default to no comments; write one only where the code cannot say it
---

# Comments

Default to none. Well-named code says what it does, and a comment restating it
is one more thing to keep in sync.

Write one only where the reader cannot get there from the code:

- a workaround and the bug it dodges
- a constraint that lives outside the repo
- business logic whose rules are not derivable from the values

One or two lines, then stop. Do not narrate the diff, do not explain the obvious
branch, do not record where a value came from.
