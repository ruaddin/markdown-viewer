# Changelog

## v1.2.0

- Translation now preserves the source's line breaks: text is translated
  line-by-line and rejoined, so the output keeps its structure and stays readable.
- New "Live sync" checkbox in the translation sidebar — when on, the full
  document is re-translated automatically as you type. State persists across reloads.

## v1.1.0

- Offline translation: non-Chrome browsers now translate via the bundled Bergamot
  engine, with a real model-download progress bar.
- Translation and History sidebars are now mutually exclusive (one open at a time).
- Removed the stray page-level scrollbar; only the editor, preview, and panels scroll.

## v1.0.0

First public release.

- Live Markdown + LaTeX preview (marked, KaTeX, highlight.js).
- Split editor/preview with draggable divider; stacks on narrow screens.
- Document outline, bullet/number lists, table editor (insert & edit).
- Import / Export panel: import, drag-and-drop, copy, download.
- Custom undo/redo stack (Cmd/Ctrl+Z, Cmd+Shift+Z / Ctrl+Y).
- Right-click context menu and bidirectional selection highlight.
- Clear button and History sidebar (last 10 cleared documents).
- Translation sidebar (Chrome built-in Translator API; fallback notice elsewhere).
- Font size control and manual Light / Dark theme toggle.
