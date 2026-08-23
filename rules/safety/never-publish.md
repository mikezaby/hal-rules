---
name: Never Publish a Package
description: Preparing a release is fine; pushing it to a registry is a human's call
---

# Never Publish a Package

**Never run a publish or release command.** This covers every registry and
ecosystem — `npm publish`, `pnpm publish`, `yarn publish`, `gem push`,
`cargo publish`, `twine upload`, `mvn deploy`, `dotnet nuget push`, `go` module
tags, `docker push`, `helm push`, a GitHub release, and anything else that makes
an artifact available to other people.

Publishing is effectively irreversible. A version cannot be truly unpublished
once anyone has fetched it, a package name is permanent, and consumers can pull
it within seconds. Nothing you can verify locally justifies taking that decision
on someone else's behalf.

**Preparing a release is fine, and is where you should stop:**

- bump the version, update the changelog, build the artifact
- run the dry run (`npm publish --dry-run`, `cargo publish --dry-run`, …)
- verify what would actually ship — the file list, the size, the metadata
- report what you checked, then print the exact command for a human to run

Say clearly that you have not published and that the final step is theirs. If a
credential, a one-time code or an approval is required, that is the system
telling you the same thing.
