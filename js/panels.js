/* ============================================================================
   panels.js — How-to/Changelogs dropdown, History sidebar, Translation sidebar.
   Translation uses Chrome's built-in Translator API (feature-detected). Other
   browsers get the required fallback popup; Bergamot is a best-effort stub.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;
  var editor = MDV.editor;

  var LANG_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
    ar: 'Arabic', hi: 'Hindi'
  };
  function langName(code) { return LANG_NAMES[code] || code || '—'; }

  // ── How-to / Changelogs ───────────────────────────────────────────────────
  var changelogLoaded = false;
  function loadChangelog() {
    if (changelogLoaded) return;
    changelogLoaded = true;
    var body = document.getElementById('changelog-body');
    fetch('changelog.md')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (md) { body.innerHTML = marked.parse(md); })
      .catch(function () { body.textContent = 'Changelog unavailable.'; changelogLoaded = false; });
  }

  // ── History ────────────────────────────────────────────────────────────────
  var HISTORY_MAX = 10;
  var historyList = document.getElementById('history-list');

  function getHistory() {
    try { return JSON.parse(MDV.lsGet(MDV.K.history) || '[]'); } catch (e) { return []; }
  }
  function setHistory(arr) { MDV.lsSet(MDV.K.history, JSON.stringify(arr)); }

  MDV.pushHistoryEntry = function (content, filename) {
    var arr = getHistory();
    arr.push({ ts: Date.now(), filename: filename, content: content });
    while (arr.length > HISTORY_MAX) arr.shift();
    setHistory(arr);
    if (document.getElementById('history-sidebar').classList.contains('open')) renderHistory();
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatTs(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function first5(content) {
    var w = content.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    return w.length ? w.join(' ') : '(empty)';
  }
  function entryName(filename, content) {
    return (filename && filename !== 'untitled.md') ? filename : first5(content);
  }

  function makeEntryEl(entry, isLive) {
    var el = document.createElement('div');
    el.className = 'history-entry' + (isLive ? ' live' : '');
    var meta = document.createElement('div'); meta.className = 'he-meta';
    meta.textContent = isLive ? 'Current document' : formatTs(entry.ts);
    var name = document.createElement('div'); name.className = 'he-name';
    name.textContent = entryName(entry.filename, entry.content);
    el.appendChild(meta); el.appendChild(name);

    if (!isLive) {
      var actions = document.createElement('div'); actions.className = 'he-actions';
      var reload = document.createElement('button'); reload.type = 'button'; reload.textContent = '↺ Reload';
      reload.addEventListener('click', function () {
        MDV.commitEdit(entry.content, 0, 0, { filename: entry.filename });
        MDV.lockFilename(true);
      });
      var del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = 'Delete';
      del.addEventListener('click', function () {
        var arr = getHistory();
        var idx = arr.findIndex(function (e) { return e.ts === entry.ts && e.content === entry.content; });
        if (idx !== -1) { arr.splice(idx, 1); setHistory(arr); renderHistory(); }
      });
      var dl = document.createElement('button'); dl.type = 'button'; dl.textContent = 'Download';
      dl.addEventListener('click', function () { MDV.download(entry.content, entry.filename); });
      actions.appendChild(reload); actions.appendChild(del); actions.appendChild(dl);
      el.appendChild(actions);
    }
    return el;
  }

  function renderHistory() {
    historyList.innerHTML = '';
    historyList.appendChild(makeEntryEl({ filename: MDV.filenameInput.value, content: editor.value }, true));
    var arr = getHistory();
    for (var i = arr.length - 1; i >= 0; i--) historyList.appendChild(makeEntryEl(arr[i], false));
  }

  // ── Translation ─────────────────────────────────────────────────────────────
  var sourceLangEl  = document.getElementById('source-lang');
  var targetSelect  = document.getElementById('target-lang');
  var translateRun  = document.getElementById('translate-run');
  var packProgress  = document.getElementById('pack-progress');
  var packBar       = packProgress.querySelector('span');
  var translateOut  = document.getElementById('translate-output');
  var translateStatus = document.getElementById('translate-status');
  var bergamotPopup = document.getElementById('bergamot-popup');

  var lastDetectedSource = null;
  var translatorCache = {};        // "src>tgt" -> translator instance (Chrome API)
  var apiUnavailableHandled = false;
  var translationMode = null;      // 'chrome' | 'bergamot' | null

  function apiAvailable() { return typeof self !== 'undefined' && 'Translator' in self; }
  function detectorAvailable() { return typeof self !== 'undefined' && 'LanguageDetector' in self; }

  // Script-based source guess for the Bergamot path (no Chrome LanguageDetector
  // there). Good for non-Latin scripts; Latin-script languages default to 'en'.
  function heuristicDetect(text) {
    if (/[一-鿿]/.test(text)) return 'zh';
    if (/[぀-ヿ]/.test(text)) return 'ja';
    if (/[가-힯]/.test(text)) return 'ko';
    if (/[Ѐ-ӿ]/.test(text)) return 'ru';
    if (/[؀-ۿ]/.test(text)) return 'ar';
    if (/[ऀ-ॿ]/.test(text)) return 'hi';
    return 'en';
  }

  function status(msg) { translateStatus.textContent = msg || ''; }
  function showProgress(pct) { packProgress.hidden = false; packBar.style.width = MDV.clamp(pct, 0, 100) + '%'; }
  function hideProgress() { packProgress.hidden = true; packBar.style.width = '0%'; }
  function packKey(t) { return MDV.K.packPrefix + t; }
  function setPack(t, v) { MDV.lsSet(packKey(t), String(v)); }
  function getPack(t) { return MDV.lsGet(packKey(t)); }

  function pctFromEvent(e) {
    var loaded = e.loaded || 0, total = e.total || 0;
    var p = total ? (loaded / total) : loaded;
    if (p <= 1) p *= 100;
    return Math.round(p);
  }

  function detectSource(text) {
    if (!detectorAvailable()) return Promise.resolve(null);
    return self.LanguageDetector.create()
      .then(function (det) { return det.detect(text.slice(0, 2000)); })
      .then(function (res) { return (res && res[0]) ? res[0].detectedLanguage : null; })
      .catch(function () { return null; });
  }

  // Ensure a translator for src>tgt, downloading the pack if needed (with progress).
  function getTranslator(src, tgt) {
    var key = src + '>' + tgt;
    if (translatorCache[key]) return Promise.resolve(translatorCache[key]);
    return self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt })
      .catch(function () { return 'unavailable'; })
      .then(function (avail) {
        if (avail === 'unavailable') { status('Translation unavailable for ' + langName(src) + ' → ' + langName(tgt) + '.'); return null; }
        var needsDownload = (avail !== 'available');
        if (needsDownload) { setPack(tgt, 'downloading'); showProgress(0); }
        return self.Translator.create({
          sourceLanguage: src,
          targetLanguage: tgt,
          monitor: function (m) {
            m.addEventListener('downloadprogress', function (e) { var p = pctFromEvent(e); showProgress(p); setPack(tgt, p); });
          }
        }).then(function (tr) {
          translatorCache[key] = tr; setPack(tgt, 'done'); hideProgress(); refreshTranslateEnabled();
          return tr;
        });
      });
  }

  function refreshTranslateEnabled() {
    if (translationMode === 'bergamot') return;   // Bergamot manages its own enabled state
    if (!apiAvailable()) { translateRun.disabled = true; return; }
    var tgt = targetSelect.value;
    // enabled if a translator is cached, or pack marked done, or pair is downloadable-on-demand
    var ready = getPack(tgt) === 'done' || Object.keys(translatorCache).some(function (k) { return k.split('>')[1] === tgt; });
    translateRun.disabled = !ready;
  }

  // Chrome built-in Translator path.
  function chromeTranslate(text) {
    status('Translating…');
    var tgt = targetSelect.value;
    return detectSource(text).then(function (src) {
      src = src || 'en';
      lastDetectedSource = src;
      sourceLangEl.textContent = langName(src);
      if (src === tgt) { translateOut.textContent = text; status('Source already in target language.'); return text; }
      return getTranslator(src, tgt).then(function (tr) {
        if (!tr) return null;
        return tr.translate(text).then(function (out) { translateOut.textContent = out; status(''); return out; });
      });
    }).catch(function (err) { status('Translation failed: ' + err.message); return null; });
  }

  // Bergamot offline path. Detects source (Chrome detector if present, else
  // script heuristic), downloads the model(s) with a progress bar, translates.
  function bergamotTranslate(text) {
    status('Translating…');
    var tgt = targetSelect.value;
    return detectSource(text).then(function (s) { return s || heuristicDetect(text); }).then(function (src) {
      lastDetectedSource = src;
      sourceLangEl.textContent = langName(src) + ' (detected)';
      if (src === tgt) { translateOut.textContent = text; status('Source already in target language.'); return text; }
      status('Downloading model…');
      return MDV.bergamot.ensureModels(src, tgt, function (p) { showProgress(p); })
        .then(function () { hideProgress(); setPack(tgt, 'done'); status('Translating…'); return MDV.bergamot.translate(src, tgt, text); })
        .then(function (out) { translateOut.textContent = out; status(''); return out; });
    }).catch(function (err) { hideProgress(); status('Bergamot failed: ' + err.message); return null; });
  }

  // Core translate. Returns Promise<string|null>. Updates sidebar output.
  function translateText(text) {
    if (!text || !text.trim()) { status('Nothing to translate.'); return Promise.resolve(null); }
    if (translationMode === 'chrome') return chromeTranslate(text);
    if (translationMode === 'bergamot') return bergamotTranslate(text);
    status('Translation is not enabled.');
    return Promise.resolve(null);
  }
  MDV.translateText = translateText;

  // Called when the sidebar (or context-menu) first needs the API; shows the
  // fallback popup once if unavailable.
  function ensureApiOrFallback() {
    if (apiAvailable()) { translationMode = 'chrome'; refreshTranslateEnabled(); status(''); return; }
    if (translationMode === 'bergamot') { return; }   // already chosen this session
    translateRun.disabled = true;
    if (apiUnavailableHandled) return;
    apiUnavailableHandled = true;
    try { bergamotPopup.showModal(); } catch (e) { status('Translation requires Chrome 138 or later.'); }
  }

  // Starts the Bergamot engine and pre-downloads the pack for the current
  // target (using English as a representative source) with a progress bar.
  function startBergamot() {
    translationMode = 'bergamot';
    translateRun.disabled = true;
    status('Loading Bergamot engine…');
    MDV.bergamot.start().then(function () {
      var tgt = targetSelect.value;
      if (tgt === 'en') return;          // need a source to pick a pack; download on first translate
      status('Downloading language pack…');
      return MDV.bergamot.ensureModels('en', tgt, function (p) { showProgress(p); })
        .then(function () { hideProgress(); setPack(tgt, 'done'); });
    }).then(function () {
      translateRun.disabled = false;
      status('Bergamot ready.');
    }).catch(function (err) { hideProgress(); status('Could not load Bergamot: ' + err.message); });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  MDV.initPanels = function () {
    // How-to / Changelogs
    MDV.dropdown(document.getElementById('howto-btn'), document.getElementById('howto-panel'), { onOpen: loadChangelog });

    // Sidebars are mutually exclusive — only one open at a time.
    var historySidebar = document.getElementById('history-sidebar');
    var translationSidebar = document.getElementById('translation-sidebar');
    var historyToggleBtn = document.getElementById('history-toggle');
    var translateToggleBtn = document.getElementById('translate-toggle');
    function closeSidebar(sb, btn) { sb.classList.remove('open'); if (btn) btn.setAttribute('aria-pressed', 'false'); }

    MDV.makeSidebarResizable(historySidebar);
    MDV.makeSidebarResizable(translationSidebar);

    historyToggleBtn.addEventListener('click', function () {
      var open = MDV.toggleSidebar(historySidebar, this);
      if (open) { closeSidebar(translationSidebar, translateToggleBtn); renderHistory(); }
    });
    document.getElementById('clear-history-btn').addEventListener('click', function () { setHistory([]); renderHistory(); });

    translateToggleBtn.addEventListener('click', function () {
      var open = MDV.toggleSidebar(translationSidebar, this);
      if (open) { closeSidebar(historySidebar, historyToggleBtn); ensureApiOrFallback(); }
    });
    targetSelect.addEventListener('change', function () {
      if (translationMode === 'bergamot') {
        var t = targetSelect.value;
        if (t !== 'en' && getPack(t) !== 'done') {
          status('Downloading language pack…');
          MDV.bergamot.ensureModels('en', t, function (p) { showProgress(p); })
            .then(function () { hideProgress(); setPack(t, 'done'); status('Bergamot ready.'); })
            .catch(function (err) { hideProgress(); status('Pack download failed: ' + err.message); });
        }
        return;
      }
      refreshTranslateEnabled();
      if (apiAvailable() && getPack(targetSelect.value) !== 'done') {
        getTranslator(lastDetectedSource || 'en', targetSelect.value);  // silent pre-fetch
      }
    });
    translateRun.addEventListener('click', function () {
      var sel = editor.selectionStart !== editor.selectionEnd
        ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : editor.value;
      translateText(sel);
    });

    // Bergamot fallback popup actions
    document.getElementById('bergamot-dismiss').addEventListener('click', function () {
      bergamotPopup.close();
      translateRun.disabled = true;
      status('Translation unavailable: requires Chrome 138 or later.');
    });
    document.getElementById('bergamot-use').addEventListener('click', function () {
      bergamotPopup.close();
      startBergamot();
    });

    refreshTranslateEnabled();
  };
})();
