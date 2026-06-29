/* ============================================================================
   core.js — foundation: state, render pipeline, undo/redo, persistence,
   scroll, filename, and shared UI helpers. Builds window.MDV.
   Classic script (no modules) so the tool runs under file://.
   ========================================================================== */
(function () {
  'use strict';

  var MDV = (window.MDV = window.MDV || {});

  // ── DOM refs ──────────────────────────────────────────────────────────────
  var editor        = document.getElementById('editor');
  var preview       = document.getElementById('preview');
  var errorBanner   = document.getElementById('error-banner');
  var filenameInput = document.getElementById('filename-input');
  var divider       = document.getElementById('divider');
  var splitContainer = document.querySelector('.split-container');
  var editorPane    = document.querySelector('.editor-pane');
  var previewPane   = document.querySelector('.preview-pane');

  MDV.editor = editor;
  MDV.preview = preview;
  MDV.filenameInput = filenameInput;

  // ── Storage keys ────────────────────────────────────────────────────────
  var K = MDV.K = {
    content: 'mdviewer:content',
    filename: 'mdviewer:filename',
    locked: 'mdviewer:filenameLocked',
    theme: 'theme',
    fontSize: 'fontSize',
    history: 'mdviewer:history',
    packPrefix: 'translation_pack_',
    liveSync: 'mdviewer:liveSync'
  };

  // ── Small utilities ───────────────────────────────────────────────────────
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  MDV.clamp = clamp;
  MDV.escapeHtml = escapeHtml;

  MDV.lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  MDV.lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  MDV.lsDel = function (k) { try { localStorage.removeItem(k); } catch (e) {} };

  // offset of the first character of a 1-based line number
  MDV.getLineStart = function (text, line) {
    var idx = 0;
    for (var i = 1; i < line; i++) {
      var nl = text.indexOf('\n', idx);
      if (nl === -1) return text.length;
      idx = nl + 1;
    }
    return idx;
  };
  MDV.cursorLine = function (text, pos) { return text.slice(0, pos).split('\n').length; };

  function countNewlines(s) { var n = 0; for (var i = 0; i < s.length; i++) if (s[i] === '\n') n++; return n; }

  // ── LaTeX delimiter preprocessing ────────────────────────────────────────
  // \( \) -> $ $ and \[ \] -> $$ $$, skipping fenced code + inline code spans.
  function preprocessLatexDelimiters(src) {
    var lines = src.split('\n');
    var inFence = false, fenceChar = '', fenceLen = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        var marker = fenceMatch[1];
        if (!inFence) { inFence = true; fenceChar = marker[0]; fenceLen = marker.length; }
        else if (marker[0] === fenceChar && marker.length >= fenceLen) { inFence = false; }
        continue;
      }
      if (inFence) continue;
      lines[i] = replaceOutsideInlineCode(line);
    }
    return lines.join('\n');
  }
  function replaceOutsideInlineCode(line) {
    var parts = line.split(/(`[^`]*`)/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) continue;
      parts[i] = parts[i]
        .replace(/\\\(/g, '$').replace(/\\\)/g, '$')
        .replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
    }
    return parts.join('');
  }

  // ── Markdown rendering (marked + highlight.js + data-line tagging) ─────────
  var hljsRenderer = new marked.Renderer();
  hljsRenderer.code = function (code, infostring) {
    var lang = (infostring || '').match(/\S*/)[0];
    var highlighted;
    try {
      highlighted = (lang && hljs.getLanguage(lang))
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch (e) { highlighted = escapeHtml(code); }
    return '<pre><code class="hljs">' + highlighted + '</code></pre>';
  };
  var markedOptions = { gfm: true, breaks: false, renderer: hljsRenderer };

  function renderMarkdownToHtml(rawSrc) {
    var src = preprocessLatexDelimiters(rawSrc);
    var tokens = marked.lexer(src, markedOptions);
    var cursor = 0, line = 1, html = '';
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var idx = src.indexOf(token.raw, cursor);
      if (idx === -1) idx = cursor;
      line += countNewlines(src.slice(cursor, idx));
      var startLine = line;
      cursor = idx + token.raw.length;
      line += countNewlines(token.raw);
      if (token.type === 'space') continue;
      var single = [token];
      single.links = tokens.links;
      html += '<div data-line="' + startLine + '">' + marked.parser(single, markedOptions) + '</div>';
    }
    return html;
  }

  function renderMath(container) {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }

  // ── Render pipeline (debounced, error-safe) ───────────────────────────────
  var renderTimer = null;
  var pendingScroll = false;

  function showError(msg) { errorBanner.textContent = 'Render error: ' + msg; errorBanner.hidden = false; }
  function hideError() { errorBanner.hidden = true; }

  function doRender() {
    var html;
    try { html = renderMarkdownToHtml(editor.value); }
    catch (err) { showError(err.message); return; }   // keep prior preview + text
    preview.innerHTML = html;
    try { renderMath(preview); }
    catch (err) { showError(err.message); return; }
    hideError();
    saveState();
    if (typeof MDV.onRendered === 'function') MDV.onRendered();
    if (pendingScroll) { scrollPreviewToCursor(); pendingScroll = false; }
  }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(doRender, 200); }

  MDV.doRender = doRender;
  MDV.scheduleRender = scheduleRender;

  function scrollPreviewToCursor() {
    var cursorLine = MDV.cursorLine(editor.value, editor.selectionStart);
    var blocks = preview.querySelectorAll('[data-line]');
    var target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (parseInt(blocks[i].getAttribute('data-line'), 10) <= cursorLine) target = blocks[i];
      else break;
    }
    if (target) target.scrollIntoView({ block: 'nearest' });
  }

  // Dual scroll (editor + preview) to a source line. opts.focus selects in editor.
  MDV.scrollToLine = function (line, opts) {
    opts = opts || {};
    var blocks = preview.querySelectorAll('[data-line]');
    var target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (parseInt(blocks[i].getAttribute('data-line'), 10) <= line) target = blocks[i];
      else break;
    }
    if (target) target.scrollIntoView({ block: opts.previewBlock || 'start' });

    var lh = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, (line - 1) * lh - 40);
    if (opts.focus) {
      var pos = MDV.getLineStart(editor.value, line);
      editor.focus();
      editor.setSelectionRange(pos, pos);
    }
  };

  // ── Persistence ──────────────────────────────────────────────────────────
  function saveState() {
    MDV.lsSet(K.content, editor.value);
    MDV.lsSet(K.filename, filenameInput.value);
    MDV.lsSet(K.locked, filenameLocked ? '1' : '0');
  }
  MDV.saveState = saveState;

  // ── Filename auto-derive + lock ───────────────────────────────────────────
  var filenameLocked = false;

  function deriveFilename() {
    var words = editor.value.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return 'untitled.md';
    var name = words.join('-').replace(/[\/\\?%*:|"<>]/g, '').replace(/^-+|-+$/g, '');
    return (name || 'untitled') + '.md';
  }
  MDV.deriveFilename = deriveFilename;
  MDV.lockFilename = function (v) { filenameLocked = !!v; saveState(); };
  MDV.isFilenameLocked = function () { return filenameLocked; };
  MDV.maybeDeriveFilename = function () { if (!filenameLocked) filenameInput.value = deriveFilename(); };

  // ── Custom undo / redo stack ──────────────────────────────────────────────
  var undoStack = [], redoStack = [], lastState = null;

  function snap() {
    return {
      content: editor.value,
      filename: filenameInput.value,
      selStart: editor.selectionStart,
      selEnd: editor.selectionEnd
    };
  }
  MDV.snap = snap;

  function applyState(s) {
    editor.value = s.content;
    filenameInput.value = s.filename;
    try { editor.setSelectionRange(s.selStart, s.selEnd); } catch (e) {}
    pendingScroll = false;
    doRender();
  }

  // Programmatic, undoable buffer edit. opts.filename overrides; otherwise the
  // filename auto-derives (unless locked). Re-renders + saves.
  MDV.commitEdit = function (content, selStart, selEnd, opts) {
    opts = opts || {};
    undoStack.push(lastState || snap());
    redoStack.length = 0;
    editor.value = content;
    if (opts.filename !== undefined) filenameInput.value = opts.filename;
    else MDV.maybeDeriveFilename();
    if (selStart != null) {
      try { editor.setSelectionRange(selStart, selEnd == null ? selStart : selEnd); } catch (e) {}
    }
    lastState = snap();
    pendingScroll = false;
    doRender();
  };

  MDV.undo = function () {
    if (!undoStack.length) return;
    redoStack.push(lastState || snap());
    var s = undoStack.pop();
    applyState(s);
    lastState = s;
  };
  MDV.redo = function () {
    if (!redoStack.length) return;
    undoStack.push(lastState || snap());
    var s = redoStack.pop();
    applyState(s);
    lastState = s;
  };
  MDV.canUndo = function () { return undoStack.length > 0; };
  MDV.canRedo = function () { return redoStack.length > 0; };
  MDV.clearUndo = function () { undoStack.length = 0; redoStack.length = 0; lastState = snap(); };

  // Replace whole buffer from a file load (NOT undoable — clears the stack).
  MDV.loadContent = function (content, filename) {
    editor.value = content;
    if (filename !== undefined) { filenameInput.value = filename; filenameLocked = true; }
    pendingScroll = false;
    doRender();
    MDV.clearUndo();
  };

  // ── Typing: track undo + auto-derive filename + schedule render ────────────
  editor.addEventListener('input', function () {
    undoStack.push(lastState || snap());
    redoStack.length = 0;
    MDV.maybeDeriveFilename();
    lastState = snap();
    pendingScroll = true;
    scheduleRender();
  });

  // selection changes shouldn't push undo, but keep lastState selection fresh
  editor.addEventListener('keyup', function () { if (lastState) { lastState.selStart = editor.selectionStart; lastState.selEnd = editor.selectionEnd; } });
  editor.addEventListener('mouseup', function () { if (lastState) { lastState.selStart = editor.selectionStart; lastState.selEnd = editor.selectionEnd; } });

  filenameInput.addEventListener('input', function () {
    filenameLocked = true;   // user-set name suspends auto-derive
    saveState();
  });

  // ── Restore ───────────────────────────────────────────────────────────────
  MDV.restore = function () {
    var content = MDV.lsGet(K.content);
    var filename = MDV.lsGet(K.filename);
    var locked = MDV.lsGet(K.locked);
    if (content !== null) editor.value = content;
    filenameLocked = locked === '1';
    if (filename !== null) filenameInput.value = filename;
    else MDV.maybeDeriveFilename();
    lastState = snap();
  };

  // ── Resizable split divider ───────────────────────────────────────────────
  var dragging = false;
  divider.addEventListener('pointerdown', function (e) { dragging = true; divider.classList.add('dragging'); e.preventDefault(); });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var vertical = getComputedStyle(splitContainer).flexDirection === 'column';
    var rect = editorPane.getBoundingClientRect();
    var containerRect = splitContainer.getBoundingClientRect();
    var pct = vertical
      ? ((e.clientY - containerRect.top) / containerRect.height) * 100
      : ((e.clientX - containerRect.left) / containerRect.width) * 100;
    pct = clamp(pct, 12, 85);
    editorPane.style.flex = '0 0 ' + pct + '%';
    previewPane.style.flex = '1 1 auto';
  });
  window.addEventListener('pointerup', function () { dragging = false; divider.classList.remove('dragging'); });

  // ── Generic dropdown panel helper ─────────────────────────────────────────
  var openPanels = [];   // { panel, btn }
  function positionPanel(panel, btn) {
    var r = btn.getBoundingClientRect();
    panel.hidden = false; // measure
    var pw = panel.offsetWidth;
    var left = r.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = (r.bottom + 4) + 'px';
  }
  MDV.closeAllPanels = function (except) {
    openPanels = openPanels.filter(function (rec) {
      if (rec.panel === except) return true;
      rec.panel.hidden = true;
      if (rec.btn) rec.btn.setAttribute('aria-expanded', 'false');
      return false;
    });
  };
  // wires a button to toggle a panel. opts.onOpen(panel) called when opening.
  MDV.dropdown = function (btn, panel, opts) {
    opts = opts || {};
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !panel.hidden;
      MDV.closeAllPanels();
      if (isOpen) return;
      if (opts.onOpen) opts.onOpen(panel);
      positionPanel(panel, btn);
      btn.setAttribute('aria-expanded', 'true');
      openPanels.push({ panel: panel, btn: btn });
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
  };
  document.addEventListener('click', function () { MDV.closeAllPanels(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') MDV.closeAllPanels();
  });

  // ── Generic sidebar toggle + resize ───────────────────────────────────────
  MDV.toggleSidebar = function (sidebar, btn) {
    var open = sidebar.classList.toggle('open');
    if (btn) btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    return open;
  };
  MDV.makeSidebarResizable = function (sidebar) {
    var handle = sidebar.querySelector('.sidebar-handle');
    if (!handle) return;
    var dragging = false;
    handle.addEventListener('pointerdown', function (e) { dragging = true; handle.classList.add('dragging'); e.preventDefault(); });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var right = window.innerWidth;
      var w = clamp(right - e.clientX, 200, Math.min(700, window.innerWidth - 200));
      sidebar.style.flexBasis = w + 'px';
    });
    window.addEventListener('pointerup', function () { dragging = false; handle.classList.remove('dragging'); });
  };
})();
