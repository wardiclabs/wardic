# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Run `bun run changeset` in a PR that changes a package, to record the change; `--empty` for one no
release needs to mention. The release workflow (`.github/workflows/release.yml`) does the rest: it runs
`bun run version-packages` in its "Version Packages" PR, and publishes once that PR merges.
`CONTRIBUTING.md` says how a release goes out. See also the Changesets
[docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md).
