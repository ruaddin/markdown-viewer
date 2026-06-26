/* ============================================================================
   table.js — grid-based GFM table editor in a <dialog>.
   Auto-detects insert vs. edit from the cursor position. Undoable via
   MDV.commitEdit. Ported from the original markdown-table-editor tool.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;
  var editor = MDV.editor;
  var clamp = MDV.clamp;

  var tableDialog        = document.getElementById('table-dialog');
  var colCountInput      = document.getElementById('col-count-input');
  var headerInputsDiv    = document.getElementById('header-inputs');
  var tableHeaderRow     = document.getElementById('table-header-row');
  var tableBody          = document.getElementById('table-body');
  var addRowBtn          = document.getElementById('add-row-btn');
  var autoNumberCheckbox = document.getElementById('auto-number-checkbox');
  var tableDoneBtn       = document.getElementById('table-done-btn');
  var tableCancelBtn     = document.getElementById('table-cancel-btn');

  var colCount = 3, headers = ['', '', ''], rows = [['', '', '']];
  var editingRange = null;   // { start, end } line indices, or null for insert
  var savedCursorPos = 0;

  function parseMarkdownTable(raw) {
    var lines = raw.trim().split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) throw new Error('Need at least a header and separator row.');
    function parseCells(line) {
      if (!line.startsWith('|') || !line.endsWith('|')) throw new Error('Each row must start and end with |');
      return line.slice(1, -1).split('|').map(function (c) { return c.trim(); });
    }
    function isSep(line) { return /^\|[\s|:-]+\|$/.test(line); }
    var sepIdx = lines.findIndex(isSep);
    if (sepIdx === -1) throw new Error('No separator row found.');
    if (sepIdx === 0) throw new Error('Header row missing before separator.');
    var parsedHeaders = parseCells(lines[0]);
    var parsedRows = lines.slice(sepIdx + 1).map(function (l) {
      var cells = parseCells(l);
      if (cells.length !== parsedHeaders.length) throw new Error('Row cell count mismatch.');
      return cells;
    });
    if (parsedRows.length === 0) throw new Error('No data rows found after separator.');
    return { headers: parsedHeaders, rows: parsedRows };
  }
  MDV.parseMarkdownTable = parseMarkdownTable;

  // Detect the table block containing a character offset. Returns null if none.
  function findTableAtCursor(text, pos) {
    var lines = text.split('\n');
    var offset = 0, cursorLine = lines.length - 1;
    for (var i = 0; i < lines.length; i++) {
      if (offset + lines[i].length >= pos) { cursorLine = i; break; }
      offset += lines[i].length + 1;
    }
    if (lines[cursorLine].trim() === '') return null;
    var start = cursorLine, end = cursorLine;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
    var blockLines = lines.slice(start, end + 1);
    if (blockLines.length < 2) return null;
    if (!blockLines.every(function (l) { return l.indexOf('|') !== -1; })) return null;
    var sepIdx = blockLines.findIndex(function (l) {
      return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l);
    });
    if (sepIdx === -1 || sepIdx === 0) return null;
    return { startLine: start, endLine: end, text: blockLines.join('\n') };
  }
  MDV.findTableAtCursor = findTableAtCursor;

  function resetTableState() { colCount = 3; headers = ['', '', '']; rows = [['', '', '']]; autoNumberCheckbox.checked = false; }

  function fullRenderTable() { renderTableHeader(); renderHeaderInputs(); renderTableBody(); }

  function renderTableHeader() {
    tableHeaderRow.innerHTML = '';
    for (var i = 0; i < colCount; i++) {
      var th = document.createElement('th');
      th.textContent = headers[i] || ('Col ' + (i + 1));
      tableHeaderRow.appendChild(th);
    }
    var spaceTh = document.createElement('th'); spaceTh.style.width = '24px';
    tableHeaderRow.appendChild(spaceTh);
  }

  function renderHeaderInputs() {
    headerInputsDiv.innerHTML = '';
    for (var i = 0; i < colCount; i++) {
      (function (idx) {
        var col = document.createElement('div'); col.className = 'header-col';
        var inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = 'Col ' + (idx + 1); inp.value = headers[idx] || '';
        inp.addEventListener('input', function (e) { headers[idx] = e.target.value; renderTableHeader(); });
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'col-delete-btn'; btn.title = 'Delete column';
        btn.textContent = '✕'; btn.disabled = colCount <= 1;
        btn.addEventListener('click', function () { deleteColumn(idx); });
        col.appendChild(inp); col.appendChild(btn);
        headerInputsDiv.appendChild(col);
      })(i);
    }
  }

  function renderTableBody() {
    tableBody.innerHTML = '';
    rows.forEach(function (rowData, ri) {
      var tr = document.createElement('tr');
      var numTd = document.createElement('td'); numTd.className = 'num-cell'; numTd.textContent = ri + 1;
      tr.appendChild(numTd);
      for (var ci = 0; ci < colCount; ci++) {
        (function (r, c) {
          var td = document.createElement('td');
          var ta = document.createElement('textarea');
          ta.rows = 1; ta.value = rowData[c] || '';
          ta.addEventListener('input', function (e) { rows[r][c] = e.target.value; });
          td.appendChild(ta); tr.appendChild(td);
        })(ri, ci);
      }
      var delTd = document.createElement('td');
      var delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'row-delete-btn'; delBtn.title = 'Delete row';
      delBtn.textContent = '✕'; delBtn.disabled = rows.length <= 1;
      delBtn.addEventListener('click', function () { deleteRow(ri); });
      delTd.appendChild(delBtn); tr.appendChild(delTd);
      tableBody.appendChild(tr);
    });
  }

  function setColCount(n) {
    n = clamp(n, 1, 12); colCount = n;
    while (headers.length < colCount) headers.push('');
    headers = headers.slice(0, colCount);
    rows = rows.map(function (row) { while (row.length < colCount) row.push(''); return row.slice(0, colCount); });
    fullRenderTable();
  }
  function deleteColumn(ci) {
    if (colCount <= 1) return;
    headers.splice(ci, 1); rows = rows.map(function (row) { row.splice(ci, 1); return row; });
    colCount--; colCountInput.value = colCount; fullRenderTable();
  }
  function deleteRow(ri) { if (rows.length <= 1) return; rows.splice(ri, 1); renderTableBody(); }
  function addRow() { rows.push(new Array(colCount).fill('')); renderTableBody(); }

  function buildTableMarkdown() {
    var useAuto = autoNumberCheckbox.checked;
    var hdrs = useAuto ? ['#'].concat(headers) : headers.slice();
    var headerLine = '| ' + hdrs.map(function (h) { return h || ' '; }).join(' | ') + ' |';
    var sepLine = '| ' + hdrs.map(function () { return '---'; }).join(' | ') + ' |';
    var dataLines = rows.map(function (row, i) {
      var cells = useAuto ? [String(i + 1)].concat(row) : row.slice();
      return '| ' + cells.map(function (c) { return c || ' '; }).join(' | ') + ' |';
    });
    return [headerLine, sepLine].concat(dataLines).join('\n');
  }

  // Open the editor. forceMode: 'edit' uses the table at cursor (or nearest),
  // 'insert' forces a blank table; anything else auto-detects.
  function openTableEditor(forceMode) {
    savedCursorPos = editor.selectionStart;
    var found = (forceMode === 'insert') ? null : findTableAtCursor(editor.value, savedCursorPos);

    if (found) {
      try {
        var parsed = parseMarkdownTable(found.text);
        var hdrs = parsed.headers, rws = parsed.rows;
        var autoNum = hdrs[0] === '#' && rws.every(function (r, i) { return r[0] === String(i + 1); });
        if (autoNum) { hdrs = hdrs.slice(1); rws = rws.map(function (r) { return r.slice(1); }); }
        colCount = clamp(hdrs.length, 1, 12);
        headers = hdrs.slice(0, colCount);
        rows = rws.map(function (r) { r = r.slice(0, colCount); while (r.length < colCount) r.push(''); return r; });
        autoNumberCheckbox.checked = autoNum;
        editingRange = { start: found.startLine, end: found.endLine };
      } catch (e) { resetTableState(); editingRange = null; }
    } else {
      resetTableState(); editingRange = null;
    }
    colCountInput.value = colCount;
    fullRenderTable();
    tableDialog.showModal();
  }
  MDV.openTableEditor = openTableEditor;

  MDV.initTable = function () {
    colCountInput.addEventListener('input', function () {
      var v = parseInt(colCountInput.value, 10);
      if (!isNaN(v)) { setColCount(v); colCountInput.value = colCount; }
    });
    addRowBtn.addEventListener('click', addRow);
    tableCancelBtn.addEventListener('click', function () { tableDialog.close(); });

    tableDoneBtn.addEventListener('click', function () {
      var md = buildTableMarkdown();
      var newValue, caret;
      if (editingRange) {
        var lines = editor.value.split('\n');
        lines.splice(editingRange.start, editingRange.end - editingRange.start + 1, md);
        newValue = lines.join('\n');
        caret = MDV.getLineStart(newValue, editingRange.start + 1);
      } else {
        var before = editor.value.slice(0, savedCursorPos);
        var after = editor.value.slice(savedCursorPos);
        var prefix = before.length === 0 ? '' : (before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n'));
        var suffix = after.length === 0 ? '' : (after.startsWith('\n\n') ? '' : (after.startsWith('\n') ? '\n' : '\n\n'));
        newValue = before + prefix + md + suffix + after;
        caret = (before + prefix + md).length;
      }
      MDV.commitEdit(newValue, caret, caret);   // undoable
      tableDialog.close();
    });
  };
})();
