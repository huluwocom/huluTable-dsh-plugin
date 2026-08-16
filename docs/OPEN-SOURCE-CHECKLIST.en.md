# Pre-release Open-Source Checklist

Go through this list before making the repository public on GitHub. Checked items are done; ⚠️ items need the repository owner's confirmation.

## Legal & licenses

- [x] `LICENSE`: MIT, year 2025, holder `huluTable contributors`.
- [x] Third-party licenses: `clsx` (MIT), `recharts` (MIT), `xlsx / SheetJS` (Apache-2.0) — see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). All runtime dependencies are permissive (commercial use and redistribution allowed).
- [x] No third-party code copy-pasted into the source; CSS/icons are original or system icons, no copyrighted assets.
- [x] Template rows are fictional sample data (Emily Chen/Leo Li…), no real personal information.
- [ ] ⚠️ If a non-MIT/Apache/BSD dependency is added later, re-evaluate and update THIRD_PARTY_NOTICES.

## Sensitive data

- [x] No API keys / tokens / passwords: all data stays in the user's browser IndexedDB and the plugin makes no network requests.
- [x] No hardcoded personal paths (whole-tree scan for `/Users/…`).
- [x] Screenshots use fictional sample data, nothing sensitive.
- [x] `.gitignore` covers `node_modules/`, `lib/`, `coverage/`, `.env*`, `.DS_Store`, logs.

## Repository hygiene

- [x] No `.DS_Store` or stray large files; `git status` is clean after the initial commit.
- [x] `releases/*.tgz` is an intentional deliverable (the install bundle) tracked with a SHA-256 checksum.
- [x] `lib/` is not committed: generated on demand by `prepare`/`build` (npm publish builds it, git installs build it, the tarball ships it prebuilt).
- [ ] ⚠️ `package.json` `repository`/`bugs`/`homepage` use the placeholder `<your-account>` — replace with the real GitHub URL before pushing.

## Engineering quality

- [x] Self-contained build: `pnpm install` + `prepare` produce `lib/` with no monorepo context.
- [x] Build-time purity gate: illegal cross-plugin value imports fail the build.
- [x] Complete test suite (48 files / 486 cases, 100% line/branch/function/statement coverage) runnable via `pnpm test` after linking the SDK.
- [x] lint (oxlint) and type-check (tsc) scripts wired up.
- [x] CI: `.github/workflows/ci.yml` covers the build (no SDK needed) and tests (checks out the harness and links it).
- [x] Semantic versioning: currently `0.1.0`; bump per SemVer after release, major for breaking changes.

## Compatibility statements

- [x] The DeepSeek Harness environment and the `dsh` CLI are stated as prerequisites; the README documents three install paths (local / git / tarball).
- [x] The `cordis.patch.yml` "disable built-in row + insert independent row" strategy is verified with `dsh --dump-config` (built-in `ui-hulutable` disabled, `hulutable → dsh-hulutable-plugin` inserted).
- [ ] ⚠️ If upstream `dsh-web-app` ever drops the built-in `ui-hulutable` row, the disable patch is skipped with a warning (harmless); remove that line from the patch then.

## Community (post-release)

- [ ] Provide clear issue templates and labels.
- [ ] Decide whether to publish to npm (`pnpm publish`) and fill in author/contributors in `package.json` first.
- [ ] Maintain `CHANGELOG.md` per release (Keep a Changelog style).
- [ ] Consider GitHub Releases and attach `releases/*.tgz` as a release asset.

## Known limitations (state honestly)

- Data lives only in the browser's IndexedDB: clearing browser data clears tables; migrate across devices via backup/restore or Excel export.
- The plugin targets the technical-preview DeepSeek Harness Web surface: the SDK packages (`@deepseek-ai/*`) are not on npm yet; the web shell provides the platform modules at runtime, and dev-time type-check/tests need `pnpm link-sdk` against a local harness checkout.
- The `dsh.client.inject` manifest reuses the built-in plugin's service keys; follow upstream if the shell's service interfaces change.
