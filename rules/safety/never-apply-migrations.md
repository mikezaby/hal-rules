---
name: Never Apply Migrations
description: Generating a migration is fine; running it against a database is not
---

# Never Apply Migrations

Generating a migration file is fine. **Applying anything to a database is the
team's call, not yours** — never run the migrate, push, or deploy command.

- A schema edit with no generated migration leaves production unable to reach
  the state the code expects. Generate it in the same change and commit both.
- Leave generated SQL exactly as generated. It is the diff between two snapshots,
  and editing it makes the file disagree with what the tool would produce. For
  SQL the tool cannot generate, ask it for a blank custom migration instead.
