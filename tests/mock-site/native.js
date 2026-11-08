/*
 * Offline-only helpers that the captured site scripts do not define.
 * The page's popUp, search, gallery, and reader functions come from the real
 * inline globals and /z/0381/ snapshot scripts served by site.mjs.
 */
(function () {
  'use strict';
  window.__nativeCalls = window.__nativeCalls || [];

  // The captured ehg_gallery.c.js has no show_cvotes/hide_cvotes globals, but
  // this fixture's legacy comment hover markup calls them. Keep these two tiny
  // handlers so that markup remains operable; all captured gallery globals
  // are supplied by the real script instead.
  window.show_cvotes = function (id) {
    var node = document.getElementById('cvotes_' + id);
    if (node) node.style.display = '';
  };
  window.hide_cvotes = function (id) {
    var node = document.getElementById('cvotes_' + id);
    if (node) node.style.display = 'none';
  };

  // Hypothetical residue injection is opt-in and intentionally separate from
  // captured E-Hentai behavior. These handlers are 非真站行为.
  window.__ehtwInstallHypotheticalReaderPopstate = function () {
    if (!window.__ehtwHypotheticalResidueEnabled || !/^\/s\//.test(location.pathname)) return;
    // 非真站行为：run after the captured reader's 50ms replaceState and
    // bridge instrumentation, retaining the prior synchronous stale handler.
    window.setTimeout(function () {
      window.history.replaceState({ page: 1 }, '', window.location.href);
      var hypotheticalStaleReaderPopstate = function (event) {
        if (!event.state || !event.state.page) document.location = document.location;
      };
      window.onpopstate = hypotheticalStaleReaderPopstate;
      window.addEventListener('popstate', hypotheticalStaleReaderPopstate);
      window.__nativeCalls.push({ name: 'hypothetical_reader_popstate_registered', detail: null });
    }, 100);
  };
  window.__ehtwInstallHypotheticalResidue = function () {
    if (!window.__ehtwHypotheticalResidueEnabled) return;
    var path = location.pathname;
    var calls = window.__nativeCalls;
    function record(name, detail) { calls.push({ name: name, detail: detail === undefined ? null : detail }); }
    if (/^\/s\//.test(path)) {
      // The captured ehg_show.c.js supplies real keyboard navigation. Only
      // this periodic updater remains a 非真站行为 hypothesis.
      window.setInterval(function () {
        record('hypothetical_reader_interval');
        var node = document.getElementById('i1');
        if (node) node.setAttribute('data-hypothetical-tick', String(Number(node.getAttribute('data-hypothetical-tick') || 0) + 1));
      }, 500);
      return;
    }
    if (/^\/g\//.test(path)) {
      var detailLayout = function (event) {
        record('hypothetical_detail_' + event.type);
        var node = document.getElementById('gd1');
        if (node) node.setAttribute('data-hypothetical-layout', event.type);
      };
      window.addEventListener('resize', detailLayout);
      document.addEventListener('scroll', detailLayout);
      window.setInterval(function () { record('hypothetical_detail_interval'); }, 500);
      return;
    }
    if (path === '/' || path === '/popular' || path === '/watched' || /^\/(?:tag|uploader)\//.test(path)) {
      window.addEventListener('hashchange', function () {
        record('hypothetical_list_hashchange', location.hash);
        document.body.setAttribute('data-hypothetical-hash', location.hash);
      });
      window.setInterval(function () { record('hypothetical_list_interval'); }, 500);
      return;
    }
    if (/^\/favorites\.php$/.test(path)) {
      window.setInterval(function () { record('hypothetical_favorites_interval'); }, 500);
      return;
    }
    var periodicPages = [
      [/^\/torrents\.php$/, 'torrents'], [/^\/toplist\.php$/, 'toplist'],
      [/^\/(?:home|uconfig|stats|hentaiathome|bitcoin|hathperks|exchange|logs)\.php$|^\/mytags\/?$/, 'account']
    ];
    var page = periodicPages.find(function (item) { return item[0].test(path); });
    if (page) window.setInterval(function () { record('hypothetical_' + page[1] + '_interval'); }, 500);
  };
  window.__ehtwInstallHypotheticalResidue();
})();
