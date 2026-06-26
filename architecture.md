# Markdown Viewer — Program Architecture

This document explains how the source files fit together. It is for maintainers; end
users only need `index.html`.

## Why multiple files

The spec originally called for a single self-contained `index.html`. The implementation
grew large enough (theme system, undo/redo, outline, lists, table editor, import/export,
history sidebar, translation sidebar, context menu, bidirectional highlight) that one file
hurt readability. The owner approved splitting into linked files.

**Hard constraint kept:** the tool must still run when opened directly via `file://`
*and* when served from GitHub Pages. That rules out ES modules (`<script type="module">`),
which browsers block under `file://` due to CORS. So every local script is a **classic
`<script src>`** loaded in order, and they communicate through a single global namespace,
`window.MDV`. CSS is a plain `<link>`. No build step, no bundler.

The one feature that needs the network at runtime is **Changelogs** (`fetch('changelog.md')`).
Per spec that feature is GitHub-Pages-only and degrades to "Changelog unavailable." under
`file://`. Everything else works offline-after-load.

## File map

```
index.html        Markup only: toolbar, panes, sidebars, dialogs, panels.
                  Links styles.css + the CDN libs + the js/*.js files (in order).
                  Contains one tiny inline <head> script: applies the saved theme
                  before first paint to avoid a flash of the wrong theme.
styles.css        All styling. House Tokens (uiux reference.md) in :root for light;
                  dark mode via html[data-theme="dark"] — NO prefers-color-scheme.
changelog.md      Fetched at runtime by the How-to/Changelogs panel.
architecture.md   This file.

js/core.js        Foundation. Builds window.MDV. DOM refs, render pipeline
                  (marked + KaTeX + highlight.js, data-line tagging, LaTeX
                  delimiter preprocessing), debounced render, custom undo/redo
                  stack, localStorage persistence, filename auto-derive + lock,
                  dual scroll-to-line, divider + sidebar resize, generic
                  dropdown/sidebar/popover helpers, small shared utilities.
js/table.js       Table editor <dialog>: parse/build GFM, auto-number column,
                  cursor-based insert-vs-edit detection. Ported from the original
                  markdown-table-editor tool.
js/editing.js     Toolbar editing features that mutate the buffer:
                  bullet/number lists, document outline, Clear button,
                  import/export panel (import, drop zone, copy, download),
                  font resizer + light/dark toggle.
js/panels.js      How-to/Changelogs dropdown, History sidebar, Translation sidebar
                  (Chrome Translator API; non-Chrome falls back to real Bergamot).
js/bergamot.js    Real offline translation via the vendored browsermt
                  bergamot-translator WASM engine. Loads the engine, downloads
                  models with a real progress bar (monkey-patched streaming fetch),
                  translates. Needs the page SERVED (not file://).
js/interactions.js Extensible right-click context menu + bidirectional selection
                  highlight (editor <-> preview) and the preview->editor scroll sync.
js/main.js        Runs last. Calls each feature module's init() and wires the
                  toolbar buttons, then does the first render.

vendor/bergamot/  Vendored @browsermt/bergamot-translator@0.4.9 (translator.js +
                  worker/ with the worker script, emscripten glue, and 5MB .wasm).
                  Vendored locally because Web Worker scripts must be same-origin —
                  a cross-origin CDN worker would be blocked.
```

Load order in `index.html` (bottom of `<body>`):
`marked → highlight.js → KaTeX → katex auto-render → core → table → editing → bergamot → panels → interactions → main`.

## The `window.MDV` namespace (shared API)

`core.js` creates `window.MDV` and populates it. Other modules read/write it. Nothing is
wired to events until `main.js` runs, so module load order only matters for *defining*
functions, not for *calling* them.

Key members (see `core.js` for the authoritative list):

- `MDV.editor`, `MDV.preview`, `MDV.filenameInput` — core DOM nodes.
- `MDV.doRender()` / `MDV.scheduleRender()` — render now / debounced.
- `MDV.saveState()` — persist content + filename + lock to localStorage.
- `MDV.commitEdit(content, selStart, selEnd, opts)` — programmatic buffer change that
  is undoable (pushes current state first), re-renders, and saves. Used by table, lists,
  clear, history-reload. **Use this for any code-driven edit** so undo stays correct.
- `MDV.undo()` / `MDV.redo()` / `MDV.canUndo()` / `MDV.canRedo()` / `MDV.clearUndo()`.
- `MDV.scrollToLine(line, opts)` — dual scroll (textarea + preview) to a source line.
- `MDV.deriveFilename()`, `MDV.lockFilename(bool)` — filename auto-derive + lock.
- `MDV.pushHistoryEntry(content, filename)` — called by Clear (defined in panels.js).
- Helpers: `MDV.dropdown(btn, panel)`, `MDV.closeAllPanels()`, `MDV.makeSidebarResizable(...)`,
  `MDV.clamp`, `MDV.escapeHtml`, `MDV.getLineStart`, `MDV.cursorLine`.

## Undo/redo model

Native textarea undo is unreliable here, so it is replaced. `core.js` keeps two stacks
plus `lastState` (the buffer state as of the last committed point).

- **Typing** (`input` event): push `lastState` to the undo stack, clear redo, update
  `lastState`. One snapshot per input event (spec: every edit pushes; no cap).
- **Programmatic edits** go through `commitEdit`, which pushes the pre-edit snapshot.
- **File load / import**: `clearUndo()` — deliberate replacement, not undoable.
- **Clear**: pushes a snapshot first (so Clear is undoable), then wipes.
- Snapshots store `{content, filename, selStart, selEnd}`.

`Cmd/Ctrl+Z` and `Cmd+Shift+Z` / `Ctrl+Y` are bound to these stacks (interactions.js),
and the context menu Undo/Redo items call the same functions.

## Theme

`prefers-color-scheme` is not read anywhere. Light is the first-load default. The toggle
in the Font panel writes `data-theme="dark"` (or removes it) on `<html>` and persists
`theme` in localStorage. The inline `<head>` script applies it before first paint. The two
highlight.js theme stylesheets (light/dark) are toggled via their `disabled` property to
match.

## localStorage keys

| Key | Meaning |
|-----|---------|
| `mdviewer:content` | textarea content |
| `mdviewer:filename` | filename field |
| `mdviewer:filenameLocked` | `"1"` if auto-derive is suspended |
| `theme` | `"light"` \| `"dark"` |
| `fontSize` | textarea font size (px) |
| `mdviewer:history` | JSON array of saved history entries (max 10) |
| `translation_pack_<lang>` | `"downloading"` \| `"done"` \| percent (UI state only) |

## Known limitations

- **Translation**: the Chrome 138+ `Translator` path is implemented against the documented
  API and feature-detected. The non-Chrome path uses **real Bergamot** (vendored WASM) —
  verified end-to-end (en→es downloaded its model and translated correctly). Caveats: it
  needs the page **served** (not file://); only the registry's ~20 pairs are supported and
  non-English↔non-English pivots through English; and on non-Chrome there is no built-in
  language detector, so source language is guessed by script (CJK/Cyrillic/Arabic/Devanagari)
  and otherwise assumed English.
- **Bidirectional highlight** maps rendered text back to source heuristically (text search +
  `data-line`). It handles common cases and falls back to block-level highlight; it is not a
  full source-map.
