# Changesets

Every change that should reach npm carries a changeset: a small markdown file
describing the change and the semver bump it needs.

```sh
npm run changeset
```

Pick the bump (`patch` / `minor` / `major`), write the line as a user of the
package would read it, and commit the generated file with your change.

On merge to `main`, CI collects the pending changesets into a
**"Version Packages"** pull request that bumps the version and writes
`CHANGELOG.md`. Merging that PR publishes to npm and cuts the GitHub release.

Changes that do not affect the published package — CI, docs, the demo — need no
changeset.
