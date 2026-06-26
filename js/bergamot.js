/* ============================================================================
   bergamot.js — real offline translation via the vendored browsermt
   bergamot-translator WASM engine (v0.4.9, in vendor/bergamot/).

   Notes
   - The engine + models are fetched over the network, so this path needs the
     page to be SERVED (GitHub Pages or a local http server). It will not work
     from file:// (dynamic import + worker + fetch are blocked there). The rest
     of the tool still works on file://.
   - The worker script must be same-origin, which is why the engine is vendored
     locally rather than loaded from a CDN.
   - bergamot-translator has no built-in download-progress hook, so we monkey-
     patch TranslatorBacking.prototype.fetch to stream the model files and count
     bytes for a real progress bar.
   - Non-English <-> non-English translations pivot through English (2 hops),
     handled automatically by the engine's registry/pivot logic.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;

  var modPromise = null, translator = null;
  var loaded = 0, total = 0, onProg = null;

  function emit() { if (onProg) onProg(total ? Math.min(100, Math.round(loaded / total * 100)) : 0); }
  function reset() { loaded = 0; total = 0; if (onProg) onProg(0); }
  function addTotal(n) { total += n; emit(); }
  function addLoaded(n) { loaded += n; emit(); }

  // Streaming replacement for TranslatorBacking.prototype.fetch (same contract,
  // but reports bytes). `this` is the backing instance.
  function patchedFetch(url, checksum, extra) {
    var backing = this;
    var controller = new AbortController();
    var timer = backing.downloadTimeout ? setTimeout(function () { controller.abort(); }, backing.downloadTimeout) : null;
    var onAbort = function () { controller.abort(); };
    if (extra && extra.signal) extra.signal.addEventListener('abort', onAbort);

    var options = { credentials: 'omit', signal: controller.signal };
    if (checksum) options.integrity = 'sha256-' + backing.hexToBase64(checksum);

    return fetch(url, options).then(function (response) {
      var len = +(response.headers.get('content-length') || 0);
      if (len) addTotal(len);
      if (!response.body || !response.body.getReader) {
        return response.arrayBuffer().then(function (b) { addLoaded(b.byteLength); return b; });
      }
      var reader = response.body.getReader(), chunks = [], received = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(received), pos = 0;
            chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
            return out.buffer;
          }
          chunks.push(r.value); received += r.value.length; addLoaded(r.value.length);
          return pump();
        });
      })();
    }).finally(function () {
      if (timer) clearTimeout(timer);
      if (extra && extra.signal) extra.signal.removeEventListener('abort', onAbort);
    });
  }

  MDV.bergamot = {
    // Loads the engine (idempotent). Returns Promise<translator>.
    start: function () {
      if (modPromise) return modPromise;
      var url = new URL('vendor/bergamot/translator.js', document.baseURI).href;
      modPromise = import(url).then(function (m) {
        m.TranslatorBacking.prototype.fetch = patchedFetch;   // progress hook
        translator = new m.BatchTranslator({ cacheSize: 0, downloadTimeout: 0, pivotLanguage: 'en' });
        return translator;
      });
      return modPromise;
    },

    // Downloads (or reuses) the model(s) for from->to, reporting progress 0..100.
    ensureModels: function (from, to, progressCb) {
      onProg = progressCb || null; reset();
      return MDV.bergamot.start()
        .then(function (tr) { return tr.backing.getModels({ from: from, to: to }); })
        .then(function (models) { return Promise.all(models.map(function (mm) { return translator.backing.getTranslationModel(mm); })); });
    },

    translate: function (from, to, text) {
      return MDV.bergamot.start()
        .then(function (tr) { return tr.translate({ from: from, to: to, text: text, html: false }); })
        .then(function (res) { return res && res.target ? res.target.text : ''; });
    },

    isStarted: function () { return !!translator; }
  };
})();
