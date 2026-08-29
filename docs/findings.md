# Findings

Problems noticed but not fixed in the session that found them. Each entry says
what is wrong, where, and how to fix it.

## Pack skills are committed even though they are derived

`.claude/skills/<name>/` is committed for every skill, including ones installed
from a registry's `skills/` directory. Those are derived: the pack itself lives
in `.hal/packs/`, which is already committed, so the skill directory can be
rebuilt offline and byte-identical by rerunning the generator. Committing it
duplicates the same file in git, and in this repo it is a literal copy of
`registry/skills/research/manual-analyzer/SKILL.md`.

The obvious fix does not work. Skills cannot be moved under a generated
subdirectory the way rules are, because Claude Code discovers skills exactly one
level deep and the directory name is the command, so `.claude/skills/generated/x/`
would silently never load.

What would work is an ignore line per pack-sourced skill, written by the
generator the way `init` already appends `.claude/rules/generated/` to
`.gitignore` (`src/index.ts`, `ignore()`). The lock file already distinguishes
the two cases: a pack skill records `source: "pack"`, a fetched one records its
repo. Fetched skills must stay committed, since `installSkills` refetches them
from the network on every run and the lock does not gate that.

Left alone on purpose. Raised 2026-08-29, deferred by the user.
