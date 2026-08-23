---
name: Bump Only When Asked
description: A version number is a release decision; wait to be told
---

# Bump Only When Asked

**Do not change a version number unless you were asked to.** This covers
`package.json`, `Cargo.toml`, `pyproject.toml`, a gemspec, `build.gradle`, a
chart version, a git tag, and a new release heading in a changelog.

A version is not bookkeeping, it is a statement that a release is intended and
what kind of change it is. Bumping unasked either creates a release nobody
decided to make, or commits the maintainer to one they now have to explain. It
also quietly claims the patch/minor/major judgement, which belongs to whoever
knows what consumers depend on.

Instead:

- Land the change at the version already in the file.
- Say what the next version should be and why ("this changes the config format,
  so it is a minor while pre-1.0"), then let a human decide.
- Bump only on an explicit instruction, and then only to the version you were
  given or agreed.

Several unreleased changes accumulating at one version is normal and fine. The
bump happens once, when someone decides to release.
