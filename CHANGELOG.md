# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1] — 2025-08-16

Initial open-source release of huluTable as a standalone DeepSeek Harness
bundle (`dsh-hulutable-plugin`).

### Added

- Table library: create from 6 bilingual templates or blank, search, tags,
  stars, rename, duplicate, recycle bin (30-day TTL), one-click JSON
  backup/restore; lazy document loading so the library never drops tables.
- Virtualized grid editor: double-click editing, drag-select, TSV clipboard,
  fill drag with series extrapolation, delta-level undo/redo, long-press drag
  to reorder rows/columns, row/column copy/cut/paste.
- 18 column types with format validation, colored dropdown options, linked
  selects, column settings, edge-drag resizing and positional frozen columns.
- Filters and multi-level sorts; header goal progress chips with a goals panel.
- Formula engine: 30+ functions, range references, automatic recalculation.
- Views: kanban (drag-to-transition), calendar (jump to earliest date), chart
  (bar/pie/funnel), with view management.
- Conditional formatting rules; per-cell edit history and comments.
- Excel `.xlsx` / `.csv` import (preview + create/append) and export.
- Self-contained bundle packaging: `dsh.bundle` patch layer that disables the
  built-in `ui-hulutable` row and registers this package; `prepare` build from
  source; prebuilt tarball in `releases/`.

[v0.1]: https://github.com/huluwocom/HuluTable/releases/tag/v0.1
