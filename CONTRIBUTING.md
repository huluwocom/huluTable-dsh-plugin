# Contributing

Thanks for your interest in contributing to huluTable!

## Ground rules

- All contributions are licensed under the project's [MIT license](./LICENSE).
- Follow the existing code style; `pnpm run lint` must be clean.
- Add or update tests for behavior changes — the coverage gate is 100%.

## Setup

```sh
pnpm install
pnpm link-sdk /path/to/deepseek-harness   # needed for type-check + tests
pnpm run typecheck
pnpm run test
pnpm run lint
```

## Workflow

1. Open an issue describing the bug or feature (or comment on an existing one).
2. Fork the repository and create a branch (`fix/…`, `feat/…`).
3. Make focused commits; keep each commit self-contained.
4. Run the full checks above and the build (`pnpm run build`).
5. Open a pull request against `main` with a clear description and screenshots
   where the UI changed.

## Building the plugin bundle

```sh
pnpm run build    # lib/index.js + lib/invariant.js + lib/client.js
pnpm run pack     # tarball into releases/
```

To try the bundle end-to-end, install it into a local profile and boot the web
surface:

```sh
dsh plugin --profile web add .
dsh web
```

## Commit messages

Use the imperative mood, prefixed with a scope when helpful, e.g.:

```
fix(grid): keep frozen cells aligned on horizontal scroll
feat(library): JSON backup and restore
docs: clarify tarball installation
```

## Release process

1. Bump `version` in `package.json` (SemVer).
2. Update `CHANGELOG.md`.
3. `pnpm run pack` and commit the new `releases/*.tgz` + checksum.
4. Tag the commit (`vX.Y.Z`) and publish a GitHub Release.
