/* ============================================================================
   interactions.js — extensible right-click context menu, bidirectional
   selection highlight (editor <-> preview), undo/redo keyboard shortcuts,
   and the translate popover.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;
  var editor = MDV.editor;
  var preview = MDV.preview;

  var menu = document.getElementById('context-menu');
  var popover = document.getElementById('translate-popover');
  var popClose = popover.querySelector('.pop-close');
  var popBody = popover.querySelector('.pop-body');

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function normalize(s) { return s.replace(/\s+/g, ' ').trim(); }
  function looseRegex(text) {
    var parts = normalize(text).split(' ').filter(Boolean).map(escapeRegex);
    return new RegExp(parts.join('\\s+'), 'i');
  }

  function clampToViewport(el, x, y) {
    el.hidden = false;
    var w = el.offsetWidth, h = el.offsetHeight;
    if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - w - 8);
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // ── Context menu ────────────────────────────────────────────────────────────
  function closeMenu() { menu.hidden = true; menu.innerHTML = ''; }
  function buildMenu(items, x, y) {
    menu.innerHTML = '';
    items.forEach(function (it) {
      if (it.sep) { var s = document.createElement('div'); s.className = 'cm-sep'; menu.appendChild(s); return; }
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = it.label; b.disabled = !!it.disabled;
      if (!it.disabled) b.addEventListener('click', function () { closeMenu(); it.onClick(); });
      menu.appendChild(b);
    });
    clampToViewport(menu, x, y);
  }

  function tableOffsetCaret(found) { return MDV.getLineStart(editor.value, found.startLine + 1); }

  editor.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var hasSel = editor.selectionStart !== editor.selectionEnd;
    var selText = hasSel ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : '';
    var tStart = MDV.findTableAtCursor(editor.value, editor.selectionStart);
    var tEnd = hasSel ? MDV.findTableAtCursor(editor.value, editor.selectionEnd) : tStart;
    var spansMixed = hasSel && (!!tStart !== !!tEnd);
    var overlaps = tStart || tEnd;

    var items = [];
    items.push({ label: 'Undo', disabled: !MDV.canUndo(), onClick: MDV.undo });
    items.push({ label: 'Redo', disabled: !MDV.canRedo(), onClick: MDV.redo });
    items.push({ sep: true });
    items.push({ label: 'Translate', onClick: function () {
      var text = hasSel ? selText : editor.value;
      showTranslatePopover(text, e.clientX, e.clientY);
    }});
    if (hasSel) {
      items.push({ sep: true });
      items.push({ label: 'Bullet', onClick: function () { MDV.applyList('bullet'); } });
      items.push({ label: 'Number', onClick: function () { MDV.applyList('number'); } });
    }
    items.push({ sep: true });
    if (spansMixed) {
      var tbl = tStart || tEnd;
      items.push({ label: 'Edit Table', onClick: function () {
        if (!tStart && tEnd) editor.setSelectionRange(tableOffsetCaret(tEnd), tableOffsetCaret(tEnd));
        MDV.openTableEditor('edit');
      }});
      items.push({ label: 'Insert Table', onClick: function () { MDV.openTableEditor('insert'); } });
    } else if (overlaps) {
      items.push({ label: 'Edit Table', onClick: function () {
        if (!tStart && tEnd) editor.setSelectionRange(tableOffsetCaret(tEnd), tableOffsetCaret(tEnd));
        MDV.openTableEditor('edit');
      }});
    } else {
      items.push({ label: 'Insert Table', onClick: function () { MDV.openTableEditor('insert'); } });
    }
    if (hasSel) {
      items.push({ sep: true });
      items.push({ label: 'Highlight in Preview', onClick: function () { highlightFromEditor(selText); } });
    }
    buildMenu(items, e.clientX, e.clientY);
  });

  // Preview right-click: only "Remove Highlight" on an active highlight.
  preview.addEventListener('contextmenu', function (e) {
    var hl = e.target.closest && e.target.closest('.mdv-highlight');
    if (!hl) return;             // let the browser's default menu show
    e.preventDefault();
    buildMenu([{ label: 'Remove Highlight', onClick: function () { removeHighlight(hl); } }], e.clientX, e.clientY);
  });

  document.addEventListener('click', function (e) { if (!menu.contains(e.target)) closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  // ── Keyboard undo / redo (custom stack) ──────────────────────────────────
  editor.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); MDV.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); MDV.redo(); }
  });

  // ── Editor -> Preview highlight ───────────────────────────────────────────
  function stripDelims(s) {
    return s.replace(/`{1,3}/g, '')
            .replace(/[#*_~>\[\]]/g, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/\s+/g, ' ').trim();
  }
  function hasDelims(s) {
    return /[#*_`~>\[\]]/.test(s) || /^\s*[-*+]\s/m.test(s) || /^\s*\d+\.\s/m.test(s);
  }
  function findBlockContaining(norm) {
    var blocks = preview.querySelectorAll('[data-line]');
    for (var i = 0; i < blocks.length; i++) {
      if (normalize(blocks[i].textContent).indexOf(norm) !== -1) return blocks[i];
    }
    return null;
  }
  function blockAtCursorLine() {
    var line = MDV.cursorLine(editor.value, editor.selectionStart);
    var blocks = preview.querySelectorAll('[data-line]'), target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (parseInt(blocks[i].getAttribute('data-line'), 10) <= line) target = blocks[i]; else break;
    }
    return target;
  }
  function markBlock(block) {
    if (!block) return;
    block.classList.add('mdv-highlight');
    block.scrollIntoView({ block: 'center' });
  }
  function markPhrase(block, phrase) {
    var re = looseRegex(phrase);
    var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var m = re.exec(node.nodeValue);
      if (!m) continue;
      var range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      var span = document.createElement('span'); span.className = 'mdv-highlight';
      try { range.surroundContents(span); } catch (err) { return false; }
      span.scrollIntoView({ block: 'center' });
      return true;
    }
    return false;
  }
  function highlightFromEditor(selText) {
    var stripped = stripDelims(selText);
    var norm = normalize(stripped);
    if (!norm) { markBlock(blockAtCursorLine()); return; }
    var block = findBlockContaining(norm);
    if (!block) { markBlock(blockAtCursorLine()); return; }      // fallback
    var blockText = normalize(block.textContent);
    if (hasDelims(selText) || blockText === norm) { markBlock(block); }
    else if (!markPhrase(block, stripped)) { markBlock(block); }
  }

  function removeHighlight(el) {
    if (el.hasAttribute('data-line')) { el.classList.remove('mdv-highlight'); return; }
    var p = el.parentNode;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
    p.normalize();
  }

  // ── Preview -> Editor (selection scroll-sync + highlight) ─────────────────
  function handlePreviewSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (!preview.contains(sel.anchorNode)) return;
    var text = sel.toString();
    if (!text.trim()) return;

    var node = sel.anchorNode;
    var block = node.nodeType === 1
      ? node.closest('[data-line]')
      : (node.parentElement && node.parentElement.closest('[data-line]'));
    if (!block) return;
    var line = parseInt(block.getAttribute('data-line'), 10);

    // highlight the rendered selection in place (best effort)
    try {
      var r = sel.getRangeAt(0).cloneRange();
      var span = document.createElement('span'); span.className = 'mdv-highlight';
      r.surroundContents(span);
    } catch (err) { /* selection spanned elements — skip in-place mark */ }

    // select the corresponding raw text in the editor + scroll both
    selectInEditor(text, line);
    MDV.scrollToLine(line, { previewBlock: 'nearest' });
  }
  function selectInEditor(text, line) {
    var re = looseRegex(text);
    var from = MDV.getLineStart(editor.value, Math.max(1, line - 1));
    var m = re.exec(editor.value.slice(from));
    var idx, len;
    if (m) { idx = from + m.index; len = m[0].length; }
    else { idx = editor.value.indexOf(text); len = text.length; }
    if (idx >= 0) { editor.focus(); editor.setSelectionRange(idx, idx + len); }
  }
  preview.addEventListener('mouseup', function () { setTimeout(handlePreviewSelection, 0); });

  // ── Translate popover ──────────────────────────────────────────────────────
  function showTranslatePopover(text, x, y) {
    popBody.textContent = 'Translating…';
    clampToViewport(popover, x, y);
    if (typeof MDV.translateText === 'function') {
      MDV.translateText(text).then(function (out) { popBody.textContent = out || '(no translation)'; });
    } else { popBody.textContent = 'Translation unavailable.'; }
  }
  popClose.addEventListener('click', function () { popover.hidden = true; });
  document.addEventListener('click', function (e) {
    if (!popover.hidden && !popover.contains(e.target)) popover.hidden = true;
  });

  MDV.initInteractions = function () { /* listeners already bound above */ };
})();
