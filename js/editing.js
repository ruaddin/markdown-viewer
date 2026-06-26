/* ============================================================================
   editing.js — toolbar editing features that mutate the buffer or chrome:
   bullet/number lists, document outline, Clear, import/export, font + theme.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;
  var editor = MDV.editor;
  var filenameInput = MDV.filenameInput;

  // ── Bullet / Number lists ─────────────────────────────────────────────────
  var LIST_RE = /^(\s*)(?:[-*+]\s+|\d+\.\s+)/;

  function stripList(line) {
    var m = line.match(LIST_RE);
    return m ? m[1] + line.slice(m[0].length) : line;
  }
  function indentOf(line) { return (line.match(/^(\s*)/) || ['', ''])[1]; }

  function expandToLines(text, a, b) {
    var start = a, end = b;
    while (start > 0 && text[start - 1] !== '\n') start--;
    while (end < text.length && text[end] !== '\n') end++;
    return { start: start, end: end };
  }

  // type: 'bullet' | 'number'
  function applyList(type) {
    var range = expandToLines(editor.value, editor.selectionStart, editor.selectionEnd);
    var block = editor.value.slice(range.start, range.end);
    var lines = block.split('\n');
    var nonEmpty = lines.filter(function (l) { return l.trim() !== ''; });
    if (!nonEmpty.length) return;

    var bulletRe = /^(\s*)[-*+]\s+/, numberRe = /^(\s*)\d+\.\s+/;
    var allBulleted = nonEmpty.every(function (l) { return bulletRe.test(l); });
    var allNumbered = nonEmpty.every(function (l) { return numberRe.test(l); });

    var out;
    if (type === 'bullet') {
      if (allBulleted) {
        out = lines.map(function (l) { return l.trim() === '' ? l : stripList(l); });
      } else {
        out = lines.map(function (l) {
          if (l.trim() === '') return l;
          var s = stripList(l), ind = indentOf(s);
          return ind + '- ' + s.slice(ind.length);
        });
      }
    } else {
      if (allNumbered) {
        out = lines.map(function (l) { return l.trim() === '' ? l : stripList(l); });
      } else {
        var n = 0;
        out = lines.map(function (l) {
          if (l.trim() === '') return l;
          n++;
          var s = stripList(l), ind = indentOf(s);
          return ind + n + '. ' + s.slice(ind.length);
        });
      }
    }

    var newBlock = out.join('\n');
    var newValue = editor.value.slice(0, range.start) + newBlock + editor.value.slice(range.end);
    MDV.commitEdit(newValue, range.start, range.start + newBlock.length);
  }
  MDV.applyList = applyList;

  // ── Document outline ──────────────────────────────────────────────────────
  function parseHeadings(text) {
    var lines = text.split('\n');
    var inFence = false, fenceChar = '', fenceLen = 0, out = [];
    for (var i = 0; i < lines.length; i++) {
      var fm = lines[i].match(/^\s*(`{3,}|~{3,})/);
      if (fm) {
        var mk = fm[1];
        if (!inFence) { inFence = true; fenceChar = mk[0]; fenceLen = mk.length; }
        else if (mk[0] === fenceChar && mk.length >= fenceLen) { inFence = false; }
        continue;
      }
      if (inFence) continue;
      var m = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
    }
    return out;
  }

  function renderOutline() {
    var list = document.getElementById('outline-list');
    var headings = parseHeadings(editor.value);
    list.innerHTML = '';
    if (!headings.length) {
      var empty = document.createElement('div');
      empty.className = 'translate-note';
      empty.textContent = 'No headings found.';
      list.appendChild(empty);
      return;
    }
    headings.forEach(function (h) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'panel-item';
      btn.style.paddingLeft = (9 + (h.level - 1) * 14) + 'px';
      btn.textContent = h.text || '(untitled heading)';
      btn.addEventListener('click', function () {
        MDV.scrollToLine(h.line, { focus: true, previewBlock: 'start' });
        MDV.closeAllPanels();
      });
      list.appendChild(btn);
    });
  }

  // ── File loading (shared by import button + drop zones) ───────────────────
  function loadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { MDV.loadContent(reader.result, file.name); };
    reader.readAsText(file);
  }
  MDV.loadFile = loadFile;

  // ── Copy / Download ───────────────────────────────────────────────────────
  function flashCopied(btn) {
    var original = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('btn-copied');
    setTimeout(function () { btn.textContent = original; btn.classList.remove('btn-copied'); }, 1500);
  }

  function download(content, filename) {
    var blob = new Blob([content], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = (filename || 'untitled.md').trim() || 'untitled.md';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  MDV.download = download;

  // ── Font size + theme ─────────────────────────────────────────────────────
  var PRESETS = [10, 12, 14, 16, 18, 20, 24, 48, 60];
  var fontInput = document.getElementById('font-size-input');
  var presetGrid = document.getElementById('preset-grid');
  var themeCheckbox = document.getElementById('theme-checkbox');

  function applyFontSize(px, persist) {
    px = MDV.clamp(parseInt(px, 10) || 14, 5, 60);
    editor.style.fontSize = px + 'px';
    fontInput.value = px;
    updatePresetHighlight(px);
    if (persist !== false) MDV.lsSet(MDV.K.fontSize, String(px));
  }
  function updatePresetHighlight(px) {
    var items = presetGrid.querySelectorAll('.panel-item');
    items.forEach(function (it) { it.classList.toggle('active', parseInt(it.dataset.size, 10) === px); });
  }
  function buildPresets() {
    presetGrid.innerHTML = '';
    PRESETS.forEach(function (size) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'panel-item'; b.dataset.size = size; b.textContent = size;
      b.addEventListener('click', function () { applyFontSize(size); });
      presetGrid.appendChild(b);
    });
  }

  function setTheme(dark, persist) {
    var light = document.getElementById('hljs-light');
    var darkSheet = document.getElementById('hljs-dark');
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    if (light) light.disabled = !!dark;
    if (darkSheet) darkSheet.disabled = !dark;
    themeCheckbox.checked = !!dark;
    if (persist !== false) MDV.lsSet(MDV.K.theme, dark ? 'dark' : 'light');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  MDV.initEditing = function () {
    // Lists: toolbar dropdown
    var listBtn = document.getElementById('list-btn');
    var listPanel = document.getElementById('list-panel');
    MDV.dropdown(listBtn, listPanel);
    document.getElementById('bullet-item').addEventListener('click', function () { applyList('bullet'); MDV.closeAllPanels(); });
    document.getElementById('number-item').addEventListener('click', function () { applyList('number'); MDV.closeAllPanels(); });

    // Outline: parse on open
    var outlineBtn = document.getElementById('outline-btn');
    var outlinePanel = document.getElementById('outline-panel');
    MDV.dropdown(outlineBtn, outlinePanel, { onOpen: renderOutline });

    // Table: opens directly
    document.getElementById('table-btn').addEventListener('click', function () { MDV.openTableEditor('auto'); });

    // Clear
    document.getElementById('clear-btn').addEventListener('click', function () {
      if (editor.value.trim() !== '' && MDV.pushHistoryEntry) {
        MDV.pushHistoryEntry(editor.value, filenameInput.value);
      }
      MDV.commitEdit('', 0, 0, { filename: 'untitled.md' });
      MDV.lockFilename(false);
    });

    // Import / Export panel
    var ioBtn = document.getElementById('io-btn');
    var ioPanel = document.getElementById('io-panel');
    MDV.dropdown(ioBtn, ioPanel);

    var fileInput = document.getElementById('file-input');
    document.getElementById('import-btn').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; MDV.closeAllPanels(); });

    var ioDrop = document.getElementById('io-drop');
    ioDrop.addEventListener('dragover', function (e) { e.preventDefault(); ioDrop.classList.add('drag-over'); });
    ioDrop.addEventListener('dragleave', function () { ioDrop.classList.remove('drag-over'); });
    ioDrop.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); ioDrop.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
      MDV.closeAllPanels();
    });

    var copyBtn = document.getElementById('copy-btn');
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(editor.value).then(function () { flashCopied(copyBtn); })
        .catch(function (err) { copyBtn.textContent = 'Copy failed'; setTimeout(function () { copyBtn.innerHTML = '&#128203;&nbsp; Copy Markdown'; }, 1500); });
    });
    document.getElementById('download-btn').addEventListener('click', function () { download(editor.value, filenameInput.value); });

    // Full-page drag-and-drop (convenience; coexists with the panel drop zone)
    document.body.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.body.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    // Font + theme panel
    var fontBtn = document.getElementById('font-btn');
    var fontPanel = document.getElementById('font-panel');
    MDV.dropdown(fontBtn, fontPanel);
    buildPresets();
    document.getElementById('font-minus').addEventListener('click', function () { applyFontSize((parseInt(fontInput.value, 10) || 14) - 1); });
    document.getElementById('font-plus').addEventListener('click', function () { applyFontSize((parseInt(fontInput.value, 10) || 14) + 1); });
    fontInput.addEventListener('input', function () { var v = parseInt(fontInput.value, 10); if (!isNaN(v)) applyFontSize(v); });
    fontInput.addEventListener('blur', function () { applyFontSize(fontInput.value); });
    themeCheckbox.addEventListener('change', function () { setTheme(themeCheckbox.checked); });

    // Restore persisted font + theme
    var savedSize = MDV.lsGet(MDV.K.fontSize);
    applyFontSize(savedSize != null ? savedSize : 14, false);
    setTheme(MDV.lsGet(MDV.K.theme) === 'dark', false);
  };
})();
