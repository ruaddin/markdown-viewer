create a html pyt# Task: Build a Markdown Table Editor (Single HTML File)

## Overview

Create a **single, self-contained `markdown-table-editor.html`** file — no external dependencies, no build step. The app lets a user define columns, fill in table data, and copy the result as raw Markdown.

---

## Functional Requirements

### 1. Column Definer

- A labelled input: **"Number of columns"** — an integer spinner (min: 1, max: 12).
- Below it, a row of text inputs appears — one per column — for the user to **name each column header**.
- Changing the column count updates the header inputs immediately:
  - Adding columns appends new blank header inputs.
  - Removing columns trims from the right (with no data-loss prompt needed).
- Column header inputs are always visible above the table.

### 2. Table Body

- The table renders live as the user types.
- Starts with **1 empty data row** by default.
- An **"Add Row" button** appends a new empty row to the bottom of the table.
- Each cell is a plain `<input type="text">` or `<textarea>` (single-line is fine).
- A **"Delete Row" button** (e.g. a small ✕ icon) on each row allows removal. The last remaining row cannot be deleted — disable or hide the button in that case.
- A **fixed auto-number column** is prepended to every row (header: `#`, values: 1, 2, 3…). It is read-only, not counted in the column-count spinner, and is always included in the Markdown output.

### 3. Live Markdown Preview

- Below the table editor, display a **live-updating preview panel** showing the rendered Markdown table as it would appear in a Markdown viewer (i.e. render it as an HTML `<table>`, styled cleanly).
- Also show the **raw Markdown string** in a read-only `<pre>` / `<code>` block.

### 4. Markdown Import

- Above the column definer, a collapsible **"Import Markdown"** panel contains a `<textarea>` where users can paste a raw GFM table string.
- A **"Load Table"** button parses the pasted markdown and populates the column headers, column count, and all row data in the editor.
- The parser must handle the separator row (`| --- | --- |`) and strip surrounding pipe/whitespace from each cell.
- On a successful parse the panel collapses and the editor updates immediately.
- Invalid/unparseable input shows a brief inline error message instead.

### 5. Copy Button

- A clearly labelled **"Copy Markdown"** button.
- Copies the raw Markdown table string to the clipboard using `navigator.clipboard.writeText()`.
- On success, the button briefly changes label/colour to **"Copied!"** for ~1.5 seconds, then reverts.

### 6. Markdown Output Format

Output must be standard GitHub-Flavored Markdown table syntax. Example for 3 columns, 2 rows:

```
| Name | Age | City |
| --- | --- | --- |
| Alice | 30 | Singapore |
| Bob | 25 | Jakarta |
```

- Empty cells should output as a blank string between pipes: `|  |`
- No alignment colons in the separator row (keep it simple).

---

## Design & Aesthetic Requirements

- **Typography**: Use a monospace or semi-monospace font for the raw Markdown preview. Use a clean, distinctive sans-serif (not Inter or Roboto — consider something like `DM Sans`, `Syne`, or `Space Mono` loaded from Google Fonts) for the UI chrome.
- **Layout**:
  - Import Markdown panel (collapsible) at the very top.
  - Column definer below it.
  - Header name inputs directly beneath, in a row.
  - Table editor in the middle (with auto-number column as first column).
  - "Add Row" button below the table, left-aligned.
  - Raw Markdown preview + Copy button at the bottom.
- **Micro-interactions**: Smooth transitions on row add/remove. Copy button feedback animation. Focus ring on active inputs.
- The UI should feel **purposeful and tight** — no excess whitespace, no decorative elements that don't serve function.

---

## Technical Constraints

- **Single `.html` file** — all CSS and JS must be inline (`<style>` and `<script>` tags). Google Fonts may be loaded via a `<link>` tag.
- **Vanilla JS only** — no frameworks, no libraries.
- Must work in a modern browser (Chrome/Firefox/Safari — no IE).
- No server-side code.
- All state is held in memory (no localStorage needed).

---

## Deliverable

A single file: `markdown-table-editor.html`

It should be openable by double-clicking in any OS and work immediately with no setup.