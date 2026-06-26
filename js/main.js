/* ============================================================================
   main.js — runs last. Restores state, initialises every feature module,
   then performs the first render.
   ========================================================================== */
(function () {
  'use strict';
  var MDV = window.MDV;

  MDV.restore();          // content, filename, lock (theme/font handled in initEditing)

  MDV.initTable();
  MDV.initEditing();      // lists, outline, clear, import/export, font + theme
  MDV.initPanels();       // how-to/changelog, history, translation
  MDV.initInteractions(); // context menu, highlight, shortcuts, popover

  MDV.doRender();
})();
