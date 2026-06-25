# Markdown Viewer — Spec

A single-page Markdown + LaTeX editor/viewer, hosted as a static page on GitHub Pages.

## Delivery

- **Single self-contained `index.html`** — no build step, no bundler. CSS in `<style>`, JS in `<script>`, both inline.
- Dependencies loaded from CDN, **pinned to specific versions** (never `@latest`).
- Must work opened directly via `file://` and when served from GitHub Pages.

## Libraries (CDN, pinned)

- **marked.js** — Markdown → HTML parsing (GFM enabled by default: tables, strikethrough, task lists).
- **KaTeX** — LaTeX rendering.
- **highlight.js** — fenced code block syntax highlighting, wired into `marked`'s code renderer; auto-detect language if no fence language is specified.

## LaTeX delimiters

Support all four common delimiter styles:
- `$...$` and `$$...$$`
- `\(...\)` and `\[...\]`

Implementation: a preprocessing pass converts `\(...\)` → `$...$` and `\[...\]` → `$$...$$` before/alongside KaTeX auto-render, **skipping fenced code blocks and inline code spans** so literal backslashes in code aren't mangled.

## Layout

- Full-viewport split pane: editor (textarea) on the left, live preview on the right.
- Draggable resize divider between panes.
- Spans the entire window at any size — no fixed/max width.
- Stacks vertically below a mobile breakpoint (CSS media query).

## Input

- Type/paste directly into the textarea.
- File upload: drag-and-drop onto the page **and** a fallback `<input type="file">` picker — loads a `.md` file's contents into the textarea (per uiux skill file-input rule: visible drop zone + fallback always both present).

## Rendering behavior

- Live preview re-renders on input, debounced ~150–250ms.
- On render error: keep the existing rendered output / source text intact and show an inline error — never lose the textarea content.
- **KaTeX errors:** use KaTeX's `throwOnError: false` (default `errorColor`, `#cc0000`) so a single malformed formula renders inline in red showing its raw source, instead of failing the whole render. Rest of the document renders normally.
- **Scrolling:** editor and preview scroll independently in general. Exception: on the `input` event only (typing/deleting — *not* on cursor movement via click or arrow keys), the preview auto-scrolls to the block corresponding to the cursor's current line. Implemented via a custom `marked` renderer that tags top-level blocks with `data-line` source-line attributes; on input, find the block containing the cursor's line and `scrollIntoView`.

## Table editing

A toolbar button labeled **"Table"** opens a grid-based table editor in a modal `<dialog>`, adapted from the existing `markdown-table-editor.html` tool (column/row add & delete, GFM import/parse, generated Markdown output).

- **Insert vs. edit (auto-detected, not by button label):** when opened, the textarea's cursor position is checked. If the cursor sits inside an existing Markdown table block, that block is parsed (reusing the base tool's `parseMarkdownTable`) and loaded into the grid editor for editing; clicking "Done" replaces that exact block in the textarea. If the cursor isn't inside a table, the modal opens with a blank table (default 3 columns, 1 row); "Done" inserts the generated Markdown at the cursor (surrounded by blank lines as needed for valid GFM parsing).
- **Auto-number `#` column:** optional, via an "Auto-number rows" checkbox, **off by default**. When editing an existing table, the checkbox reflects whether that table already has a leading `#`-style numbered column.
- **Styling unification:** the modal does **not** bring its own fixed light-only palette or Google Fonts (`DM Sans`/`Space Mono`). It inherits the main page's CSS variables (including dark mode via `prefers-color-scheme`) and font stacks — system font for UI text, the page's existing monospace stack for cell inputs/raw preview — so it reads as one tool, not two stitched together.
- Modal follows the same dialog usability rules as the rest of the page: traps focus, closes on Esc, visible focus outlines.

## Output

- **Download** button: saves the raw Markdown source as a `.md` file (Blob + object URL, revoked after use).
- **Copy** button: copies the raw Markdown source (not rendered output) to the clipboard via the Clipboard API, with a visible confirmation (e.g., button label flips to "Copied!" briefly).
- **Filename**: an always-visible inline text field (in a small toolbar) for naming the output file, default `untitled.md`. Used by the Download button. Persisted alongside content (see Persistence).

## Persistence

- Autosave textarea content and the filename field to `localStorage` on every input, debounced.
- Restore from `localStorage` on page load.
- First-ever load (no saved state): textarea starts **empty** (no placeholder/example content).

## Theming

- Light/dark via CSS `prefers-color-scheme` media query only.
- **No manual toggle, no settings panel** — single sensible default per system preference.

## Explicitly out of scope

- No export to rendered HTML/PDF (browser print-to-PDF covers this if ever needed).
- No toolbar formatting buttons (bold/italic/etc.) or keyboard-shortcut formatting.
- No HTML sanitization of rendered Markdown (single-user, trusted personal-content tool).
- No scroll-sync on cursor movement (clicks/arrow keys) — only on typing, by design, so both panes can be viewed/scrolled independently otherwise.

## Usability baseline (per uiux skill)

- Copy/Download actions show visible success state.
- No layout shift when preview renders.
- Real semantic elements: `<button>`, `<label>`, `<textarea>` — not styled `<div>`s.
- `aria-label` on any icon-only controls.
- Keyboard-reachable primary actions; visible focus outlines preserved.
- Text contrast ≥ 4.5:1 in both light and dark themes.
