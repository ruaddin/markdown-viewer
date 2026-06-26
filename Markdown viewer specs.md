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

> ⚠️ **Superseded by the Font Resizer & Theme Toggle section.** The `prefers-color-scheme`-only rule no longer applies. See that section for the authoritative theming spec.

## Translation Tool ⚠️ NEW ADDITION — future implementors take note

> **This section describes a new feature not yet implemented.** It is recorded here for the next implementation pass. All decisions below were settled in a grilling session on 2026-06-26.

### Overview

A translation sidebar — a third panel on the far right of the viewport. It is toggled by a button in the top toolbar (rightmost position). Opening it compresses the two existing panes to make room; it does not overlay them, grey them out, or require horizontal scroll. The sidebar has a visually distinct darker-grey background to separate it from the editor and preview. It has its own drag handle on its left edge for width resizing, independent of the existing editor/preview divider.

### API strategy

- **Primary (Chrome 138+):** Chrome's built-in Translation API (`window.translation` / `Translator`). Fully client-side — no data leaves the browser.
- **Fallback (all other browsers):** Bergamot WASM (Mozilla's local translation engine). Also fully client-side — no data leaves the browser.
- Detection: on sidebar open, check for API availability. If unavailable, show a one-time popup (see Fallback below).

### Sidebar layout and controls

Top to bottom:

1. **Source language display** — read-only, shows the auto-detected language of the current text (updated after each translation run).
2. **Target language selector** — dropdown, default `English`. Not persisted to `localStorage`; resets to English on page load.
3. **Translate button** — manual trigger (not live). Disabled until the language pack for the selected target is fully downloaded and ready.
4. **Language pack download progress bar** — shown only while a pack is actively downloading or was mid-download on a previous session (see Pack download & persistence). Hidden once the pack for the current target language is complete.
5. **Translation output area** — displays the translated Markdown source text. Read-only. Scrollable independently.

### Translation scope and trigger

- **Default (no selection):** clicking Translate sends the full textarea content to the API.
- **With selection:** if the user has text selected in the textarea when they click Translate, only the selected text is translated. The output area still receives the result.
- **Right-click context menu on selected text:** selecting text in the textarea and right-clicking opens a custom context menu. "Translate" is one item in this menu. This menu is designed to be extensible for future functions. Choosing "Translate" from the menu:
  1. Fires translation on the selected text.
  2. Displays the result in a small inline popover anchored near the cursor. The popover has an explicit ✕ close button and dismisses on click-outside as well.
  3. Simultaneously pushes the same result into the sidebar output area (sidebar need not be open for this — it is populated in the background).

### Language pack download and persistence (Chrome API)

- Packs download silently in the background when a new target language is first selected.
- The sidebar progress bar shows download progress while a pack is in flight.
- Pack download state is tracked in `localStorage` per language pair (`translation_pack_<lang>: "downloading" | "done" | <percent>`), so:
  - If the user closes the page mid-download, the progress bar re-appears at the correct approximate state on next load and resumes.
  - If a pack is already `"done"`, the progress bar is hidden and the Translate button is immediately enabled for that language on future loads.
- The Chrome API retains downloaded packs natively in the browser's model storage; `localStorage` tracks state only for UI purposes.

### Fallback for non-Chrome browsers (Bergamot)

If the Translation API is unavailable on page load, a non-blocking popup appears once per session:

> **"The built-in Translation API requires Chrome 138 or later."**
> "You can still use offline translation via Bergamot. Note: language model files are large (100 MB+ per language pair) and will be downloaded to your browser."
> \[Use Bergamot\]  \[Dismiss\]

- **Dismiss:** closes the popup; the sidebar translation controls remain disabled with a static note explaining why.
- **Use Bergamot:** closes the popup immediately and begins downloading the Bergamot WASM engine + the model file for the currently selected target language. The sidebar's progress bar appears and tracks this download using the same `localStorage` persistence pattern as the Chrome API pack downloads. Once ready, the Translate button enables.
- Bergamot packs, once downloaded, persist in the browser cache (via Cache API or IndexedDB). The same "done" state is written to `localStorage` so subsequent sessions skip the download.
- The Bergamot WASM engine is loaded from CDN, pinned to a specific version. Model files are fetched from Mozilla's model distribution endpoint.

### What this feature does NOT do

- Translated output is not wired to the Download or Copy buttons — it is view-only in the sidebar/popover.
- No live / auto-translate on typing.
- No server-side component — all translation is in-browser.
- Target language choice is not saved between sessions.

---

## Font Resizer & Theme Toggle ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26. This section supersedes the Theming section — `prefers-color-scheme` detection is removed; the manual toggle is the sole theme driver.

### Toolbar control

A font-size icon sits in the top toolbar (right side, near the Translation sidebar toggle). Icon-only — requires `aria-label="Font size and theme"`. Clicking opens a dropdown panel directly below it. The dropdown itself inherits the active page theme tokens (no hardcoded palette inside it).

### Dropdown layout (top to bottom)

| # | Element | Detail |
|---|---------|--------|
| 1 | **Size control row** | Numeric `<input>` (min 5, max 60, step 1, default 14) with a **−** button on its left and a **+** button on its right. Typing directly or clicking +/− updates font size immediately. Values outside 5–60 are clamped on blur. |
| 2 | **Preset list** | Clickable items: **10 · 12 · 14 · 16 · 18 · 20 · 24 · 48 · 60**. Clicking a preset sets the numeric input and applies the size immediately. The active preset (exact match) is highlighted; no highlight shown for custom values between presets. |
| 3 | *(separator)* | |
| 4 | **Light / Dark toggle** | Labelled toggle switch (`Light` left, `Dark` right). Controls global page theme. Initial state: **Light**. |

### Font size scope

- Applies to the raw Markdown **textarea only** — not the rendered preview.
- All text in the textarea (including typed code spans) scales uniformly; no element within the textarea is excluded.
- Persisted to `localStorage` as `fontSize`. Restored on page load.

### Theme (replaces `prefers-color-scheme` approach)

- Page always opens in **Light** on first load — system preference (`prefers-color-scheme`) is not read at any point.
- User controls Light ↔ Dark exclusively via the toggle in this dropdown.
- Chosen theme persisted to `localStorage` as `theme` (`"light"` | `"dark"`). Restored on page load before first render to avoid flash.
- **Color system:** House Tokens defined in `uiux reference.md`. The `:root` block carries light-mode values. Dark-mode values are activated by setting `data-theme="dark"` on `<html>` (not via `@media (prefers-color-scheme: dark)` — that media block is omitted entirely so the toggle has sole control).
- All components — editor, preview, table modal, translation sidebar, this dropdown, right-click context menu, all popovers — reference the CSS custom properties. No component hardcodes hex values.
- Contrast, focus ring, and text-on-button pairings follow the House Token contrast notes verbatim (see `uiux reference.md` §House Tokens).

---

## Custom Undo / Redo Stack ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

The browser's native textarea undo is unreliable in this context and must be replaced with a custom stack.

### Stack behaviour

- Every edit to the textarea (keystroke, paste, cut) pushes a snapshot to the custom undo stack.
- **File load** (drag-and-drop or file picker) **clears the stack** entirely — it is a deliberate content replacement, not an undoable edit.
- **Clear** (see Clear Button section) pushes a snapshot before wiping, making it undoable.
- Stack depth is implementation-defined; no explicit cap required.

### Triggers

| Action | Trigger |
|--------|---------|
| Undo | Right-click menu "Undo" **and** Cmd+Z (Mac) / Ctrl+Z (Win/Linux) |
| Redo | Right-click menu "Redo" **and** Cmd+Shift+Z (Mac) / Ctrl+Y (Win/Linux) |

Both keyboard shortcuts are wired to the custom stack, not the browser's native history, since native undo is non-functional.

### Right-click menu items

"Undo" and "Redo" appear as items in the extensible right-click context menu (defined in full in the Right-click Context Menu section below). They are greyed out when the respective stack is empty.

---

## Right-click Context Menu ⚠️ NEW ADDITION — future implementors take note

> This section consolidates the full right-click context menu definition. The Translation Tool section introduced the menu; this section supersedes that partial description. Decisions settled in grilling session 2026-06-26.

A custom context menu replaces the browser default when the user right-clicks inside the editor textarea. The menu is intentionally extensible — items are added here as features are defined.

### Current item list (in display order)

| Item | Condition shown | Behaviour |
|------|-----------------|-----------|
| **Undo** | Always | Fires custom undo (greyed out if stack empty) |
| **Redo** | Always | Fires custom redo (greyed out if stack empty) |
| *(separator)* | | |
| **Translate** | Always | Translates selection (or full doc if no selection); result shown in inline popover + sidebar. See Translation Tool section. |
| *(separator)* | | |
| **Bullet** | Text is selected | Applies `- ` prefix to each non-empty line in selection; removes prefix if all lines are already bulleted; converts from numbered if lines are numbered. See Bulleting / Numbering section. |
| **Number** | Text is selected | Applies sequential `1.` `2.` … prefix to each non-empty line; removes prefix if all lines are already numbered; converts from bullet if lines are bulleted. |
| *(separator)* | | |
| **Edit Table** | Cursor / selection overlaps an existing Markdown table | Opens the table modal pre-loaded with that table |
| **Insert Table** | Cursor / selection does not overlap any table | Opens the table modal with a blank table |
| *(both "Edit Table" and "Insert Table")* | Selection spans table and non-table content | Both items appear; "Edit Table" targets the table containing the majority of selected content; tie broken by document order (first table wins) |
| *(separator)* | | |
| **Highlight in Preview** | Text is selected | Highlights the selection in the rendered preview. See Bidirectional Selection Highlight section. |
| **Remove Highlight** | Right-click target is an active highlight in the **preview** pane | Removes only that specific highlight; other active highlights unaffected |

### Notes

- The menu does not appear outside the textarea or on right-click in the preview pane, except for the "Remove Highlight" item which appears when right-clicking an active highlight in the preview.
- New items added to the menu in future features belong in this table.

---

## Bidirectional Selection Highlight ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

### Editor → Preview (highlighting from source)

When the user right-clicks selected text in the textarea and chooses **"Highlight in Preview"**:

1. The selected raw Markdown is stripped of delimiter syntax.
2. The match target is located in the rendered preview using the following rules:

| Case | Behaviour |
|------|-----------|
| Selection includes MD delimiter characters (`#`, `*`, `_`, `` ` ``, `~`, `>`, `-`, `[`, `]`, etc.) | Block-level highlight: the entire rendered block containing the match is highlighted |
| Selection is the full text content of a single-content block (e.g. the text of a heading, with or without its `###` prefix) | Block-level highlight |
| Selection is a sub-phrase within a larger paragraph (no delimiters, not the full block) | Word / phrase-level highlight: only the matched span within the rendered block is highlighted |
| No match found after stripping | Graceful fallback to block-level highlight of the block at the cursor's current line |

3. Multiple highlights can be active simultaneously — a new highlight does not replace previous ones.
4. The preview scrolls to bring the highlighted region into view.

### Preview → Editor (highlighting from rendered output)

When the user selects text in the preview pane:

1. The editor textarea scrolls to the corresponding source line.
2. The corresponding raw Markdown text is **selected** in the textarea (browser-native selection highlight), since the textarea cannot render arbitrary inline highlights.
3. The preview simultaneously highlights the selected rendered text in place (same highlight style as editor → preview).

### Scroll sync extension

Selecting text in the preview scrolls the editor to the corresponding line. This extends the existing one-way scroll sync (which fires on `input` events only) to also fire on preview text selection. The existing on-input sync behaviour is unchanged.

### Removing highlights

- Right-clicking an active highlight in the preview shows the context menu with **"Remove Highlight"**.
- Choosing it removes that specific highlight only; all other active highlights remain.
- Highlights are not persisted to `localStorage` — they reset on page reload.

---

## Clear Button ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

- A **"Clear"** button sits in the top toolbar.
- Clicking it **immediately** wipes the textarea content and resets the filename field to `untitled.md`. No confirmation prompt is shown.
- Before wiping, the current content and filename are pushed onto the custom undo stack, making the clear action fully undoable via Cmd+Z or the right-click Undo item.
- `localStorage` autosave fires after the clear (so a page reload after clearing restores an empty state, not the pre-clear content).

---

## Toolbar Reorganisation ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26. This section supersedes the toolbar references scattered across the Layout, Input, and Output sections.

### Layout

```
[ Outline ] [ Bullet/# ] [ Table ] [ Import/Export ] [ Clear ] [ Font ]   ·····   <Filename (centre)>   ·····   [ How to / v1.0.0 ] [ Translate ] [ History ]
```

| Position | Control | Notes |
|----------|---------|-------|
| Far left 1 | **Document Outline** | Dropdown panel |
| Far left 2 | **Bulleting / Numbering** | Dropdown panel |
| Far left 3 | **Add Table** | Opens table modal directly (no dropdown) |
| Far left 4 | **Import / Export** | Dropdown panel |
| Far left 5 | **Clear** | Immediate action button (see Clear Button section) |
| Far left 6 | **Font Resizer** | Dropdown panel (see Font Resizer & Theme Toggle section) |
| **Centre** | **Filename field** | Always visible; editable inline text field |
| Far right 1 | **How to Use / Changelogs** | Dropdown panel; version label shown below this button |
| Far right 2 | **Translation** | Sidebar toggle (see Translation Tool section) |
| Far right 3 | **History** | Sidebar toggle |

All icon-only controls require `aria-label`. All sidebars (Translation, History) compress the existing panes when open — they do not overlay. All dropdown panels close on click-outside and on Esc.

---

## Document Outline ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

### Toolbar control

Icon-only button, far left position 1. `aria-label="Document outline"`. Opens a dropdown panel directly below.

### Panel contents

- Lists all headings (h1–h6) found in the textarea, in document order.
- Each entry is indented proportionally to heading level: h1 = 0 indent, h2 = 1 level, h3 = 2 levels, and so on.
- Each entry is a clickable item showing the heading text.

### Update strategy (recommended)

Parse the textarea for ATX headings (`# …`) each time the dropdown is **opened**, not continuously while the user types. The outline is hidden during typing so live-parsing buys nothing; re-parsing on open is accurate, instant even on large documents, and adds zero overhead during editing. No dirty-flag or debounce mechanism is needed.

### Interaction

- Clicking a heading item: scrolls both the textarea and the preview to that heading's position (dual-scroll, same mechanism as the Bidirectional Selection Highlight feature), then closes the dropdown.
- The dropdown also closes on click-outside.

---

## Bulleting / Numbering ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

### Toolbar control

Icon-only button, far left position 2. `aria-label="Bullet or number list"`. Opens a dropdown with two items: **Bullet** and **Number**.

### Behaviour

Scope is the current textarea selection. Line breaks determine list elements — each non-empty line in the selection becomes one list item.

| Action | Condition | Result |
|--------|-----------|--------|
| Click **Bullet** | Lines have no list prefix | Prepends `- ` to each non-empty line |
| Click **Bullet** | All lines already have `- ` prefix | Removes `- ` prefix (de-bullets) |
| Click **Bullet** | Lines have numbered prefix | Replaces `1.` `2.` … with `- ` (converts type) |
| Click **Number** | Lines have no list prefix | Prepends `1.` `2.` `3.` … sequentially to each non-empty line |
| Click **Number** | All lines already numbered | Removes numbered prefix (de-numbers) |
| Click **Number** | Lines have `- ` prefix | Replaces `- ` with `1.` `2.` … (converts type) |

- Empty lines within the selection are preserved as-is and do not increment the numbering counter.
- The action is pushed onto the custom undo stack.

### Right-click context menu

"Bullet" and "Number" appear in the extensible right-click context menu (see Right-click Context Menu section, already updated). Behaviour is identical to the toolbar dropdown.

---

## Import / Export Panel ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26. Supersedes the Output section and the file-input parts of the Input section.

### Toolbar control

Button labelled **"Import / Export"** (or icon with that `aria-label`), far left position 4. Opens a dropdown panel directly below.

### Panel contents (in order)

| Item | Behaviour |
|------|-----------|
| **Import file** button | Opens `<input type="file" accept=".md">` picker. Loading a file sets the filename field and clears the undo stack. |
| **Drop zone** | A visible drop target within the panel for `.md` files. Full-page drag-and-drop remains active alongside this as a convenience (see Layout section). Both are always present. |
| **Copy** | Copies raw Markdown source to clipboard via Clipboard API. Button label flips to "Copied!" briefly as confirmation. |
| **Download** | Saves raw Markdown as a `.md` file using the current filename. Blob + object URL, revoked after use. |

### Filename field (toolbar centre)

Always visible as an inline editable `<input>` in the centre of the toolbar.

| State | Displayed value |
|-------|----------------|
| File imported | The imported filename (e.g. `notes.md`) |
| New document, no explicit name set | First 5 words of textarea content joined by hyphens + `.md`, updated live as the user types |
| New document, textarea empty | `untitled.md` |
| After Clear | `untitled.md` (editor is empty; auto-derive has no words to pull) |
| User types into the field | Custom name locked in; auto-derive suspended until next Clear or file import |

- Persisted to `localStorage` (existing behaviour retained).
- Used by the Download action.

---

## How to Use / Changelogs ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

### Toolbar control

Icon-only button, far right position 1. `aria-label="How to use and changelogs"`. Opens a dropdown panel directly below.

A **static version label** (e.g. `v1.0.0`) is rendered as small text in the toolbar directly below this button. Hardcoded in the HTML; updated manually with each release.

### Dropdown panel contents

Two collapsible accordion sections — opening one closes the other.

**"How to Use"**
- Built-in, inlined directly in the HTML source. Not fetched.
- Rendered as rich content (images, structured steps). Implementor may use static HTML or the existing marked.js stack — whichever renders the instructional content most cleanly.
- Updated by editing the HTML source directly.

**"Changelogs"**
- Fetched at runtime from `changelog.md` located in the same directory as `index.html`.
- Rendered using the existing marked.js stack (simple text; no LaTeX needed).
- On fetch failure: shows inline fallback message "Changelog unavailable."
- `file://` fallback not required — this tool is served exclusively from GitHub Pages.

---

## History Sidebar ⚠️ NEW ADDITION — future implementors take note

> Decisions settled in grilling session 2026-06-26.

### Toolbar control

Icon-only button, far right position 3. `aria-label="Document history"`. Toggles the History sidebar open/closed. Opening compresses the existing panes (same pattern as the Translation sidebar). Has its own drag handle for width resizing.

### What counts as a history entry

- A history entry is saved each time the **Clear** button is triggered — it captures the textarea content and filename at that moment.
- The **current in-progress document** (whatever is live in the editor right now) is displayed at the top of the panel as a distinct "live" entry. It is not counted against the 10-entry limit and is not stored separately — it reads directly from the editor's live state.
- When saved entries exceed 10, the oldest is dropped automatically.
- All entries stored in `localStorage`.

### Entry format

```
DD/MM/YYYY HH:MM  |  <filename or first 5 words of content>        [↺ Reload]
```

- Filename used if one was set at time of Clear; otherwise first 5 words of content.
- Timestamp is the moment the Clear was triggered.

### Per-entry actions

| Action | Behaviour |
|--------|-----------|
| **Reload** (inline button on each row) | Pushes current editor state onto the undo stack, then replaces editor content and filename with that entry's saved values. |
| **Delete** (per entry) | Removes that entry from history. Irreversible (no undo for history deletion). |
| **Download** (per entry) | Saves that entry's raw content as a `.md` file using its stored filename. |

### Sidebar-level action

A **"Clear all history"** button at the bottom of the panel removes all 10 saved entries. The live current-document entry at the top is unaffected. Irreversible.

---

## Explicitly out of scope

- No export to rendered HTML/PDF (browser print-to-PDF covers this if ever needed).
- No toolbar formatting buttons for inline styles (bold/italic/etc.) or keyboard-shortcut formatting. Bulleting and numbering are in scope (see Bulleting / Numbering section); inline emphasis is not.
- No HTML sanitization of rendered Markdown (single-user, trusted personal-content tool).
- No scroll-sync on cursor movement (clicks/arrow keys) — only on typing, by design, so both panes can be viewed/scrolled independently otherwise.

## Usability baseline (per uiux skill)

- Copy/Download actions show visible success state.
- No layout shift when preview renders.
- Real semantic elements: `<button>`, `<label>`, `<textarea>` — not styled `<div>`s.
- `aria-label` on any icon-only controls.
- Keyboard-reachable primary actions; visible focus outlines preserved.
- Text contrast ≥ 4.5:1 in both light and dark themes.
