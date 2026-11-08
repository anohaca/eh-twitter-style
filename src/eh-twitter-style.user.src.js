// ==UserScript==
// @name         EH Twitter Style
// @namespace    https://e-hentai.org/
// @version      1.17.276
// @description  将 E-Hentai 列表页和画廊详情页改造成 Twitter/X 风格，并为阅读页加入黑底连续预载和移动端适配
// @match        https://e-hentai.org/*
// @match        https://exhentai.org/*
// @match        https://upld.e-hentai.org/manage*
// @match        https://upld.e-hentai.org/bounty_post.php*
// @match        https://upld.exhentai.org/upld/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const injectionGuardKey = '__EHTW_USER_SCRIPT_INJECTION_ONCE__';
    if (window[injectionGuardKey]) return;
    window[injectionGuardKey] = true;
    let spaRenderedHref = location.href;
    // 1.17.255: declared up front. On ExHentai an early scroll save reaches
    // findSuspendedSpaPageByHref before the SPA section below has run (TDZ).
    const suspendedSpaPages = new Map();

    const NAV_LOG_SWITCH_KEY = 'ehtw-navigation-log-enabled-v1';
    const NAV_LOG_SESSION_KEY = 'ehtw-navigation-log-session-v1';
    const SPA_SUSPEND_CACHE_SWITCH_KEY = 'ehtw-spa-suspend-cache-enabled-v1';
    const NAV_LOG_HEARTBEAT_KEY = 'ehtw-navigation-log-heartbeat-v1';
    const NAV_LOG_CLEAN_EXIT_KEY = 'ehtw-navigation-log-clean-exit-v1';
    const NAV_LOG_LIMIT = 500;
    const navLogApplicable = ['e-hentai.org', 'exhentai.org'].includes(String(location.hostname || '').toLowerCase());
    const navLogCommand = String(location.hash || '').slice(1).toLowerCase();
    const navLogPanelRequested = navLogCommand === 'ehtw-navlog';
    let spaSuspendCacheEnabled = true;
    let navLogEnabled = false;
    try {
        if (navLogCommand === 'ehtw-navlog-on') {
            navLogEnabled = true;
            window.localStorage?.setItem(NAV_LOG_SWITCH_KEY, '1');
        } else if (navLogCommand === 'ehtw-navlog-off') {
            window.localStorage?.setItem(NAV_LOG_SWITCH_KEY, '0');
        } else {
            navLogEnabled = window.localStorage?.getItem(NAV_LOG_SWITCH_KEY) === '1';
        }
    } catch (_) {}
    try {
        if (navLogCommand === 'ehtw-nocache-on') {
            window.localStorage?.setItem(SPA_SUSPEND_CACHE_SWITCH_KEY, '0');
            spaSuspendCacheEnabled = false;
        } else if (navLogCommand === 'ehtw-nocache-off') {
            window.localStorage?.setItem(SPA_SUSPEND_CACHE_SWITCH_KEY, '1');
            spaSuspendCacheEnabled = true;
        } else {
            spaSuspendCacheEnabled = window.localStorage?.getItem(SPA_SUSPEND_CACHE_SWITCH_KEY) !== '0';
        }
    } catch (_) {}
    let navLogEntries = [];
    let navLogTextarea = null;
    let navLogTitle = null;
    if (navLogEnabled || navLogPanelRequested) {
        try {
            const saved = JSON.parse(window.sessionStorage?.getItem(NAV_LOG_SESSION_KEY) || '[]');
            if (Array.isArray(saved)) navLogEntries = saved.slice(-NAV_LOG_LIMIT);
        } catch (_) {}
    }
    const summarizeNavLogState = (state) => {
        if (!state || typeof state !== 'object') return null;
        const keys = [
            'ehtwSpa', 'ehtwSpaRoute', 'ehtwEntryId', 'ehtwSpaDepth',
            'ehtwScrollY', 'ehtwSpaPreviousHref', 'ehtwSpaReturnBackTarget'
        ];
        return Object.fromEntries(keys.filter((key) => key in state).map((key) => [key, state[key]]));
    };
    const navLogText = () => navLogEntries.map((entry) => JSON.stringify(entry)).join('\n');
    const navLog = (event, details = {}, coordinatesOnly = false) => {
        if (!navLogEnabled) return;
        try {
            const entry = coordinatesOnly
                ? { timestamp: new Date().toISOString(), timeMs: Date.now(), event, ...details }
                : {
                    timestamp: new Date().toISOString(),
                    timeMs: Date.now(),
                    elapsedMs: Math.round(window.performance?.now?.() || 0),
                    event,
                    href: location.href,
                    spaRenderedHref: typeof spaRenderedHref === 'string' ? spaRenderedHref : null,
                    historyLength: window.history.length,
                    ...details
                };
            navLogEntries.push(entry);
            if (navLogEntries.length > NAV_LOG_LIMIT) navLogEntries.splice(0, navLogEntries.length - NAV_LOG_LIMIT);
            window.sessionStorage?.setItem(NAV_LOG_SESSION_KEY, JSON.stringify(navLogEntries));
            if (navLogTextarea) navLogTextarea.value = navLogText();
            if (navLogTitle) navLogTitle.textContent = `导航诊断日志（${navLogEntries.length}/${NAV_LOG_LIMIT}）`;
        } catch (_) {}
    };
    if (navLogEnabled) {
        try {
            const previousHeartbeat = JSON.parse(window.sessionStorage?.getItem(NAV_LOG_HEARTBEAT_KEY) || 'null');
            const cleanExit = window.sessionStorage?.getItem(NAV_LOG_CLEAN_EXIT_KEY) === '1';
            window.sessionStorage?.removeItem(NAV_LOG_CLEAN_EXIT_KEY);
            if (previousHeartbeat && !cleanExit) {
                navLog('previous-document-no-clean-exit', {
                    previousHeartbeat,
                    intervalMs: Math.max(0, Date.now() - Number(previousHeartbeat.t || Date.now()))
                });
            }
        } catch (_) {}
    }
    const navLogStack = () => {
        try { return String(new Error().stack || '').slice(0, 800); } catch (_) { return ''; }
    };
    const MAIN_WORLD_REPORT_EVENT = '__ehtw_mainworld_report_v1';
    const MAIN_WORLD_MESSAGE_KEY = '__ehtw_mainworld_message_v1';
    const MAIN_WORLD_CONTROL_EVENT = '__ehtw_mainworld_control_v1';
    const MAIN_WORLD_NATIVE_API = '__EHTW_PAGE_WORLD_NATIVE_API_V1__';
    const addUserScriptListener = (target, type, listener, options) => {
        const nativeApi = window[MAIN_WORLD_NATIVE_API];
        if (nativeApi && (target === window || target === document)) return nativeApi.add(target, type, listener, options);
        return target?.addEventListener?.(type, listener, options);
    };
    const setUserScriptInterval = (...args) => {
        const nativeApi = window[MAIN_WORLD_NATIVE_API];
        return nativeApi ? nativeApi.setInterval(...args) : window.setInterval?.(...args);
    };
    const mainWorldScriptId = '__ehtw_mainworld_bridge_v1';
    let mainWorldInjectionAttempted = false;
    let mainWorldBridgeReady = false;
    const mainWorldPendingReports = [];
    const mainWorldSeenReportIds = new Set();
    const forwardMainWorldReport = (detail) => {
        if (!navLogEnabled || !detail || typeof detail !== 'object') return;
        if (detail.reportId != null) {
            if (mainWorldSeenReportIds.has(detail.reportId)) return;
            mainWorldSeenReportIds.add(detail.reportId);
            if (mainWorldSeenReportIds.size > 256) mainWorldSeenReportIds.delete(mainWorldSeenReportIds.values().next().value);
        }
        const { event: sourceEvent, ...report } = detail;
        navLog(`page-world-${String(sourceEvent || 'report')}`, { ...report, sourceEvent: String(sourceEvent || 'report') });
    };
    if (navLogEnabled) {
        window.addEventListener('message', (event) => {
            if (event.source !== window || event.data?.key !== MAIN_WORLD_MESSAGE_KEY) return;
            forwardMainWorldReport(event.data.detail);
        });
        document.addEventListener(MAIN_WORLD_REPORT_EVENT, (event) => forwardMainWorldReport(event.detail));
    }
    {
        const installMainWorldBridge = () => {
            if (mainWorldInjectionAttempted) return;
            if (!document.documentElement) {
                try {
                    const observer = new MutationObserver(() => {
                        if (!document.documentElement) return;
                        observer.disconnect();
                        installMainWorldBridge();
                    });
                    observer.observe(document, { childList: true, subtree: true });
                } catch (error) {
                    forwardMainWorldReport({ event: 'bridge-injection-failed', reason: `documentElement-unavailable:${String(error?.message || error).slice(0, 200)}` });
                }
                return;
            }
            mainWorldInjectionAttempted = true;
            try {
                if (navLogEnabled) navLog('page-world-install-attempt', { worldMarkerVisible: window.__EHTW_PAGE_WORLD_BRIDGE_V1__ === true, hasDocumentElement: true });
                const bridge = function (diagnosticsEnabled) {
                    if (window.__EHTW_PAGE_WORLD_BRIDGE_V1__) return;
                    try { delete window.__EHTW_PAGE_WORLD_PROBE_V1__; } catch (_) {}
                    const controlEvent = '__ehtw_mainworld_control_v1';
                    const messageKey = '__ehtw_mainworld_message_v1';
                    let reportSequence = 0;
                    const trackedTypes = new Set(['popstate', 'hashchange', 'pageshow', 'beforeunload']);
                    const tracked = new Map();
                    const trackedProperties = new Map();
                    const trackedIntervals = new Set();
                    let captureRouteScripts = true;
                    const readingHandlers = new Map();
                    let readerActive = /^\/s\//.test(location.pathname);
                    const sourceOf = (listener) => {
                        try { return String(typeof listener === 'function' ? listener : listener?.handleEvent || '').slice(0, 300); }
                        catch (_) { return '[source unavailable]'; }
                    };
                    const stackOf = () => {
                        try { return String(new Error().stack || '').slice(0, 500); }
                        catch (_) { return ''; }
                    };
                    const stateKeys = (state) => {
                        try { return state && typeof state === 'object' ? Object.keys(state).slice(0, 40) : []; }
                        catch (_) { return []; }
                    };
                    const send = (event, detail = {}) => {
                        if (!diagnosticsEnabled) return;
                        try {
                            const report = { reportId: ++reportSequence, event, ...detail };
                            window.postMessage({ key: messageKey, detail: report }, '*');
                            document.dispatchEvent(new CustomEvent('__ehtw_mainworld_report_v1', { detail: report }));
                        }
                        catch (_) {}
                    };
                    const snapshot = (reason) => {
                        const listeners = [];
                        for (const [type, records] of tracked) {
                            for (const record of records) listeners.push({ type, source: record.source, reader: record.reader });
                        }
                        send('listeners', {
                            reason,
                            counts: Object.fromEntries([...trackedTypes].map((type) => [type, tracked.get(`window:${type}`)?.length || 0])),
                            listeners: listeners.slice(0, 40)
                        });
                    };
                    const originalAdd = EventTarget.prototype.addEventListener;
                    const originalRemove = EventTarget.prototype.removeEventListener;
                    const originalSetInterval = window.setInterval;
                    Object.defineProperty(window, '__EHTW_PAGE_WORLD_NATIVE_API_V1__', {
                        configurable: true,
                        value: {
                            add(target, type, listener, options) { return Reflect.apply(originalAdd, target, [type, listener, options]); },
                            setInterval(...args) { return Reflect.apply(originalSetInterval, window, args); }
                        }
                    });
                    const removeFromTracking = (type, listener) => {
                        const key = `window:${type}`;
                        const list = tracked.get(key);
                        if (!list) return;
                        const index = list.findIndex((entry) => entry.original === listener);
                        if (index >= 0) list.splice(index, 1);
                        if (!list.length) tracked.delete(key);
                    };
                    EventTarget.prototype.addEventListener = function (type, listener, options) {
                        const target = this === window ? 'window' : this === document ? 'document' : '';
                        const isTrackedGlobal = !!target && !!listener && captureRouteScripts;
                        if (!isTrackedGlobal) return Reflect.apply(originalAdd, this, [type, listener, options]);
                        let actual = listener;
                        if (target === 'window' && readerActive && String(type) === 'popstate' ||
                            readerActive && /^(?:keydown|keyup|keypress)$/.test(String(type))) {
                            actual = function (event) {
                                if (readerActive) return;
                                if (typeof listener === 'function') return Reflect.apply(listener, this, [event]);
                                return listener.handleEvent.call(listener, event);
                            };
                            readingHandlers.set(listener, { wrapped: actual, options });
                        }
                        const key = `${target}:${String(type)}`;
                        const list = tracked.get(key) || [];
                        if (!list.some((entry) => entry.original === listener)) {
                            list.push({ target, type: String(type), original: listener, actual, options, source: sourceOf(listener), reader: !!readerActive });
                            tracked.set(key, list);
                        }
                        const result = Reflect.apply(originalAdd, this, [type, actual, options]);
                        if (String(type) === 'popstate') snapshot(`add:${String(type)}`);
                        return result;
                    };
                    EventTarget.prototype.removeEventListener = function (type, listener, options) {
                        const target = this === window ? 'window' : this === document ? 'document' : '';
                        const key = `${target}:${String(type)}`;
                        const list = tracked.get(key);
                        const entry = target && list?.find((record) => record.original === listener);
                        const result = Reflect.apply(originalRemove, this, [type, entry?.actual || listener, options]);
                        if (entry) {
                            const index = list.indexOf(entry);
                            if (index >= 0) list.splice(index, 1);
                            if (!list.length) tracked.delete(key);
                            if (String(type) === 'popstate') snapshot(`remove:${String(type)}`);
                        }
                        return result;
                    };
                    const propertyTargets = [['window', window], ['document', document]];
                    const propertyTypes = ['popstate', 'hashchange', 'keydown', 'keyup', 'keypress', 'scroll', 'resize', 'beforeunload', 'unload', 'pagehide', 'message', 'click', 'mousedown', 'touchstart'];
                    for (const [targetName, target] of propertyTargets) for (const type of propertyTypes) {
                        if (targetName === 'window' && type === 'popstate') continue;
                        const property = `on${type}`;
                        let descriptor = null;
                        for (let proto = target; proto && !descriptor; proto = Object.getPrototypeOf(proto)) descriptor = Object.getOwnPropertyDescriptor(proto, property) || null;
                        if (!descriptor?.configurable || !descriptor.set || !descriptor.get) continue;
                        const key = `${targetName}:${property}`;
                        let current = null;
                        try { current = Reflect.apply(descriptor.get, target, []); } catch (_) {}
                        Object.defineProperty(target, property, {
                            configurable: true, enumerable: descriptor.enumerable,
                            get() { return current; },
                            set(listener) {
                                current = listener;
                                if (listener == null || !captureRouteScripts) trackedProperties.delete(key);
                                else trackedProperties.set(key, { target, targetName, property, type, listener, descriptor });
                                const suppressReaderKey = readerActive && /^(?:onkeydown|onkeyup|onkeypress)$/.test(property) && typeof listener === 'function';
                                Reflect.apply(descriptor.set, target, [suppressReaderKey ? null : listener]);
                            }
                        });
                    }
                    try {
                        const originalClearInterval = window.clearInterval;
                        window.setInterval = function (...args) {
                            const id = Reflect.apply(originalSetInterval, this, args);
                            if (captureRouteScripts) trackedIntervals.add(id);
                            return id;
                        };
                        window.clearInterval = function (id) {
                            trackedIntervals.delete(id);
                            return Reflect.apply(originalClearInterval, this, [id]);
                        };
                    } catch (_) {}
                    let onpopDescriptor = null;
                    for (let proto = window; proto && !onpopDescriptor; proto = Object.getPrototypeOf(proto)) {
                        onpopDescriptor = Object.getOwnPropertyDescriptor(proto, 'onpopstate') || null;
                    }
                    let assignedOnpopstate = null;
                    if (onpopDescriptor?.configurable && onpopDescriptor.set) {
                        Object.defineProperty(window, 'onpopstate', {
                            configurable: true,
                            enumerable: onpopDescriptor.enumerable,
                            get() { return assignedOnpopstate; },
                            set(listener) {
                                assignedOnpopstate = listener;
                                const propertyKey = 'window:onpopstate';
                                if (listener == null || !captureRouteScripts) trackedProperties.delete(propertyKey);
                                else trackedProperties.set(propertyKey, { target: window, targetName: 'window', property: 'onpopstate', type: 'popstate', listener, descriptor: onpopDescriptor });
                                let actual = listener;
                                if (typeof listener === 'function' && readerActive) {
                                    actual = function (event) {
                                        if (readerActive) return;
                                        return Reflect.apply(listener, window, [event]);
                                    };
                                    readingHandlers.set(listener, { wrapped: actual, property: true });
                                }
                                Reflect.apply(onpopDescriptor.set, window, [actual]);
                                if (captureRouteScripts) send('onpopstate-set', { reader: !!readerActive, source: sourceOf(listener) });
                            }
                        });
                    }
                    const wrapLocationMethod = (key) => {
                        try {
                            const original = Location.prototype[key];
                            if (typeof original !== 'function' || original.__ehtwPageWorldWrapped) return;
                            const wrapped = function (...args) {
                                send(`location-${key}`, { targetPath: (() => { try { return new URL(args[0], location.href).pathname; } catch (_) { return ''; } })(), stack: stackOf() });
                                return Reflect.apply(original, this, args);
                            };
                            Object.defineProperty(wrapped, '__ehtwPageWorldWrapped', { value: true });
                            Location.prototype[key] = wrapped;
                        } catch (_) {}
                    };
                    if (diagnosticsEnabled) ['assign', 'replace', 'reload'].forEach(wrapLocationMethod);
                    if (diagnosticsEnabled) try {
                        const hrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
                        if (hrefDescriptor?.set && hrefDescriptor.configurable && !hrefDescriptor.set.__ehtwPageWorldWrapped) {
                            const setter = function (value) {
                                let targetPath = '';
                                try { targetPath = new URL(value, location.href).pathname; } catch (_) {}
                                send('location-href', { targetPath, stack: stackOf() });
                                return Reflect.apply(hrefDescriptor.set, this, [value]);
                            };
                            Object.defineProperty(setter, '__ehtwPageWorldWrapped', { value: true });
                            Object.defineProperty(Location.prototype, 'href', { ...hrefDescriptor, set: setter });
                        }
                    } catch (_) {}
                    const wrapHistoryMethod = (key) => {
                        try {
                            const original = History.prototype[key];
                            if (typeof original !== 'function' || original.__ehtwPageWorldWrapped) return;
                            const wrapped = function (state, ...args) {
                                send(`history-${key}`, { stateKeys: stateKeys(state), targetPath: (() => { try { return args[1] ? new URL(args[1], location.href).pathname : location.pathname; } catch (_) { return ''; } })(), stack: stackOf() });
                                return Reflect.apply(original, this, [state, ...args]);
                            };
                            Object.defineProperty(wrapped, '__ehtwPageWorldWrapped', { value: true });
                            History.prototype[key] = wrapped;
                        } catch (_) {}
                    };
                    if (diagnosticsEnabled) ['pushState', 'replaceState'].forEach(wrapHistoryMethod);
                    if (diagnosticsEnabled) Reflect.apply(originalAdd, window, ['popstate', (event) => {
                        send('popstate', { onpopstate: sourceOf(assignedOnpopstate), onpopstatePresent: typeof assignedOnpopstate === 'function', stateKeys: stateKeys(event?.state) });
                    }]);
                    const applyReaderControl = (action) => {
                        if (action === 'route-scripts-start') {
                            captureRouteScripts = true;
                            readerActive = /^\/s\//.test(location.pathname);
                            return;
                        }
                        if (action === 'route-scripts-end') { captureRouteScripts = false; return; }
                        if (action === 'route-leave') {
                            let removedListeners = 0;
                            const removedListenerSources = [];
                            for (const [key, records] of [...tracked]) {
                                for (const record of [...records]) {
                                    const target = record.target === 'window' ? window : document;
                                    try { Reflect.apply(originalRemove, target, [record.type, record.actual, record.options]); } catch (_) {}
                                    removedListenerSources.push(`${record.target}:${record.type}:${record.source}`);
                                    removedListeners++;
                                }
                                tracked.delete(key);
                            }
                            let removedProperties = 0;
                            for (const [key, record] of [...trackedProperties]) {
                                try { Reflect.apply(record.descriptor.set, record.target, [null]); } catch (_) {}
                                trackedProperties.delete(key);
                                removedProperties++;
                            }
                            let clearedIntervals = 0;
                            for (const id of trackedIntervals) { try { window.clearInterval(id); clearedIntervals++; } catch (_) {} }
                            trackedIntervals.clear();
                            send('route-cleanup', { removedWindowDocumentListeners: removedListeners, removedListenerSources, clearedOnHandlers: removedProperties, clearedIntervals });
                            snapshot('route-leave');
                            return;
                        }
                        if (action === 'route-snapshot') {
                            const counts = { window: {}, document: {} };
                            for (const records of tracked.values()) for (const record of records) {
                                counts[record.target][record.type] = (counts[record.target][record.type] || 0) + 1;
                            }
                            const onCounts = { window: {}, document: {} };
                            for (const record of trackedProperties.values()) onCounts[record.targetName][record.type] = (onCounts[record.targetName][record.type] || 0) + 1;
                            send('route-global-handlers', { listeners: counts, onHandlers: onCounts });
                            return;
                        }
                        if (action === 'reader-enter') {
                            if (readerActive) return;
                            readerActive = true;
                            send('reader-active', { active: true });
                            return;
                        }
                        if (action === 'reader-leave') {
                            if (!readerActive && !assignedOnpopstate) return;
                            readerActive = false;
                            try { Reflect.apply(originalRemove, window, ['popstate', assignedOnpopstate, false]); } catch (_) {}
                            assignedOnpopstate = null;
                            try { Reflect.apply(onpopDescriptor?.set, window, [null]); } catch (_) {}
                            const records = tracked.get('window:popstate') || [];
                    const removedReaderListeners = records.filter((record) => record.reader).length;
                            for (const record of [...records]) {
                                if (!record.reader) continue;
                                try { Reflect.apply(originalRemove, window, ['popstate', record.actual, record.options]); } catch (_) {}
                                removeFromTracking('popstate', record.original);
                            }
                            readingHandlers.clear();
                            send('reader-cleanup', { active: false, removedWindowPopstateListeners: removedReaderListeners, onpopstateCleared: true });
                            snapshot('reader-leave');
                        }
                    };
                    Reflect.apply(originalAdd, window, [controlEvent, (event) => applyReaderControl(event.detail?.action)]);
                    const readerRouteObserver = new MutationObserver(() => {
                        const active = document.documentElement.getAttribute('data-ehtw-reader-route') === 'active';
                        applyReaderControl(active ? 'reader-enter' : 'reader-leave');
                    });
                    readerRouteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ehtw-reader-route'] });
                    Object.defineProperty(window, '__EHTW_PAGE_WORLD_CONTROL_V1__', { value: applyReaderControl, configurable: true });
                    Object.defineProperty(window, '__EHTW_PAGE_WORLD_BRIDGE_V1__', { value: true, configurable: true });
                    document.documentElement.setAttribute('data-ehtw-page-world-bridge', 'ready');
                    send('bridge-ready', { initialReader: readerActive, mode: 'page-world' });
                    snapshot('bridge-ready');
                };
                const probeNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const probe = document.createElement('script');
                probe.textContent = `window.__EHTW_PAGE_WORLD_PROBE_V1__=${JSON.stringify(probeNonce)};`;
                document.documentElement.appendChild(probe);
                probe.remove();
                const directWorld = window.__EHTW_PAGE_WORLD_PROBE_V1__ === probeNonce;
                if (directWorld) {
                    try { delete window.__EHTW_PAGE_WORLD_PROBE_V1__; } catch (_) {}
                    bridge(navLogEnabled);
                } else {
                    const script = document.createElement('script');
                    script.id = mainWorldScriptId;
                    script.textContent = `;(${bridge.toString()})(${navLogEnabled ? 'true' : 'false'});`;
                    script.onerror = () => forwardMainWorldReport({ event: 'bridge-injection-failed', reason: 'inline-script-error-event' });
                    document.documentElement.appendChild(script);
                    script.remove();
                }
                mainWorldBridgeReady = document.documentElement.getAttribute('data-ehtw-page-world-bridge') === 'ready';
                if (directWorld) mainWorldBridgeReady = window.__EHTW_PAGE_WORLD_BRIDGE_V1__ === true;
                if (!mainWorldBridgeReady) forwardMainWorldReport({ event: 'bridge-injection-failed', reason: 'main-world-marker-not-set-after-synchronous-script-injection' });
                forwardMainWorldReport({ event: 'bridge-injection', mode: directWorld ? 'page-world' : 'dom-script', ready: mainWorldBridgeReady });
            } catch (error) {
                forwardMainWorldReport({ event: 'bridge-injection-failed', reason: String(error?.message || error).slice(0, 300) });
            }
        };
        installMainWorldBridge();
    }
    const controlMainWorldReader = (action) => {
        if (!mainWorldInjectionAttempted) return;
        try {
            document.documentElement?.setAttribute('data-ehtw-reader-route', action === 'reader-enter' ? 'active' : 'inactive');
            const script = document.createElement('script');
            script.textContent = `window.__EHTW_PAGE_WORLD_CONTROL_V1__?.(${JSON.stringify(action)});`;
            (document.documentElement || document.head || document).appendChild(script);
            script.remove();
        }
        catch (error) { navLog('page-world-control-failed', { action, reason: String(error?.message || error).slice(0, 300) }); }
    };
    const navLogPath = (value) => {
        try { return new URL(value, location.href).pathname; } catch (_) { return ''; }
    };
    const navLogActiveElement = () => {
        const active = document.activeElement;
        return active ? { tagName: String(active.tagName || '').toLowerCase(), id: active.id || '' } : null;
    };
    if (navLogEnabled) {
        const wrapMethod = (object, key, label, getDetails = () => ({})) => {
            try {
                const original = object?.[key];
                if (typeof original !== 'function' || original.__ehtwNavLogWrapped) return;
                const wrapped = function (...args) {
                    navLog(`api-${label}`, { ...getDetails.call(this, args), stack: navLogStack() });
                    return Reflect.apply(original, this, args);
                };
                Object.defineProperty(wrapped, '__ehtwNavLogWrapped', { value: true });
                object[key] = wrapped;
            } catch (_) {}
        };
        wrapMethod(Location.prototype, 'assign', 'location-assign', ([href]) => ({ targetPath: navLogPath(href) }));
        wrapMethod(Location.prototype, 'replace', 'location-replace', ([href]) => ({ targetPath: navLogPath(href) }));
        wrapMethod(Location.prototype, 'reload', 'location-reload');
        wrapMethod(History.prototype, 'back', 'history-back');
        wrapMethod(History.prototype, 'go', 'history-go', ([delta]) => ({ delta: Number(delta) || 0 }));
        wrapMethod(History.prototype, 'forward', 'history-forward');
        wrapMethod(HTMLFormElement.prototype, 'submit', 'form-submit', function (args) { return { targetPath: navLogPath(this.action) }; });
        wrapMethod(HTMLFormElement.prototype, 'requestSubmit', 'form-request-submit', function (args) { return { targetPath: navLogPath(this.action) }; });
        wrapMethod(HTMLAnchorElement.prototype, 'click', 'anchor-click', function () { return { targetPath: navLogPath(this.href) }; });
        try {
            const descriptor = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
            if (descriptor?.set && descriptor.configurable) {
                Object.defineProperty(Location.prototype, 'href', { ...descriptor, set(value) {
                    navLog('api-location-href', { targetPath: navLogPath(value), stack: navLogStack() });
                    return Reflect.apply(descriptor.set, this, [value]);
                } });
            }
        } catch (_) {}
        addUserScriptListener(document, 'click', (event) => {
            const anchor = (event.target?.nodeType === 1 ? event.target : event.target?.parentElement)?.closest?.('a[href]');
            if (!anchor) return;
            const stack = navLogStack();
            window.setTimeout(() => {
                if (!event.defaultPrevented) navLog('default-anchor-navigation', {
                    targetPath: navLogPath(anchor.href), stack
                });
            }, 0);
        }, true);
        addUserScriptListener(document, 'submit', (event) => {
            const form = event.target;
            const stack = navLogStack();
            window.setTimeout(() => {
                if (!event.defaultPrevented) navLog('default-form-navigation', {
                    targetPath: navLogPath(form?.action), stack
                });
            }, 0);
        }, true);
        for (const eventName of ['beforeunload', 'unload', 'pagehide']) {
            addUserScriptListener(window, eventName, (event) => {
                if (eventName === 'pagehide') {
                    try { window.sessionStorage?.setItem(NAV_LOG_CLEAN_EXIT_KEY, '1'); } catch (_) {}
                }
                navLog(eventName, {
                ...(eventName === 'pagehide' ? { persisted: !!event?.persisted } : {}),
                activeElement: navLogActiveElement()
                });
            });
        }
        const logDocumentNavigationEntry = () => {
            const navigation = window.performance?.getEntriesByType?.('navigation')?.[0];
            navLog('document-navigation-entry', {
                type: navigation?.type || '', namePath: navLogPath(navigation?.name || location.href),
                referrerPath: document.referrer ? navLogPath(document.referrer) : ''
            });
        };
        if (document.readyState === 'loading') {
            addUserScriptListener(document, 'DOMContentLoaded', logDocumentNavigationEntry, { once: true });
        } else {
            logDocumentNavigationEntry();
        }
    }
    const safeReplaceHistoryState = (historyObject, state, title, href, source = 'unspecified') => {
        try {
            historyObject.replaceState(state, title, href);
            return true;
        } catch (error) {
            if (navLogEnabled) navLog('history-replace-state-error', {
                source,
                errorName: String(error?.name || 'Error'),
                errorMessage: String(error?.message || error)
            });
            return false;
        }
    };
    if (navLogCommand === 'ehtw-navlog-on' || navLogCommand === 'ehtw-navlog-off' ||
        navLogCommand === 'ehtw-nocache-on' || navLogCommand === 'ehtw-nocache-off' || navLogPanelRequested) {
        if (safeReplaceHistoryState(window.history, window.history.state, '', `${location.pathname}${location.search}`, 'navlog-command-consume')) {
            spaRenderedHref = location.href;
        }
    }

    // Track only active left-edge gestures. This reuses a single early
    // touchstart listener and installs touchend/cancel listeners temporarily.
    const EDGE_GESTURE_QUIET_MS = 350;
    const edgeGestureTouchIds = new Set();
    let edgeGestureQuietUntil = 0;
    let edgeGestureReleaseTimer = null;
    let flushDeferredScrollHistoryReplace = null;
    const isEdgeGestureProtected = () =>
        edgeGestureTouchIds.size > 0 || Date.now() < edgeGestureQuietUntil;
    const finishEdgeGestureTouches = (event) => {
        for (const touch of event.changedTouches || []) edgeGestureTouchIds.delete(touch.identifier);
        if (edgeGestureTouchIds.size) return;
        document.removeEventListener('touchend', finishEdgeGestureTouches, true);
        document.removeEventListener('touchcancel', finishEdgeGestureTouches, true);
        edgeGestureQuietUntil = Date.now() + EDGE_GESTURE_QUIET_MS;
        window.clearTimeout(edgeGestureReleaseTimer);
        edgeGestureReleaseTimer = window.setTimeout(() => {
            edgeGestureReleaseTimer = null;
            edgeGestureQuietUntil = 0;
            flushDeferredScrollHistoryReplace?.('edge-gesture-quiet-end');
        }, EDGE_GESTURE_QUIET_MS);
    };
    const trackLeftEdgeGestureStart = (event) => {
        if (!navLogApplicable) return;
        let foundEdgeTouch = false;
        for (const touch of event.changedTouches || []) {
            if (touch.clientX > 30) continue;
            edgeGestureTouchIds.add(touch.identifier);
            foundEdgeTouch = true;
        }
        if (!foundEdgeTouch) return;
        edgeGestureQuietUntil = 0;
        window.clearTimeout(edgeGestureReleaseTimer);
        edgeGestureReleaseTimer = null;
        addUserScriptListener(document, 'touchend', finishEdgeGestureTouches, { capture: true, passive: true });
        addUserScriptListener(document, 'touchcancel', finishEdgeGestureTouches, { capture: true, passive: true });
    };
    if (navLogEnabled) {
        window.__EHTW_NAV_LOG__ = {
            diagnosticListeners: navLogApplicable ? 4 : 0,
            diagnosticTimers: 0,
            clear() {
                navLogEntries = [];
                try { window.sessionStorage?.removeItem(NAV_LOG_SESSION_KEY); } catch (_) {}
                if (navLogTextarea) navLogTextarea.value = '';
                if (navLogTitle) navLogTitle.textContent = `导航诊断日志（0/${NAV_LOG_LIMIT}）`;
            },
            exportText: navLogText,
            maxEntries: NAV_LOG_LIMIT
        };
        const edgeTouches = new Map();
        const coordinates = (touch) => ({ x: Math.round(touch.clientX), y: Math.round(touch.clientY) });
        addUserScriptListener(document, 'touchstart', (event) => {
            for (const touch of event.changedTouches || []) {
                if (touch.clientX <= 30) {
                    const point = coordinates(touch);
                    edgeTouches.set(touch.identifier, point);
                    navLog('edge-touch', { phase: 'touchstart', ...point }, true);
                }
            }
        }, { capture: true, passive: true });
        addUserScriptListener(document, 'touchend', (event) => {
            for (const touch of event.changedTouches || []) {
                const start = edgeTouches.get(touch.identifier);
                if (!start && touch.clientX > 30) continue;
                navLog('edge-touch', { phase: 'touchend', ...(start ? { startX: start.x, startY: start.y } : {}), ...coordinates(touch) }, true);
                edgeTouches.delete(touch.identifier);
            }
        }, { capture: true, passive: true });
        addUserScriptListener(document, 'touchcancel', (event) => {
            for (const touch of event.changedTouches || []) {
                const start = edgeTouches.get(touch.identifier);
                if (!start && touch.clientX > 30) continue;
                navLog('edge-touch', { phase: 'touchcancel', ...(start ? { startX: start.x, startY: start.y } : {}), ...coordinates(touch) }, true);
                edgeTouches.delete(touch.identifier);
            }
        }, { capture: true, passive: true });
    }

    const showNavLogPanel = () => {
        if (!navLogPanelRequested || !document.body || document.getElementById('ehtw-navlog-panel')) return;
        const panel = document.createElement('section');
        panel.id = 'ehtw-navlog-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', '导航诊断日志');
        panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;gap:8px;padding:12px;background:#101820;color:#fff;font:14px system-ui,sans-serif;box-sizing:border-box;';
        navLogTitle = document.createElement('div');
        navLogTitle.textContent = `导航诊断日志（${navLogEntries.length}/${NAV_LOG_LIMIT}）`;
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const button = (id, label) => {
            const el = document.createElement('button');
            el.id = id;
            el.type = 'button';
            el.textContent = label;
            el.style.cssText = 'min-height:44px;min-width:72px;padding:8px 14px;font-size:16px;';
            return el;
        };
        const copyButton = button('ehtw-navlog-copy', '复制');
        const clearButton = button('ehtw-navlog-clear', '清空');
        const closeButton = button('ehtw-navlog-close', '关闭');
        const status = document.createElement('span');
        status.setAttribute('aria-live', 'polite');
        controls.append(copyButton, clearButton, closeButton, status);
        navLogTextarea = document.createElement('textarea');
        navLogTextarea.id = 'ehtw-navlog-text';
        navLogTextarea.readOnly = true;
        navLogTextarea.setAttribute('aria-label', '可复制的导航诊断日志');
        navLogTextarea.style.cssText = 'flex:1;min-height:0;width:100%;resize:none;box-sizing:border-box;font:12px ui-monospace,monospace;white-space:pre;';
        navLogTextarea.value = navLogText();
        copyButton.addEventListener('click', async () => {
            const text = navLogTextarea.value;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    status.textContent = '已复制';
                    return;
                }
            } catch (_) {}
            navLogTextarea.focus();
            navLogTextarea.select();
            try { status.textContent = document.execCommand('copy') ? '已复制' : '已选中，请长按复制'; }
            catch (_) { status.textContent = '已选中，请长按复制'; }
        });
        clearButton.addEventListener('click', () => {
            navLogEntries = [];
            navLogTextarea.value = '';
            navLogTitle.textContent = `导航诊断日志（0/${NAV_LOG_LIMIT}）`;
            try { window.sessionStorage?.removeItem(NAV_LOG_SESSION_KEY); } catch (_) {}
            status.textContent = '已清空';
        });
        closeButton.addEventListener('click', () => {
            navLogTextarea = null;
            navLogTitle = null;
            panel.remove();
        });
        panel.append(navLogTitle, controls, navLogTextarea);
        document.body.appendChild(panel);
        navLogTextarea.focus();
    };

    const EHTW_GALLERY_ORIGINS = new Set([
        'https://e-hentai.org',
        'https://exhentai.org'
    ]);
    const EHTW_UPLOAD_ORIGINS = new Set([
        'https://upld.e-hentai.org',
        'https://upld.exhentai.org'
    ]);
    function isGallerySiteOrigin(value = location.origin) {
        return EHTW_GALLERY_ORIGINS.has(String(value || ''));
    }
    function isUploadSiteOrigin(value = location.origin) {
        return EHTW_UPLOAD_ORIGINS.has(String(value || ''));
    }
    if (navLogEnabled && isGallerySiteOrigin(location.origin)) {
        addUserScriptListener(document, 'visibilitychange', () => navLog('visibilitychange', {
            visibilityState: document.visibilityState,
            hidden: !!document.hidden
        }), { passive: true });
    }

    const ehtwScriptBootTime = (() => {
        try {
            return window.performance?.now?.() ?? null;
        } catch (_) {
            return null;
        }
    })();

    const isReaderUrl = /^\/s\//i.test(location.pathname);
    const pageBootClass = isReaderUrl ? 'ehtw-reader-boot' : 'ehtw-page-boot';
    let pageBootResetTimer = null;
    let navigationResetTimer = null;
    let pageBootWasReleased = false;
    let pageBootObserver = null;
    let hasTouchInput = false;

    const releasePageBoot = () => {
        pageBootWasReleased = true;
        pageBootObserver?.disconnect();
        pageBootObserver = null;
        window.clearTimeout?.(pageBootResetTimer);
        window.clearTimeout?.(navigationResetTimer);
        pageBootResetTimer = null;
        navigationResetTimer = null;
        document.documentElement?.classList.remove(
            'ehtw-page-boot',
            'ehtw-reader-boot',
            'ehtw-navigation-pending'
        );
    };

    function getGalleryIdFromUrl(value, baseUrl = location.href) {
        try {
            return new URL(value, baseUrl).pathname.match(/^\/g\/(\d+)\//i)?.[1] || null;
        } catch (_) {
            return null;
        }
    }

    function getGalleryThumbPageIndex(value, baseUrl = location.href) {
        try {
            const raw = new URL(value, baseUrl).searchParams.get('p');
            const index = Number.parseInt(raw || '0', 10);
            return Number.isFinite(index) && index >= 0 ? index : 0;
        } catch (_) {
            return 0;
        }
    }

    // ---- Scroll position memory (history state + sessionStorage) ----
    window.__EHTW_SCROLL_SAVE_LOCK__ = false;
    let scrollRestoreProtectionUntil = 0;
    let scrollRestoreProtectionTimer = null;
    let saveCurrentScrollForSpa = () => false;
    const spaScrollStorageKey = (href) => `ehtw-scroll-v1:${href}`;
    const spaHistoryStateStorageKey = (href) => `ehtw-history-state-v1:${href}`;
    const spaScrollPageshowRestoreKey = (href) => `ehtw-scroll-pageshow-restore-v1:${href}`;
    const spaBackTargetStorageKey = (href) => `ehtw-back-target-v1:${href}`;
    const getSavedSpaBackTarget = (href) => {
        try {
            return window.sessionStorage?.getItem(spaBackTargetStorageKey(href)) || '';
        } catch (_) {
            return '';
        }
    };
    const resolveSpaBackTarget = (value, currentHref) => {
        try {
            let target = new URL(value, currentHref);
            if (target.origin !== location.origin || target.href === new URL(currentHref).href) return '/';
            const previousGalleryId = getGalleryIdFromUrl(target.href);
            if (previousGalleryId) {
                const savedListHref = window.sessionStorage?.getItem(
                    `ehtw-gallery-return-v1:${previousGalleryId}`
                );
                if (savedListHref) target = new URL(savedListHref, currentHref);
            }
            return target.origin === location.origin && target.href !== new URL(currentHref).href
                ? target.href
                : '/';
        } catch (_) {
            return '/';
        }
    };
    const getSavedSpaScroll = (href) => {
        try {
            return Math.max(0, Number(window.sessionStorage?.getItem(spaScrollStorageKey(href))) || 0);
        } catch (_) {
            return 0;
        }
    };
    const saveSpaScroll = (href, y) => {
        try {
            window.sessionStorage?.setItem(spaScrollStorageKey(href), String(Math.max(0, Math.round(Number(y) || 0))));
        } catch (_) {}
    };
    const copySpaHistoryState = (state) => {
        if (!state || typeof state !== 'object') return null;
        const keys = [
            'ehtwSpa', 'ehtwSpaRoute', 'ehtwEntryId', 'ehtwSpaDepth', 'ehtwScrollY',
            'ehtwSpaPreviousHref', 'ehtwSpaReturnBackTarget'
        ];
        const saved = Object.fromEntries(keys.filter((key) => key in state).map((key) => [key, state[key]]));
        return saved.ehtwSpa && saved.ehtwEntryId ? saved : null;
    };
    const rememberSpaHistoryState = (href, state) => {
        const saved = copySpaHistoryState(state);
        if (!saved) return false;
        try {
            const absoluteHref = new URL(href, location.href).href;
            window.sessionStorage?.setItem(spaHistoryStateStorageKey(absoluteHref), JSON.stringify(saved));
            return true;
        } catch (_) {
            return false;
        }
    };
    const readRememberedSpaHistoryState = (href) => {
        try {
            const absoluteHref = new URL(href, location.href).href;
            const value = JSON.parse(window.sessionStorage?.getItem(spaHistoryStateStorageKey(absoluteHref)) || 'null');
            return copySpaHistoryState(value);
        } catch (_) {
            return null;
        }
    };
    const forgetRememberedSpaHistoryState = (href) => {
        try {
            const absoluteHref = new URL(href, location.href).href;
            window.sessionStorage?.removeItem(spaHistoryStateStorageKey(absoluteHref));
        } catch (_) {}
    };
    function recoverSpaHistoryState(href, candidateState) {
        const candidate = candidateState && typeof candidateState === 'object' ? candidateState : null;
        const copiedCandidate = copySpaHistoryState(candidate);
        if (copiedCandidate) {
            rememberSpaHistoryState(href, copiedCandidate);
            return { ...(candidate || {}), ...copiedCandidate };
        }
        const remembered = readRememberedSpaHistoryState(href);
        if (remembered) return { ...(candidate || {}), ...remembered };
        const suspended = findSuspendedSpaPageByHref(href);
        const suspendedState = copySpaHistoryState(suspended?.historyState);
        if (suspendedState) return { ...(candidate || {}), ...suspendedState };
        return candidate || {};
    }

    // List-like pages are the ones that get suspended (kept alive) when a
    // gallery is opened from them, and are valid "return to list" targets.
    const isListLikePath = (pathname) =>
        !/^\/(g|s|mytags|uconfig)(\/|\.php|$)/i.test(String(pathname || ''));
    const newSpaEntryId = () =>
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const readFiniteNumber = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    function shouldRestoreSpaScrollOnPageShow(event, navigationType, explicitRestore = false, referrer = '', currentHref = '', historyState = null) {
        if (!!event?.persisted || navigationType === 'back_forward' || explicitRestore === true) return true;
        if (navigationType !== 'navigate' || !historyState?.ehtwSpa || !referrer || !currentHref) return false;
        try {
            const referrerUrl = new URL(referrer);
            const currentUrl = new URL(currentHref);
            referrerUrl.hash = '';
            currentUrl.hash = '';
            return referrerUrl.href === currentUrl.href;
        } catch (_) {
            return false;
        }
    }
    const galleryReturnDepthKey = (galleryId) => `ehtw-gallery-return-depth-v1:${galleryId}`;
    const galleryBackTraversalStorageKey = 'ehtw-gallery-back-traversal-v1';
    let galleryBackTraversalPending = false;

    if (isGallerySiteOrigin(location.origin)) {
        try {
            window.history.scrollRestoration = 'manual';
        } catch (_) {}
        const saveCurrentScroll = (source = 'scroll', forceHistoryReplace = false) => {
            if (window.__EHTW_SCROLL_SAVE_LOCK__ || Date.now() < scrollRestoreProtectionUntil) {
                if (navLogEnabled) navLog('scroll-save-skipped', {
                    source,
                    scrollY: window.scrollY || 0,
                    reason: window.__EHTW_SCROLL_SAVE_LOCK__ ? 'scroll-save-lock' : 'scroll-restore-quiet-window'
                });
                return;
            }
            if (
                document.documentElement?.classList.contains('ehtw-navigation-pending') &&
                location.href !== spaRenderedHref
            ) {
                if (navLogEnabled) navLog('scroll-save-skipped', { source, scrollY: window.scrollY || 0, reason: 'pending-destination-does-not-match-rendered-route' });
                return;
            }
            const y = window.scrollY || 0;
            if (navLogEnabled) navLog('scroll-save', { source, scrollY: y, historyState: summarizeNavLogState(window.history.state) });
            if (!/^\/s\//i.test(location.pathname)) saveSpaScroll(location.href, y);
            const state = recoverSpaHistoryState(location.href, window.history.state);
            if (!state?.ehtwSpa) return;
            queueScrollHistoryStateWrite(location.href, state, y, source, forceHistoryReplace);
            return true;
        };
        saveCurrentScrollForSpa = saveCurrentScroll;
        let scrollSaveScheduled = false;
        addUserScriptListener(window, 'scroll', () => {
            if (window.__EHTW_SCROLL_SAVE_LOCK__ || scrollSaveScheduled) return;
            scrollSaveScheduled = true;
            const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
            schedule(() => {
                scrollSaveScheduled = false;
                saveCurrentScroll('scroll');
            });
        }, { passive: true });
        addUserScriptListener(window, 'pagehide', (event) => {
            if (navLogEnabled) navLog('pagehide', { persisted: !!event?.persisted, scrollY: window.scrollY || 0, activeElement: navLogActiveElement() });
            saveCurrentScroll('pagehide', true);
        });
    }

    // Restore scroll after the new page is rendered. The page grows while
    // images / async blocks load, so keep retrying until the target is
    // reachable (or ~3s passed, or the user starts scrolling themselves).
    // Scroll saving is locked meanwhile so clamped intermediate positions
    // never overwrite the saved value.
    let cancelActiveSpaScrollRestore = null;
    const restoreSpaScrollPosition = (value, source = 'unspecified') => {
        // A previous Back restore can keep retrying while images expand the
        // page. If the user navigates again, that stale task must not pull the
        // newly opened route back to the old list position.
        cancelActiveSpaScrollRestore?.();
        const target = Math.max(0, Number(value) || 0);
        if (navLogEnabled) navLog('scroll-restore-start', { source, targetY: target, startY: window.scrollY || 0 });
        window.clearTimeout(scrollHistoryStateWriteTimer);
        scrollHistoryStateWriteTimer = null;
        const raf = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
        window.__EHTW_SCROLL_SAVE_LOCK__ = true;
        const startedAt = Date.now();
        let cancelled = false;
        let finished = false;
        let resizeObserver = null;
        // Ignore leftover input (wheel inertia, the tap that triggered "back")
        // for a moment; only deliberate scrolling afterwards cancels restore.
        const cancelEvents = ['wheel', 'touchmove', 'keydown'];
        const cancel = () => {
            if (Date.now() - startedAt > 400) cancelled = true;
        };
        cancelEvents.forEach((type) => addUserScriptListener(window, type, cancel, { passive: true }));
        const finish = () => {
            if (finished) return;
            finished = true;
            if (cancelActiveSpaScrollRestore === finish) cancelActiveSpaScrollRestore = null;
            cancelEvents.forEach((type) => window.removeEventListener?.(type, cancel));
            try { resizeObserver?.disconnect(); } catch (_) {}
            window.__EHTW_SCROLL_SAVE_LOCK__ = false;
            protectScrollStateAfterRestore();
            if (navLogEnabled) navLog('scroll-restore-finish', { source, targetY: target, reachedY: window.scrollY || 0, canceled: cancelled, elapsedMs: Date.now() - startedAt });
            try {
                console.debug('[EH Twitter Style] scroll restore', {
                    target,
                    reached: window.scrollY,
                    height: document.documentElement.scrollHeight
                });
            } catch (_) {}
        };
        cancelActiveSpaScrollRestore = finish;
        const apply = () => {
            if (finished) return true;
            if (cancelled) { finish(); return true; }
            const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo?.(0, Math.min(target, maxY));
            if (Math.abs((window.scrollY || 0) - target) <= 2) { finish(); return true; }
            if (Date.now() - startedAt > 4000) { finish(); return true; }
            return false;
        };
        const tick = () => {
            if (apply()) return;
            window.setTimeout(tick, 60);
        };
        // Re-apply whenever the page grows (images / async blocks settling).
        if (typeof window.ResizeObserver === 'function') {
            try {
                resizeObserver = new window.ResizeObserver(() => { apply(); });
                resizeObserver.observe(document.documentElement);
                if (document.body) resizeObserver.observe(document.body);
            } catch (_) {}
        }
        apply();
        raf(() => raf(tick));
    };

    function reorderGalleryToplistSections(root) {
        const heading = Array.from(root?.querySelectorAll?.('h2') || [])
            .find((item) => /gallery\s+toplists/i.test(item.textContent || ''));
        const group = heading?.closest?.('.dc') || heading?.parentElement;
        if (!group) return false;

        const sections = Array.from(group.children || [])
            .filter((item) => item.matches?.('.tdo'));
        const periodRank = (section) => {
            const label = String(section.querySelector?.('p')?.textContent || section.textContent || '');
            if (/yesterday/i.test(label)) return 0;
            if (/past\s+month|month/i.test(label)) return 1;
            if (/past\s+year|year/i.test(label)) return 2;
            if (/all[\s-]*time/i.test(label)) return 3;
            return 4;
        };
        if (sections.length < 2 || sections.filter((section) => periodRank(section) < 4).length < 2) {
            return false;
        }

        group.classList?.add('ehtw-gallery-toplists');
        sections
            .map((section, index) => ({ section, index, rank: periodRank(section) }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .forEach(({ section }) => group.appendChild(section));
        return true;
    }

    function getToplistPageKey(value) {
        try {
            const url = new URL(value, location.href);
            return url.origin === location.origin ? `${url.pathname}${url.search}` : '';
        } catch (_) {
            return '';
        }
    }

    function publishToplistEntries(href, entries) {
        const key = getToplistPageKey(href);
        if (!key || !Array.isArray(entries)) return;
        const shared = window.__EHTW_TOPLIST_ENTRIES__ || {};
        shared[key] = entries;
        window.__EHTW_TOPLIST_ENTRIES__ = shared;
        try {
            window.dispatchEvent(new CustomEvent('ehtw-toplist-data', {
                detail: { href: key, entries }
            }));
        } catch (_) {}
    }

    function normalizeHiddenTag(value) {
        return String(value || '')
            .trim()
            .replace(/^#+/, '')
            .replace(/[_+]+/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function getHiddenTagsFromMyTags(root) {
        const hidden = new Set();
        const tagSetEnabled = root?.querySelector?.('#tagset_enable');
        if (tagSetEnabled && !tagSetEnabled.checked) return hidden;
        const rows = root?.querySelectorAll?.('#usertags_outer > div[id^="usertag_"]') || [];
        Array.from(rows).forEach((row) => {
            if (!row.querySelector('input[id^="taghide_"]')?.checked) return;
            const preview = row.querySelector('[id^="tagpreview_"]');
            const tag = preview?.getAttribute('title') || preview?.textContent || '';
            const normalized = normalizeHiddenTag(tag);
            if (normalized) hidden.add(normalized);
        });
        return hidden;
    }

    function getToplistEntryTags(row) {
        return Array.from(row?.querySelectorAll?.('.gt') || [])
            .map((tag) => normalizeHiddenTag(tag.getAttribute('title') || tag.textContent || ''))
            .filter(Boolean);
    }

    function extractNativeToplistEntries(root, limit = 50, baseHref = location.href) {
        const maxEntries = Math.max(1, Math.floor(Number(limit) || 50));
        const source = root?.querySelector?.(
            'table.itg.gltc, table.itg.gltm, table.itg.glte, div.itg.gld, .itg'
        ) || root;
        const candidates = [
            ...Array.from(source?.querySelectorAll?.('.gl1t') || []),
            ...Array.from(source?.querySelectorAll?.('tr') || []).filter((row) =>
                Array.from(row.querySelectorAll?.('a[href*="/g/"]') || []).some((anchor) =>
                    (anchor.querySelector?.('.glink')?.textContent || anchor.textContent || '').trim()
                )
            )
        ];
        const seen = new Set();
        const entries = [];

        candidates.forEach((row) => {
            if (entries.length >= maxEntries) return;
            const link = Array.from(row.querySelectorAll?.('a[href*="/g/"]') || []).find((anchor) =>
                /\/g\/\d+\//i.test(anchor.getAttribute('href') || '') &&
                (anchor.querySelector?.('.glink')?.textContent || anchor.textContent || '').trim()
            );
            if (!link) return;
            try {
                const url = new URL(link.getAttribute('href'), baseHref);
                if (url.origin !== new URL(baseHref).origin || seen.has(url.pathname)) return;
                const title = (link.querySelector?.('.glink')?.textContent || link.textContent || '').trim();
                if (!title) return;
                const image = Array.from(row.querySelectorAll?.(
                    '.glthumb img, .gl3t img, .gl1e img, .gl1m img, img'
                ) || []).find((candidate) => {
                    const src = candidate.getAttribute('data-src') ||
                        candidate.getAttribute('data-original') || candidate.getAttribute('src') || '';
                    return src && !/^data:image\//i.test(src) && src !== '#';
                });
                let thumbnail = image?.getAttribute('data-src') ||
                    image?.getAttribute('data-original') || image?.getAttribute('src') || '';
                if (!thumbnail) {
                    const style = row.querySelector?.('.glthumb, .gl5t, [style*="background"]')?.getAttribute('style') || '';
                    thumbnail = style.match(/url\(["']?([^"')]+)["']?\)/i)?.[1] || '';
                }
                try {
                    const thumbUrl = thumbnail ? new URL(thumbnail, baseHref) : null;
                    thumbnail = thumbUrl && /^https?:$/.test(thumbUrl.protocol) ? thumbUrl.href : '';
                } catch (_) {
                    thumbnail = '';
                }
                seen.add(url.pathname);
                entries.push({ title, href: url.href, thumbnail, tags: getToplistEntryTags(row) });
            } catch (_) {}
        });
        return entries;
    }

    const isEhtwToplistBridgeFrame = window.self !== window.top &&
        location.hostname.toLowerCase() === 'e-hentai.org' &&
        /(?:\?|&)_ehtw_toplist_bridge=/.test(location.search || '');
    if (window.self !== window.top) {
        if (isEhtwToplistBridgeFrame) {
            const ehtwToplistBridgeParams = new URL(location.href).searchParams;
            const sendToplistBridgeData = () => {
                const period = ehtwToplistBridgeParams.get('tl') || '';
                const token = ehtwToplistBridgeParams.get('_ehtw_toplist_bridge') || '';
                const entries = extractNativeToplistEntries(document, 50, location.href);
                try {
                    window.parent.postMessage({
                        type: 'ehtw-toplist-bridge', token, period, entries
                    }, 'https://exhentai.org');
                } catch (_) {}
            };
            if (document.readyState === 'loading') {
                addUserScriptListener(document, 'DOMContentLoaded', sendToplistBridgeData, { once: true });
            } else {
                sendToplistBridgeData();
            }
        }
        return;
    }

    function filterToplistEntries(entries, hiddenTags) {
        const blockedTags = new Set(Array.from(hiddenTags || [], normalizeHiddenTag));
        return Array.from(entries || []).filter((entry) =>
            !(entry.tags || []).some((tag) => blockedTags.has(normalizeHiddenTag(tag)))
        );
    }

    function filterToplistResultRows(root, hiddenTags) {
        const blockedTags = new Set(Array.from(hiddenTags || [], normalizeHiddenTag));
        let hiddenCount = 0;
        const rows = Array.from(root?.querySelectorAll?.('.gl1t, table.itg tr') || []);
        rows.forEach((row) => {
            const blocked = getToplistEntryTags(row).some((tag) => blockedTags.has(tag));
            if (!blocked) return;
            row.hidden = true;
            row.classList?.add('ehtw-hidden-tag-gallery');
            hiddenCount += 1;
        });
        return hiddenCount;
    }

    function renderGalleryToplistCovers(group, entries, hiddenTags = new Set()) {
        const visibleEntries = filterToplistEntries(entries, hiddenTags);
        const rows = Array.from(group?.querySelectorAll?.('.tdo tr') || []);
        let rendered = 0;

        rows.forEach((row, index) => {
            const entry = visibleEntries[index];
            if (!entry) {
                row.hidden = true;
                row.classList?.add('ehtw-gallery-toplist-hidden');
                return;
            }

            row.hidden = false;
            row.classList?.remove('ehtw-gallery-toplist-hidden');
            const rank = row.querySelector?.('td.pso');
            if (rank) rank.textContent = `#${index + 1}`;
            const link = row.querySelector?.('a[href*="/g/"]');
            if (!link) return;
            link.href = entry.href;
            link.setAttribute('href', entry.href);

            let image = link.querySelector?.('.ehtw-gallery-toplist-cover');
            let imageUrl = '';
            try {
                const url = entry.thumbnail ? new URL(entry.thumbnail, location.href) : null;
                if (url && /^https?:$/.test(url.protocol)) imageUrl = url.href;
            } catch (_) {}
            if (imageUrl) {
                if (!image) {
                    image = document.createElement('img');
                    image.className = 'ehtw-gallery-toplist-cover';
                    image.alt = '';
                    image.loading = 'lazy';
                    image.decoding = 'async';
                    image.setAttribute('aria-hidden', 'true');
                }
                image.src = imageUrl;
                link.replaceChildren(image, document.createTextNode(entry.title || ''));
                rendered += 1;
            } else {
                link.replaceChildren(document.createTextNode(entry.title || ''));
            }
        });
        return rendered;
    }

    // Apply a theme-colored page shell before the first paint, then hide the
    // native page until its replacement layout is ready.
    if (
        isGallerySiteOrigin(location.origin) ||
        isUploadSiteOrigin(location.origin)
    ) {
        const installEarlyPageStyle = () => {
            const root = document.documentElement;
            if (root && !document.getElementById('ehtw-page-boot-style')) {
                const earlyStyle = document.createElement('style');
                earlyStyle.id = 'ehtw-page-boot-style';
                earlyStyle.textContent = `
                    html.ehtw-page-boot,
                    html.ehtw-page-boot body {
                        background: #fff !important;
                        color: #0f1419 !important;
                    }
                    @media (prefers-color-scheme: dark) {
                        html.ehtw-page-boot,
                        html.ehtw-page-boot body {
                            background: #000 !important;
                            color: #e7e9ea !important;
                        }
                    }
                    html.ehtw-reader-boot,
                    html.ehtw-reader-boot body {
                        background: #000 !important;
                        color: #fff !important;
                    }
                    html.ehtw-page-boot body > :not(#ehtw-shell),
                    html.ehtw-reader-boot body > :not(.ehtw-reader-root) {
                        opacity: 0 !important;
                    }
                    html.ehtw-page-boot body > #ehtw-shell,
                    html.ehtw-reader-boot body > .ehtw-reader-root {
                        opacity: 1 !important;
                    }
                    html.ehtw-navigation-pending body > :not(#ehtw-shell):not(.ehtw-reader-root) {
                        opacity: 0 !important;
                    }
                    html.ehtw-navigation-pending body > #ehtw-shell,
                    html.ehtw-navigation-pending body > .ehtw-reader-root {
                        opacity: 1 !important;
                    }
                    html.ehtw-navigation-pending,
                    html.ehtw-navigation-pending body {
                        background: var(--ehtw-bg, #fff) !important;
                        color: var(--ehtw-text, #0f1419) !important;
                    }
                    @media (prefers-color-scheme: dark) {
                        html.ehtw-navigation-pending:not(.ehtw-reader),
                        html.ehtw-navigation-pending:not(.ehtw-reader) body {
                            background: var(--ehtw-bg, #000) !important;
                            color: var(--ehtw-text, #e7e9ea) !important;
                        }
                    }
                `;
                (document.head || root).appendChild(earlyStyle);
            }
            return !!root;
        };

        const applyBootClass = () => {
            const root = document.documentElement;
            if (!root) return false;
            if (pageBootWasReleased) return true;
            root.classList.add(pageBootClass);
            installEarlyPageStyle();
            addUserScriptListener(document, 'touchstart', (event) => {
                hasTouchInput = true;
                root.classList.add('ehtw-touch-ui');
                trackLeftEdgeGestureStart(event);
            }, { capture: true, passive: true });
            return true;
        };
        if (!applyBootClass() && typeof MutationObserver === 'function') {
            pageBootObserver = new MutationObserver(() => {
                if (applyBootClass()) {
                    pageBootObserver?.disconnect();
                    pageBootObserver = null;
                }
            });
            pageBootObserver.observe(document, { childList: true, subtree: true });
        }
        pageBootResetTimer = window.setTimeout(releasePageBoot, 20000);

        // 1.17.261: on phones the sticky header and the bottom nav slide away
        // while scrolling down and come back when scrolling up (like the
        // reader). iOS Safari paints the status bar / its toolbar area with
        // the colour of a bar pinned to that edge; with the bars away the
        // page content shows through instead.
        {
            const CHROME_HIDDEN_CLASS = 'ehtw-chrome-scroll-hidden';
            let lastY = Number(window.scrollY) || 0;
            let travel = 0;
            let userInputAt = 0;
            let touching = false;
            const isPhoneLayout = () => {
                try {
                    return window.matchMedia?.('(max-width: 699px)')?.matches ?? (window.innerWidth <= 699);
                } catch (_) {
                    return false;
                }
            };
            const setHidden = (hidden) => {
                const root = document.documentElement;
                if (!root || root.classList.contains(CHROME_HIDDEN_CLASS) === hidden) return;
                root.classList.toggle(CHROME_HIDDEN_CLASS, hidden);
            };
            const markInput = () => { userInputAt = performance.now(); };
            addUserScriptListener(document, 'touchstart', (event) => {
                touching = Number(event.touches?.length) > 0;
                markInput();
            }, { capture: true, passive: true });
            addUserScriptListener(document, 'touchend', (event) => {
                touching = Number(event.touches?.length) > 0;
                markInput();
            }, { capture: true, passive: true });
            addUserScriptListener(document, 'touchcancel', () => { touching = false; }, { capture: true, passive: true });
            addUserScriptListener(window, 'wheel', markInput, { passive: true });
            addUserScriptListener(window, 'keydown', markInput, { passive: true });
            addUserScriptListener(window, 'scroll', () => {
                const root = document.documentElement;
                const y = Number(window.scrollY) || 0;
                const delta = y - lastY;
                lastY = y;
                if (!root || root.classList.contains('ehtw-reader') || !isPhoneLayout()) {
                    travel = 0;
                    setHidden(false);
                    return;
                }
                const now = performance.now();
                // Only finger, momentum, wheel or key scrolling counts; scroll
                // restoration after navigation never hides the bars.
                if (!(touching || now - userInputAt < 1200) || Math.abs(delta) > (window.innerHeight || 800)) {
                    travel = 0;
                    return;
                }
                userInputAt = now;
                if (y <= 8) {
                    travel = 0;
                    setHidden(false);
                    return;
                }
                if (!delta) return;
                if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
                travel += delta;
                if (travel > 24) setHidden(true);
                else if (travel < -24) setHidden(false);
            }, { passive: true });
        }

        const markNavigationPending = () => {
            if (navLogEnabled) navLog('beforeunload-navigation-pending', { scrollY: window.scrollY || 0, historyState: summarizeNavLogState(window.history.state) });
            document.documentElement?.classList.add('ehtw-navigation-pending');
            window.clearTimeout?.(navigationResetTimer);
            navigationResetTimer = window.setTimeout(() => {
                document.documentElement?.classList.remove('ehtw-navigation-pending');
            }, 20000);
        };

        addUserScriptListener(document, 'click', (event) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            ) return;
            const anchor = event.target?.closest?.('a[href]');
            if (!anchor || anchor.target === '_blank' || anchor.matches('.ehtw-back-link')) return;
            // Let the site's inline popup handlers run before the browser's
            // default link action (for example, the torrent icon on a card).
            if (/\bpopUp\s*\(/i.test(anchor.getAttribute('onclick') || '')) return;
            const inlineLocationContainer = anchor.parentElement?.closest?.('[onclick]');
            const hasInlineLocationNavigation = !!inlineLocationContainer &&
                /(?:document|window)\.location(?:\.href)?\s*=/.test(
                    inlineLocationContainer.getAttribute('onclick') || ''
                );
            try {
                const targetUrl = new URL(anchor.getAttribute('href') || anchor.href, location.href);
                if (!isGallerySiteOrigin(targetUrl.origin) &&
                    !isUploadSiteOrigin(targetUrl.origin)) return;
                if (
                    targetUrl.pathname === location.pathname &&
                    targetUrl.search === location.search
                ) return;
                if (
                    isGallerySiteOrigin(location.origin) &&
                    targetUrl.origin === location.origin &&
                    window.__EHTW_SPA_READY__ &&
                    typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                ) {
                    const currentGalleryId = getGalleryIdFromUrl(location.href);
                    const isSameGalleryPagination = !!currentGalleryId &&
                        getGalleryIdFromUrl(targetUrl.href) === currentGalleryId;
                    // Gallery pagination cells also have a native inline
                    // document.location handler on their <td>. Stop that
                    // bubbling handler after the router takes over the link.
                    if (hasInlineLocationNavigation) event.stopPropagation();
                    event.preventDefault();
                    window.__EHTW_SPA_NAVIGATE__(targetUrl.href, {
                        // Keep one browser-history entry for the gallery so
                        // Safari's edge-swipe returns to the source list at once.
                        historyMode: isSameGalleryPagination ? 'replace' : 'push'
                    });
                    return;
                }
                markNavigationPending();
            } catch (_) {}
        }, true);
        addUserScriptListener(document, 'submit', (event) => {
            const form = event.target;
            try {
                const targetUrl = new URL(form?.action || location.href, location.href);
                if (isGallerySiteOrigin(targetUrl.origin) ||
                    isUploadSiteOrigin(targetUrl.origin)) {
                    if (
                        isGallerySiteOrigin(location.origin) &&
                        targetUrl.origin === location.origin &&
                        String(form?.method || 'get').toLowerCase() === 'get' &&
                        window.__EHTW_SPA_READY__ &&
                        typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                    ) {
                        event.preventDefault();
                        const formData = new window.FormData(form);
                        for (const [key, value] of formData.entries()) {
                            if (typeof value === 'string') targetUrl.searchParams.append(key, value);
                        }
                        window.__EHTW_SPA_NAVIGATE__(targetUrl.href, { historyMode: 'push' });
                    } else {
                        markNavigationPending();
                    }
                }
            } catch (_) {}
        }, true);
        addUserScriptListener(window, 'popstate', (event) => {
            const destinationState = recoverSpaHistoryState(location.href, event?.state);
            if (navLogEnabled) navLog('popstate', {
                eventState: summarizeNavLogState(event?.state),
                currentState: summarizeNavLogState(window.history.state),
                recoveredState: summarizeNavLogState(destinationState),
                stateRecovered: !!destinationState.ehtwSpa && !event?.state?.ehtwSpa
            });
            if (destinationState.ehtwSpa) {
                rememberSpaHistoryState(location.href, destinationState);
                if (!window.history.state?.ehtwSpa || !window.history.state?.ehtwEntryId) {
                    queueScrollHistoryStateWrite(location.href, destinationState, destinationState.ehtwScrollY, 'popstate-state-repair');
                }
            }
            let previousUrl;
            let currentUrl;
            try {
                previousUrl = new URL(spaRenderedHref);
                currentUrl = new URL(location.href);
            } catch (_) {}
            if (
                previousUrl && currentUrl &&
                previousUrl.origin === currentUrl.origin &&
                previousUrl.pathname === currentUrl.pathname &&
                previousUrl.search === currentUrl.search
            ) {
                // Hash history entries are in-page navigation, not an SPA
                // route. Keep the existing DOM and allow native anchor scroll.
                spaRenderedHref = location.href;
                return;
            }
            galleryBackTraversalPending = false;
            const previousGalleryId = getGalleryIdFromUrl(spaRenderedHref);
            const destinationGalleryId = getGalleryIdFromUrl(location.href);
            const previousThumbIndex = getGalleryThumbPageIndex(spaRenderedHref);
            const destinationThumbIndex = getGalleryThumbPageIndex(location.href);
            if (
                previousGalleryId &&
                previousGalleryId === destinationGalleryId &&
                spaRenderedHref !== location.href &&
                destinationThumbIndex < previousThumbIndex
            ) {
                // Older sessions may still contain one SPA entry per thumbnail.
                try {
                    window.sessionStorage?.setItem(
                        galleryBackTraversalStorageKey,
                        destinationGalleryId
                    );
                } catch (_) {}
            }
            if (
                isGallerySiteOrigin(location.origin) &&
                typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
            ) {
                window.__EHTW_SPA_NAVIGATE__(location.href, {
                    historyMode: 'pop',
                    historyState: destinationState,
                    scrollY: Number(destinationState.ehtwScrollY) || getSavedSpaScroll(location.href)
                });
            }
        });
        addUserScriptListener(window, 'beforeunload', markNavigationPending);
        addUserScriptListener(window, 'pageshow', (event) => {
            if (event?.persisted) releasePageBoot();
            let explicitRestore = false;
            try {
                explicitRestore = window.sessionStorage?.getItem(
                    spaScrollPageshowRestoreKey(location.href)
                ) === '1';
                if (explicitRestore) {
                    window.sessionStorage?.removeItem(spaScrollPageshowRestoreKey(location.href));
                }
            } catch (_) {}
            let navigationType = '';
            try {
                navigationType = window.performance?.getEntriesByType?.('navigation')?.[0]?.type || '';
            } catch (_) {}
            if (navLogEnabled) navLog('pageshow', {
                persisted: !!event?.persisted,
                navigationType,
                explicitScrollRestore: explicitRestore,
                historyState: summarizeNavLogState(window.history.state)
            });
            if (!shouldRestoreSpaScrollOnPageShow(event, navigationType, explicitRestore, document.referrer, location.href, window.history.state)) return;
            const state = recoverSpaHistoryState(location.href, window.history.state);
            if (!state.ehtwSpa) return;
            const scrollY = Number(state.ehtwScrollY) || getSavedSpaScroll(location.href);
            if (scrollY <= 0) return;
            window.setTimeout(() => restoreSpaScrollPosition(scrollY, 'pageshow'), 0);
            if (!window.history.state?.ehtwSpa || !window.history.state?.ehtwEntryId) {
                queueScrollHistoryStateWrite(location.href, state, scrollY, 'pageshow-state-repair');
            }
        });
    }

    function runMain() {

    const PREFIX = 'ehtw';
    const RUN_KEY = '__EHTW_STYLE_050__';
    const READER_IMAGE_LOAD_TIMEOUT_MS = 30000;
    const READER_IMAGE_PREFETCH_CONCURRENCY = 5;
    const READER_IMAGE_AUTO_RETRY_LIMIT = 2;
    const READER_IMAGE_AUTO_RETRY_DELAYS_MS = [800, 1800];
    // 若在 E-Hentai 设置里改过时区，填写偏移分钟数（东八区 480、东九区 540）；默认 UTC。
    const SITE_UTC_OFFSET_MIN = 0;
    const spaPageEventListeners = [];
    const addSpaPageEventListener = (target, type, listener, options) => {
        if (!target?.addEventListener) return;
        addUserScriptListener(target, type, listener, options);
        spaPageEventListeners.push({ target, type, listener, options });
    };
    const publishSpaPageCleanup = (cleanup) => {
        window.__EHTW_PAGE_CLEANUP__ = () => {
            spaPageEventListeners.splice(0).forEach(({ target, type, listener, options }) => {
                target.removeEventListener?.(type, listener, options);
            });
            if (/^\/mytags\/?$/i.test(location.pathname)) {
                hiddenMyTagsPromise = null;
                watchedMyTagsPagePromise = null;
                try { window.sessionStorage?.removeItem(SEARCH_HIDDEN_TAGS_CACHE_KEY); } catch (_) {}
            }
            window.__EHTW_SPA_READY__ = false;
            cleanup?.();
        };
        window.__EHTW_SPA_READY__ = true;
        window.__EHTW_PAGE_LISTENERS__ = spaPageEventListeners;
        if (isGallerySiteOrigin(location.origin)) {
            const actualState = window.history.state || {};
            const current = recoverSpaHistoryState(location.href, actualState);
            if (!current.ehtwSpa || !current.ehtwEntryId) {
                const referrerWasGallery = !!getGalleryIdFromUrl(document.referrer);
                const initialBackTarget = current.ehtwSpaPreviousHref ||
                    (isListLikePath(location.pathname)
                        ? resolveSpaBackTarget(document.referrer, location.href)
                        : '');
                const initialState = {
                    ...current,
                    ehtwSpa: true,
                    ehtwEntryId: current.ehtwEntryId || newSpaEntryId(),
                    ehtwSpaDepth: readFiniteNumber(current.ehtwSpaDepth) ?? 0,
                    ehtwScrollY: readFiniteNumber(current.ehtwScrollY) ?? getSavedSpaScroll(location.href),
                    ...(isListLikePath(location.pathname) ? {
                        ehtwSpaPreviousHref: initialBackTarget,
                        ehtwSpaReturnBackTarget: !current.ehtwSpaPreviousHref && referrerWasGallery
                    } : {})
                };
                if (historyStateWriteSuppressionReason(location.href)) {
                    queueScrollHistoryStateWrite(location.href, initialState, initialState.ehtwScrollY, 'initial-state-repair');
                } else if (safeReplaceHistoryState(window.history, initialState, '', location.href, 'initial-spa-state')) {
                    rememberSpaHistoryState(location.href, initialState);
                }
                if (isListLikePath(location.pathname)) {
                    try {
                        window.sessionStorage?.setItem(spaBackTargetStorageKey(location.href), initialBackTarget || '/');
                    } catch (_) {}
                }
            } else {
                rememberSpaHistoryState(location.href, current);
                if (!actualState.ehtwSpa || !actualState.ehtwEntryId) {
                    queueScrollHistoryStateWrite(location.href, current, current.ehtwScrollY, 'history-state-repair');
                }
            }
        }
        window.setTimeout(() => replayPendingSpaPopIfReady('spa-ready'), 0);
    };
    function normalizeUploaderName(value) {
        return String(value || '')
            .trim()
            .replace(/[_+]+/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    function normalizeCreatorFollowTag(value) {
        const match = String(value || '').trim().match(/^(artist|group):(.+)$/i);
        if (!match) return '';
        const namespace = match[1].toLowerCase();
        const name = match[2]
            .toLowerCase()
            .replace(/[_+]+/g, ' ')
            .replace(/\s+/g, ' ');
        return `${namespace}:${name}`;
    }

    function isCreatorTagValue(value) {
        let candidate = String(value || '').trim();
        try {
            candidate = decodeURIComponent(candidate);
        } catch (_) {}
        candidate = candidate.replace(/^ta_/i, '');
        return /^(?:artist|group):/i.test(candidate) ||
            /\/tag\/(?:artist|group):/i.test(candidate);
    }

    function getWatchedCreatorTagsFromMyTags(root) {
        const tags = new Set();
        const tagSetEnabled = root?.querySelector?.('#tagset_enable');
        if (tagSetEnabled && !tagSetEnabled.checked) return tags;
        const rows = root?.querySelectorAll?.(
            '#usertags_outer > div[id^="usertag_"]'
        ) || [];

        Array.from(rows).forEach((row) => {
            const watched = row.querySelector('input[id^="tagwatch_"]');
            if (!watched?.checked) return;

            const preview = row.querySelector('[id^="tagpreview_"]');
            const tagName = preview?.getAttribute('title') ||
                preview?.textContent || '';
            if (!/^(?:artist|group):/i.test(tagName.trim())) return;

            const normalized = normalizeCreatorFollowTag(tagName);
            if (normalized) tags.add(normalized);
        });

        return tags;
    }

let watchedMyTagsPagePromise = null;
let hiddenMyTagsPromise = null;
const SEARCH_HIDDEN_TAGS_CACHE_KEY = 'ehtw-search-hidden-tags-v1';
const SEARCH_HIDDEN_TAGS_CACHE_TTL = 60 * 1000;
function readCachedSearchHiddenTags() {
    try {
        const cached = JSON.parse(window.sessionStorage?.getItem(SEARCH_HIDDEN_TAGS_CACHE_KEY) || 'null');
        if (
            !cached ||
            !Number.isFinite(Number(cached.at)) ||
            Date.now() - Number(cached.at) >= SEARCH_HIDDEN_TAGS_CACHE_TTL ||
            !Array.isArray(cached.tags)
        ) return null;
        return new Set(cached.tags.map((tag) => String(tag || '').trim()).filter(Boolean));
    } catch (_) {
        return null;
    }
}

function requestWatchedMyTagsPage() {
    if (!watchedMyTagsPagePromise) {
        watchedMyTagsPagePromise = (async () => {
                const response = await window.fetch('/mytags', {
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                if (!response?.ok) throw new Error('Could not load My Tags');
                const pageText = await response.text();
            return new window.DOMParser().parseFromString(pageText, 'text/html');
            })();
        }
    return watchedMyTagsPagePromise;
}

function requestHiddenMyTags() {
    if (!hiddenMyTagsPromise) {
        hiddenMyTagsPromise = window.fetch('/mytags', {
            credentials: 'same-origin',
            cache: 'no-store'
        }).then(async (response) => {
            if (!response?.ok) throw new Error('Could not load My Tags');
            const page = new window.DOMParser().parseFromString(await response.text(), 'text/html');
            const tags = getHiddenTagsFromMyTags(page);
            try {
                window.sessionStorage?.setItem(SEARCH_HIDDEN_TAGS_CACHE_KEY, JSON.stringify({
                    at: Date.now(),
                    tags: Array.from(tags)
                }));
            } catch (_) {}
            return tags;
        }).catch((error) => {
            hiddenMyTagsPromise = null;
            throw error;
        });
    }
    return hiddenMyTagsPromise;
}

function requestWatchedCreatorTags() {
    return requestWatchedMyTagsPage().then(getWatchedCreatorTagsFromMyTags);
}

function getWatchedUploaderEntriesFromMyTags(root) {
    const entries = new Map();
    const tagSetEnabled = root?.querySelector?.('#tagset_enable');
    if (tagSetEnabled && !tagSetEnabled.checked) return [];
    const rows = root?.querySelectorAll?.(
        '#usertags_outer > div[id^="usertag_"]'
    ) || [];

    Array.from(rows).forEach((row) => {
        const watched = row.querySelector('input[id^="tagwatch_"]');
        if (!watched?.checked) return;
        const preview = row.querySelector('[id^="tagpreview_"]');
        const tag = String(
            preview?.getAttribute('title') || preview?.textContent || ''
        ).trim();
        const match = tag.match(/^uploader:(.+)$/i);
        if (!match) return;
        const name = match[1].trim();
        const key = normalizeUploaderName(name);
        if (!key || entries.has(key)) return;
        entries.set(key, {
            key,
            name,
            href: '/uploader/' + encodeURIComponent(name).replace(/%20/g, '+')
        });
    });

    return Array.from(entries.values());
}

const FOLLOW_UPLOADERS_FAVCAT = 9;
const FOLLOW_UPLOADERS_GALLERY_CACHE_KEY = 'ehtw.followUploaders.galleryNames.v1';
const followedUploaderEntriesPromiseState = { value: null };

    function navigatePage(value) {
        const targetUrl = new URL(value, location.href);
        if (
            targetUrl.origin === location.origin &&
            isGallerySiteOrigin(location.origin) &&
            typeof window.fetch === 'function' &&
            window.__EHTW_SPA_READY__ &&
            typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
        ) {
            return window.__EHTW_SPA_NAVIGATE__(targetUrl.href, { historyMode: 'push' });
        }
        if (navLogEnabled) navLog('script-navigation-call', { method: 'location.assign', source: 'navigatePage', targetPath: targetUrl.pathname, stack: navLogStack() });
        location.assign(targetUrl.href);
        return false;
    }

function extractFavoriteGalleryPaths(root) {
    const paths = new Set();
    Array.from(root?.querySelectorAll?.('table.itg.gltc a[href], table.itg.gltm a[href], table.itg.glte a[href], div.itg.gld a[href]') || []).forEach((link) => {
        const href = link.getAttribute('href') || link.href;
        try {
            const url = new URL(href, window.location.origin);
            if (url.origin !== window.location.origin) return;
            if (!/^\/g\/\d+\/[0-9a-f]+\/?$/i.test(url.pathname)) return;
            paths.add(url.pathname);
        } catch (_) {}
    });
    return Array.from(paths);
}

function isNativeNavigationLoggedIn(root) {
    const links = Array.from(root?.querySelectorAll?.('a[href]') || []);
    const labels = links.map((link) => String(link.textContent || '').trim());
    const hrefs = links.map((link) => String(link.getAttribute?.('href') || link.href || ''));
    if (labels.some((label) => /^(?:log\s*in|login|sign\s*in)$/i.test(label)) ||
        hrefs.some((href) => /act=Login&CODE=00/i.test(href))) {
        return false;
    }
    return labels.some((label) => /^(?:my\s+tags|my\s+uploads?|my\s+home)$/i.test(label)) ||
        hrefs.some((href) => /(?:\/mytags|\/home\.php|\/upld\/manage)/i.test(href));
}

function getNativeAccountActionUrl(isLoggedIn) {
    const code = isLoggedIn ? '03' : '00';
    return `https://forums.e-hentai.org/index.php?act=Login&CODE=${code}`;
}

function findFollowUploaderFavoriteNextUrl(root, currentHref) {
    let currentUrl;
    try {
        currentUrl = new URL(currentHref, window.location.href);
    } catch (_) {
        return null;
    }
    const currentPage = Number.parseInt(currentUrl.searchParams.get('page') || '0', 10);
    const candidates = [];
    const directNext = root?.querySelector?.('#dnext[href], a[rel~="next"][href]');
    if (directNext) candidates.push(directNext);
    candidates.push(...Array.from(root?.querySelectorAll?.('.searchnav a[href]') || []));

    return candidates
        .map((link) => {
            try {
                return new URL(link.getAttribute('href') || link.href, currentUrl.href);
            } catch (_) {
                return null;
            }
        })
        .filter((url) =>
            url &&
            url.origin === currentUrl.origin &&
            url.pathname === currentUrl.pathname &&
            url.searchParams.get('favcat') === String(FOLLOW_UPLOADERS_FAVCAT) &&
            Number.parseInt(url.searchParams.get('page') || '0', 10) > currentPage
        )
        .sort((a, b) =>
            Number.parseInt(a.searchParams.get('page'), 10) -
            Number.parseInt(b.searchParams.get('page'), 10)
        )[0]?.href || null;
}

async function requestFollowUploadersFavoritePaths() {
    const paths = new Set();
    const seenPages = new Set();
    let pageUrl = new URL('/favorites.php', window.location.origin);
    pageUrl.searchParams.set('favcat', String(FOLLOW_UPLOADERS_FAVCAT));

    for (let pageCount = 0; pageUrl && pageCount < 100; pageCount += 1) {
        const requestUrl = pageUrl.href;
        if (seenPages.has(requestUrl)) break;
        seenPages.add(requestUrl);
        const response = await window.fetch(requestUrl, {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!response?.ok) {
            throw new Error(`收藏夹读取失败：${response?.status || '无响应'}（${requestUrl}）`);
        }
        const page = new window.DOMParser().parseFromString(await response.text(), 'text/html');
        extractFavoriteGalleryPaths(page).forEach((path) => paths.add(path));
        const nextUrl = findFollowUploaderFavoriteNextUrl(page, requestUrl);
        pageUrl = nextUrl ? new URL(nextUrl) : null;
    }
    return Array.from(paths);
}

async function loadFollowedUploaderEntries(forceRefresh = false) {
    if (!forceRefresh && followedUploaderEntriesPromiseState.value) {
        return followedUploaderEntriesPromiseState.value;
    }
    const loadPromise = (async () => {
        const paths = await requestFollowUploadersFavoritePaths();
        const entries = new Map();
        let uploaderByPath = {};
        try {
            uploaderByPath = JSON.parse(
                window.localStorage.getItem(FOLLOW_UPLOADERS_GALLERY_CACHE_KEY) || '{}'
            ) || {};
        } catch (_) {}
        let cursor = 0;
        const worker = async () => {
            while (cursor < paths.length) {
                const path = paths[cursor++];
                try {
                    let name = String(uploaderByPath[path] || '').trim();
                    if (!name) {
                        const response = await window.fetch(path, {
                            credentials: 'same-origin',
                            cache: 'no-store'
                        });
                        if (!response?.ok) continue;
                        const detail = new window.DOMParser().parseFromString(
                            await response.text(), 'text/html'
                        );
                        const uploaderLink = detail.querySelector('#gdn a[href*="/uploader/"]');
                        name = String(uploaderLink?.textContent || '').trim();
                        if (name) uploaderByPath[path] = name;
                    }
                    const key = normalizeUploaderName(name);
                    if (!key) continue;
                    if (!entries.has(key)) {
                        entries.set(key, {
                            key,
                            name,
                            href: '/uploader/' + encodeURIComponent(name).replace(/%20/g, '+'),
                            galleryPaths: []
                        });
                    }
                    entries.get(key).galleryPaths.push(path);
                } catch (_) {}
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, paths.length) }, worker));
        try {
            window.localStorage.setItem(
                FOLLOW_UPLOADERS_GALLERY_CACHE_KEY,
                JSON.stringify(uploaderByPath)
            );
        } catch (_) {}
        return Array.from(entries.values());
    })();
    followedUploaderEntriesPromiseState.value = loadPromise;
    try {
        return await loadPromise;
    } catch (error) {
        followedUploaderEntriesPromiseState.value = null;
        throw error;
    }
}

function requestWatchedUploaderNames() {
    return loadFollowedUploaderEntries();
}

async function submitFavoriteFormLikeBrowser(form, popupUrl, favoriteCategory, favoriteNote = '') {
    const formData = new window.FormData(form);
    formData.set('favcat', String(favoriteCategory));
    if (formData.has('favnote') || favoriteNote !== null) {
        formData.set('favnote', String(favoriteNote || ''));
    }
    const submitValue = form.querySelector('[name="apply"]')?.value || 'Add to Favorites';
    formData.set('apply', submitValue);

    const body = new window.URLSearchParams();
    for (const [name, value] of formData.entries()) {
        if (typeof value === 'string') body.append(name, value);
    }
    const action = new URL(form.getAttribute('action') || popupUrl.href, popupUrl.href);
    return window.fetch(action.href, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        referrer: popupUrl.href,
        referrerPolicy: 'same-origin',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: body.toString()
    });
}

async function setGalleryInFollowUploadersFavorites(galleryHref, shouldFollow) {
    const galleryUrl = new URL(galleryHref, window.location.href);
    const match = galleryUrl.pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?$/i);
    if (galleryUrl.origin !== window.location.origin || !match) {
        throw new Error('无法识别这本漫画的收藏链接。');
    }
    const popupUrl = new URL('/gallerypopups.php', window.location.origin);
    popupUrl.searchParams.set('gid', match[1]);
    popupUrl.searchParams.set('t', match[2]);
    popupUrl.searchParams.set('act', 'addfav');
    const popupResponse = await window.fetch(popupUrl.href, {
        credentials: 'same-origin',
        cache: 'no-store'
    });
    if (!popupResponse?.ok) throw new Error('无法打开原站收藏表单。');
    const popup = new window.DOMParser().parseFromString(
        await popupResponse.text(), 'text/html'
    );
    const form = popup.querySelector('#galpop');
    if (!form) throw new Error('原站没有返回收藏表单，请稍后重试。');
    const result = await submitFavoriteFormLikeBrowser(
        form,
        popupUrl,
        shouldFollow ? String(FOLLOW_UPLOADERS_FAVCAT) : 'favdel',
        ''
    );
    if (!result?.ok) throw new Error(`收藏操作失败：${result?.status || '无响应'}`);
    followedUploaderEntriesPromiseState.value = null;
    await loadFollowedUploaderEntries(true);
}

function getWatchedMyTagsApiConfig(root) {
    const inlineScript = Array.from(root?.querySelectorAll?.('script') || [])
        .filter((script) => !script.src)
        .map((script) => script.textContent || '')
        .join('\n');
    const apiUrl = inlineScript.match(/\bapi_url\s*=\s*["']([^"']+)["']/)?.[1] || '';
    const apiUid = inlineScript.match(/\bapiuid\s*=\s*["']?(\d+)["']?/)?.[1] || '';
    const apiKey = inlineScript.match(/\bapikey\s*=\s*["']([^"']+)["']/)?.[1] || '';
    if (!apiUrl || !apiUid || !apiKey) return null;
    return { apiUrl, apiUid: Number(apiUid), apiKey };
}

function toggleWatchedTagInMyTags(tag, onComplete = () => {}) {
    const isUploader = /^uploader:/i.test(String(tag || ''));
    const normalizedTag = isUploader
        ? normalizeUploaderName(String(tag).replace(/^uploader:/i, ''))
        : normalizeCreatorFollowTag(tag);
    if (!normalizedTag) {
        onComplete(false, false);
        return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;bottom:0;opacity:0;border:0;pointer-events:none';
    let phase = 'load';
    let srcdocAssigned = false;
    let finished = false;
    let verifyPromise = null;
    let timeoutId = null;

    const finish = (success, isWatched, reason = '') => {
        if (finished) return;
        finished = true;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        iframe.remove();
        watchedMyTagsPagePromise = null;
        onComplete(success, isWatched, reason);
    };

    const verifySavedState = () => {
        if (finished) return Promise.resolve();
        if (verifyPromise) return verifyPromise;
        verifyPromise = (async () => {
            let lastState = null;
            // Native My Tags saves asynchronously. Allow the server enough time to
            // commit before reporting failure, especially on mobile connections.
            for (let attempt = 0; attempt < 16; attempt += 1) {
                watchedMyTagsPagePromise = null;
                try {
                    const page = await requestWatchedMyTagsPage();
                    const watched = isUploader
                        ? getWatchedUploaderEntriesFromMyTags(page).some((entry) => entry.key === normalizedTag)
                        : getWatchedCreatorTagsFromMyTags(page).has(normalizedTag);
                    lastState = watched;
                    if (watched === phaseTargetState) {
                        finish(true, watched);
                        return;
                    }
                } catch (_) {}
                await new Promise((resolve) => window.setTimeout(resolve, 750));
            }
            finish(false, lastState, 'My Tags 暂未确认保存，请检查标签设置是否启用后重试。');
        })();
        return verifyPromise;
    };

    let phaseTargetState = null;
    iframe.addEventListener('load', () => {
        // Ignore the initial about:blank load; only the fetched srcdoc is
        // allowed to enter the native My Tags form handling path.
        if (!srcdocAssigned) return;
        if (phase !== 'saving' && timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (phase === 'saving') {
            verifySavedState();
            return;
        }

        const page = iframe.contentDocument;
        const form = page?.querySelector('#usertag_form');
        if (!form) {
            finish(false, null, '无法打开 My Tags 保存表单，请确认账号仍处于登录状态。');
            return;
        }
        const frameWindow = page.defaultView;
        if (frameWindow) safeReplaceHistoryState(
            frameWindow.history,
            null,
            '',
            new URL('/mytags', window.location.origin).href,
            'mytags-iframe-route'
        );
        form.action = new URL('/mytags', window.location.origin).href;
        const tagSetEnabled = page.querySelector('#tagset_enable');
        if (tagSetEnabled && !tagSetEnabled.checked) {
            finish(false, null, 'My Tags 的标签关注已停用，请先启用标签设置。');
            return;
        }

        const rows = Array.from(page.querySelectorAll(
            '#usertags_outer > div[id^="usertag_"]'
        ));
        const row = rows.find((candidate) => {
            const preview = candidate.querySelector('[id^="tagpreview_"]');
            const name = preview?.getAttribute('title') || preview?.textContent || '';
            return isUploader
                ? normalizeUploaderName(String(name).trim().replace(/^uploader:/i, '')) === normalizedTag
                : normalizeCreatorFollowTag(name) === normalizedTag;
        });
        const watch = row
            ? row.querySelector('input[id^="tagwatch_"]')
            : page.querySelector('#tagwatch_0');
        if (!watch) {
            finish(false, null, 'My Tags 中找不到可保存的标签行。');
            return;
        }

        phaseTargetState = !row || !watch.checked;
        if (!row) {
            const nameInput = page.querySelector('#tagname_new');
            if (!nameInput) {
                finish(false, null, 'My Tags 中找不到新标签输入框。');
                return;
            }
            nameInput.value = isUploader
                ? `uploader:${String(tag).replace(/^uploader:/i, '').trim()}`
                : tag;
        }

        watch.checked = phaseTargetState;
        watch.dispatchEvent(new (page.defaultView || window).Event('change', { bubbles: true }));
        const rowId = row?.id.match(/_(\d+)$/)?.[1] || '0';
        const save = page.querySelector(`#tagsave_${rowId}`);
        if (!save || save.disabled) {
            finish(false, null, 'My Tags 保存按钮未启用，标签没有提交。');
            return;
        }

        phase = 'saving';
        save.click();
        timeoutId = window.setTimeout(() => {
            finish(false, null, 'My Tags 保存确认超时，请稍后重试。');
        }, 15000);
        window.setTimeout(verifySavedState, 500);
    });

    timeoutId = window.setTimeout(() => {
        finish(false, null, 'My Tags 页面加载超时，请稍后重试。');
    }, 20000);

    // The site may refuse a direct /mytags navigation inside an iframe. Fetch
    // the same-origin page first, then load its native editor as srcdoc so the
    // page's own save handlers can run without navigating the visible tab.
    (async () => {
        try {
            const response = await window.fetch('/mytags', {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response?.ok) throw new Error('My Tags request failed');
            const pageText = await response.text();
            if (finished) return;

            const editor = new window.DOMParser().parseFromString(pageText, 'text/html');
            if (!editor.querySelector('#usertag_form')) {
                finish(false, null, 'My Tags 返回内容中没有保存表单，请确认已登录。');
                return;
            }

            const editorTagSetEnabled = editor.querySelector('#tagset_enable');
            if (editorTagSetEnabled && !editorTagSetEnabled.checked) {
                finish(false, null, 'My Tags 的标签关注已停用，请先启用标签设置。');
                return;
            }
            const editorRows = Array.from(editor.querySelectorAll(
                '#usertags_outer > div[id^="usertag_"]'
            ));
            const existingRow = editorRows.find((candidate) => {
                const preview = candidate.querySelector('[id^="tagpreview_"]');
                const name = preview?.getAttribute('title') || preview?.textContent || '';
                return isUploader
                    ? normalizeUploaderName(String(name).trim().replace(/^uploader:/i, '')) === normalizedTag
                    : normalizeCreatorFollowTag(name) === normalizedTag;
            });

            if (existingRow) {
                const watch = existingRow.querySelector('input[id^="tagwatch_"]');
                const rowId = existingRow.id.match(/_(\d+)$/)?.[1];
                const api = getWatchedMyTagsApiConfig(editor);
                if (!watch || !rowId || !api) {
                    finish(false, null, '无法读取 My Tags 的标签更新参数。');
                    return;
                }

                phaseTargetState = !watch.checked;
                const payload = {
                    method: 'setusertag',
                    apiuid: api.apiUid,
                    apikey: api.apiKey,
                    tagid: Number(rowId),
                    tagwatch: phaseTargetState ? 1 : 0,
                    taghide: phaseTargetState
                        ? 0
                        : (existingRow.querySelector(`#taghide_${rowId}`)?.checked ? 1 : 0),
                    tagcolor: existingRow.querySelector(`#tagcolor_${rowId}`)?.value || '',
                    tagweight: existingRow.querySelector(`#tagweight_${rowId}`)?.value || '10'
                };

                try {
                    if (timeoutId !== null) window.clearTimeout(timeoutId);
                    timeoutId = window.setTimeout(() => {
                        finish(false, null, 'My Tags API 保存超时，请稍后重试。');
                    }, 30000);
                    const result = await new Promise((resolve, reject) => {
                        const xhr = new window.XMLHttpRequest();
                        let settled = false;
                        const fail = (message) => {
                            if (settled) return;
                            settled = true;
                            reject(new Error(message));
                        };
                        xhr.open('POST', api.apiUrl, true);
                        xhr.withCredentials = true;
                        xhr.timeout = 20000;
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        xhr.onreadystatechange = () => {
                            if (xhr.readyState !== 4 || settled) return;
                            settled = true;
                            if (xhr.status !== 200) {
                                reject(new Error(`Server communication failed: ${xhr.status}`));
                                return;
                            }
                            try {
                                resolve(JSON.parse(xhr.responseText));
                            } catch (_) {
                                reject(new Error('My Tags API returned invalid JSON'));
                            }
                        };
                        xhr.onerror = () => fail(`Server communication failed: ${xhr.status}`);
                        xhr.ontimeout = () => fail('My Tags API request timed out');
                        xhr.send(JSON.stringify(payload));
                    });
                    if (result?.login) {
                        throw new Error('Please sign in again');
                    }
                    if (result?.error) {
                        throw new Error(String(result.error));
                    }
                    watchedMyTagsPagePromise = null;
                    verifySavedState();
                } catch (error) {
                    finish(
                        false,
                        null,
                        `My Tags API 保存失败：${String(error?.message || error)}`
                    );
                }
                return;
            }

            if (isUploader) {
                finish(
                    false,
                    null,
                    'My Tags 返回“No matching tag found”：它不接受 uploader:<名称> 标签，无法在此保存上传者关注。'
                );
                return;
            }

            let base = editor.querySelector('base');
            if (!base) {
                base = editor.createElement('base');
                editor.head.prepend(base);
            }
            base.href = new URL('/mytags', window.location.origin).href;
            srcdocAssigned = true;
            iframe.srcdoc = `<!doctype html>${editor.documentElement.outerHTML}`;
            document.body.appendChild(iframe);
        } catch (_) {
            finish(false, null, '无法读取 My Tags 页面，请确认账号仍处于登录状态。');
        }
    })();
}

function followUploaderViaFavorites(name, galleryHref, onComplete = () => {}) {
    const key = normalizeUploaderName(name);
    if (!key) {
        onComplete(false, false, '上传者名称无效。');
        return;
    }
    (async () => {
        try {
            const entries = await loadFollowedUploaderEntries();
            const existing = entries.find((entry) => entry.key === key);
            const shouldFollow = !existing;
            const paths = shouldFollow
                ? [new URL(galleryHref, window.location.href).pathname]
                : existing.galleryPaths;
            if (!paths.length) throw new Error('收藏夹中没有可移除的漫画标记。');
            for (const path of paths) {
                await setGalleryInFollowUploadersFavorites(path, shouldFollow);
            }
            const updated = await loadFollowedUploaderEntries(true);
            const isFollowed = updated.some((entry) => entry.key === key);
            if (isFollowed !== shouldFollow) {
                throw new Error('收藏夹已提交，但上传者状态尚未确认，请刷新后检查。');
            }
            onComplete(true, isFollowed, '');
        } catch (error) {
            onComplete(false, false, String(error?.message || error));
        }
    })();
}

    function resolveGalleryReturnHref(storedHref, referrer, origin, galleryId) {
        for (const value of [storedHref, referrer]) {
            if (!value) continue;

            try {
                const url = new URL(value, origin);
                if (
                    url.origin === origin &&
                    getGalleryIdFromUrl(url.href) !== galleryId
                ) {
                    return url.href;
                }
            } catch (_) {}
        }

        return '/';
    }

function resolveSearchBackHref(previousHref, currentHref, origin, sessionStorage) {
    const previousGalleryId = getGalleryIdFromUrl(previousHref, currentHref);
    if (!previousGalleryId) return previousHref || '/';
    try {
        const storedListHref = sessionStorage?.getItem(`ehtw-gallery-return-v1:${previousGalleryId}`);
        if (storedListHref) {
            const targetHref = resolveGalleryReturnHref(storedListHref, '', origin, previousGalleryId);
            if (new URL(targetHref, currentHref).href !== new URL(currentHref).href) return targetHref;
        }
    } catch (_) {}
    // Never send a Search/list page back into a detail page just because the
    // document referrer survived a same-document return from that gallery.
    return '/';
}

function getReaderImagePriority(pageNumber, centerPageNumber, targetPageNumber, forwardCount = 5, fallbackHigh = false) {
        if (
            Number.isFinite(targetPageNumber) &&
            pageNumber === targetPageNumber
        ) {
            return 'high';
        }

        if (
            Number.isFinite(pageNumber) &&
            Number.isFinite(centerPageNumber)
        ) {
            const distance = Math.abs(pageNumber - centerPageNumber);
            if (distance === 0) return 'high';
            if (distance <= forwardCount) return distance === 1 ? 'high' : 'auto';
            return 'low';
        }

        return fallbackHigh ? 'high' : 'low';
    }

    function getReaderImagePreloadGroups(imageCount, centerIndex, preloadCount) {
        if (!Number.isFinite(imageCount) || !Number.isFinite(centerIndex)) return [];
        const count = Math.max(0, Math.floor(imageCount));
        if (count === 0) return [];
        const center = Math.max(0, Math.min(count - 1, Math.floor(centerIndex)));
        const radius = Math.max(0, Math.floor(preloadCount));
        const groups = [[center]];

        for (let distance = 1; distance <= radius; distance += 1) {
            const group = [];
            const nextIndex = center + distance;
            const previousIndex = center - distance;
            if (nextIndex < count) group.push(nextIndex);
            if (previousIndex >= 0) group.push(previousIndex);
            if (group.length) groups.push(group);
        }

        return groups;
    }

    const continueGalleryBackTraversal = () => {
        try {
            const routeState = recoverSpaHistoryState(location.href, window.history.state);
            const targetGalleryId = window.sessionStorage?.getItem(
                galleryBackTraversalStorageKey
            );
            if (!targetGalleryId) {
                galleryBackTraversalPending = false;
                return false;
            }

            if (navLogEnabled) navLog('gallery-back-traversal-check', {
                targetGalleryId,
                alreadyPending: galleryBackTraversalPending,
                historyState: summarizeNavLogState(routeState)
            });

            if (getGalleryIdFromUrl(location.href) !== targetGalleryId) {
                window.sessionStorage?.removeItem(galleryBackTraversalStorageKey);
                galleryBackTraversalPending = false;
                return false;
            }

            // runMain() and navigateSpa() can both reach this helper for the
            // same restored route. Schedule only one history step per route.
            if (galleryBackTraversalPending) return true;

            if (window.history.length <= 1) {
                window.sessionStorage?.removeItem(galleryBackTraversalStorageKey);
                galleryBackTraversalPending = false;
                return false;
            }

            galleryBackTraversalPending = true;
            if (navLogEnabled) navLog('gallery-back-traversal-trigger', {
                targetGalleryId,
                historyLength: window.history.length,
                historyState: summarizeNavLogState(routeState)
            });
            if (routeState?.ehtwSpaRoute) {
                window.setTimeout(() => window.history.back(), 0);
            } else {
                window.history.back();
            }
            return true;
        } catch (_) {
            galleryBackTraversalPending = false;
            return false;
        }
    };
    // The SPA router lives outside runMain(), while this traversal helper
    // closes over page-local gallery state. Expose the active closure so a
    // restored list can continue walking back past thumbnail-page entries.
    window.__EHTW_CONTINUE_GALLERY_BACK_TRAVERSAL__ = continueGalleryBackTraversal;

    if (continueGalleryBackTraversal() && !window.history.state?.ehtwSpaRoute) {
        releasePageBoot();
        return;
    }
    addSpaPageEventListener(window, 'pageshow', continueGalleryBackTraversal);

    // Expose the running version for local diagnostics without adding UI.
    document.documentElement.dataset.ehtwScriptVersion = '1.17.276';
    try {
        const paintEntries = window.performance?.getEntriesByType?.('paint') || [];
        const firstPaint = paintEntries.find((entry) => entry.name === 'first-paint') ||
            paintEntries.find((entry) => entry.name === 'first-contentful-paint');
        if (Number.isFinite(ehtwScriptBootTime) && firstPaint) {
            document.documentElement.dataset.ehtwBootAfterFirstPaint = String(
                ehtwScriptBootTime > firstPaint.startTime
            );
            document.documentElement.dataset.ehtwBootFirstPaintDeltaMs = String(
                Math.round(ehtwScriptBootTime - firstPaint.startTime)
            );
        }
    } catch (_) {}

    if (window[RUN_KEY]) {
        releasePageBoot();
        return;
    }

    const path = location.pathname;

    // 原站连续阅读器：默认纵向滚动，按需预载后续图片。
    if (/^\/s\//i.test(path)) {
        const readerImage =
            document.querySelector('#img') ||
            document.querySelector('#i3 img');

        // 不是实际图片阅读页时，保持原站页面不变。
        if (!readerImage) {
            releasePageBoot();
            return;
        }

        // The native image's inline onerror calls nl(), which navigates the
        // document to ?nl=... when an image fails. The custom reader owns image
        // failure and retry handling, so detach that native navigation hook.
        readerImage.removeAttribute('onerror');
        readerImage.onerror = null;

        // ehg_show.c.js binds its own resize handler to update_window_extents(),
        // which assumes the native #img and #i1 nodes remain in the page. The
        // custom reader replaces that image surface, so keep the native
        // callback from dereferencing the removed #img on viewport changes or
        // its already-scheduled 50ms callback. The reader installs its own
        // resize handler below.
        try { window.onresize = null; } catch (_) {}
        try {
            if (typeof window.update_window_extents === 'function') {
                window.update_window_extents = () => {};
            }
        } catch (_) {}

        window[RUN_KEY] = true;

        let readerStyle = null;
        let readerRoot = null;
        let readerControls = null;
        let readerPageTools = null;
        let readerPageTransition = null;
        let readerTransitionMessage = null;
        let updateBottomReaderStatus = () => {};
        const imageLoadWatchdogCallbacks = new WeakMap();
        let readerViewportMeta = null;
        let readerViewportCreated = false;
        let originalViewportContent = null;
        let originalParent = readerImage.parentNode;
        let originalNext = readerImage.nextSibling;
        const originalClass = readerImage.getAttribute('class');
        const originalImageSrc = readerImage.getAttribute('src');
        const originalImageSrcset = readerImage.getAttribute('srcset');
        const originalImageDataSrc = readerImage.getAttribute('data-src');
        const readerModeStorageKey = 'ehtw-reader-mode-v1';
        const readerZoomStorageKey = 'ehtw-reader-zoom-percent-v1';
        let resizeHandler = null;
        let readerInitializing = true;
        let lastReaderScrollY = window.scrollY;
        let suppressReaderScrollUntil = 0;
        let observer = null;
        let previousObserver = null;
        let pageObserver = null;
        let imageMemoryObserver = null;
        let pageSliderDragActive = false;
        let pageSliderReleaseHandler = null;
        let pageSliderCancelHandler = null;
        let updateReaderPageToolsViewport = () => {};
        let readerViewportUpdateRaf = 0;
        let wheelPagingHandler = null;
        let keyPagingHandler = null;
        let wheelUnlockTimer = null;
        let wheelGestureLocked = false;
        let scrollFallback = null;
        let readerChromeFadeTimer = null;
        // 1.17.255: a centre tap while natively zoomed asks for the chrome.
        // It stays hidden while the page moves and reappears once it settles.
        let readerZoomChromeRequested = false;
        let toggleReaderChromeWhileZoomed = () => false;
        // 1.17.261: Safari-style auto-hide in scroll mode. Scrolling down slides
        // the chrome away, scrolling up (or a centre tap) brings it back.
        let readerProgrammaticScrollAt = 0;
        let showReaderScrollHiddenChrome = () => false;
        let readerTouchActive = false;
        let readerTouchStartedOnChrome = false;
        let readerTouchStartViewport = null;
        let readerZoomResizeCount = 0;
        let readerZoomScrollRewriteCount = 0;
        let readerZoomUserScrollRewriteCount = 0;
        let readerZoomViewportEventCount = 0;
        let readerZoomNonUserScrollJumpCount = 0;
        let readerZoomLastScrollJump = 0;
        let readerZoomMaximumScale = 1;
        let readerZoomDiagnosticCount = 0;
        let readerZoomLastViewportScrollY = null;
        const readerLayoutWidth = () => document.documentElement.clientWidth || window.innerWidth || 0;
        const readerLayoutHeight = () => document.documentElement.clientHeight || window.innerHeight || 0;
        const isMobileReaderViewport = () => {
            try {
                return typeof window.matchMedia === 'function'
                    ? window.matchMedia('(max-width: 699px)').matches
                    : readerLayoutWidth() <= 699;
            } catch (_) {
                return readerLayoutWidth() <= 699;
            }
        };
        const isNativeReaderZoomed = () => Number(window.visualViewport?.scale) > 1.01;
        const recordReaderScrollRewrite = (userInitiated = false) => {
            readerProgrammaticScrollAt = performance.now();
            if (!isNativeReaderZoomed()) return;
            if (userInitiated) readerZoomUserScrollRewriteCount++;
            else readerZoomScrollRewriteCount++;
        };
        const imageListeners = [];
        const preloadStorageKey = 'ehtw-reader-preload-count-v2';
        const pageLinkPreloadStorageKey = 'ehtw-reader-page-link-preload-count-v1';

        try {
            readerViewportMeta = document.querySelector(
                'meta[name="viewport"]'
            );

            if (readerViewportMeta) {
                originalViewportContent =
                    readerViewportMeta.getAttribute('content');
                const normalizedViewport = /width\s*=\s*device-width/i.test(originalViewportContent || '')
                    ? String(originalViewportContent || 'width=device-width, initial-scale=1')
                    : 'width=device-width, initial-scale=1';
                const edgeToEdgeViewport = /viewport-fit\s*=/i.test(normalizedViewport)
                    ? normalizedViewport.replace(/viewport-fit\s*=\s*[^,]+/i, 'viewport-fit=cover')
                    : `${normalizedViewport.replace(/,\s*$/, '')}, viewport-fit=cover`;
                readerViewportMeta.setAttribute('content', edgeToEdgeViewport);
            } else {
                readerViewportMeta = document.createElement('meta');
                readerViewportMeta.setAttribute('name', 'viewport');
                readerViewportMeta.setAttribute(
                    'content',
                    'width=device-width, initial-scale=1, viewport-fit=cover'
                );
                document.head.appendChild(readerViewportMeta);
                readerViewportCreated = true;
            }

            const safePageUrl = (value, baseUrl) => {
                if (!value) return null;

                try {
                    const url = new URL(value, baseUrl);

                    if (
                        url.origin !== location.origin ||
                        !/^\/s\//i.test(url.pathname)
                    ) {
                        return null;
                    }

                    return url.href;
                } catch (_) {
                    return null;
                }
            };

            const findPageLink = (root, direction, baseUrl) => {
                const id = direction === 'previous' ? '#prev' : '#next';
                const rel = direction === 'previous' ? 'prev' : 'next';
                const direct =
                    root.querySelector(id) ||
                    root.querySelector(`a[rel="${rel}"]`);
                const directHref = direct?.getAttribute('href') || direct?.href;
                const safeDirectHref = safePageUrl(directHref, baseUrl);

                if (safeDirectHref) return safeDirectHref;

                const labels = direction === 'previous'
                    ? /\b(prev|previous|back)\b|上一页|前一页|<\s*prev/i
                    : /\b(next|forward)\b|下一页|后一页|next\s*>/i;

                return Array.from(
                    root.querySelectorAll('a[href]')
                ).find((link) => {
                    const href = safePageUrl(
                        link.getAttribute('href') || link.href,
                        baseUrl
                    );
                    const label = [
                        link.textContent,
                        link.getAttribute('title'),
                        link.getAttribute('aria-label')
                    ].filter(Boolean).join(' ');

                    return !!href && labels.test(label);
                }) || null;
            };

            const currentPageUrl = location.href;
            const readPagePosition = (root, pageUrl) => {
                const navigation = root.querySelector('#i2');
                const text = navigation?.innerText || navigation?.textContent || '';
                const textMatch = String(text).match(
                    /(?:^|\D)(\d+)\s*\/\s*(\d+)(?=\D|$)/
                );
                const dimensionsMatch = String(
                    navigation?.textContent || ''
                ).match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
                let pageMatch = null;
                let totalFromLinks = 0;

                try {
                    pageMatch = new URL(pageUrl, currentPageUrl)
                        .pathname.match(/-(\d+)\/?$/);
                } catch (_) {}

                Array.from(
                    navigation?.querySelectorAll('a[href]') || []
                ).forEach((link) => {
                    try {
                        const url = new URL(
                            link.getAttribute('href') || link.href,
                            pageUrl
                        );
                        const match = url.pathname.match(/-(\d+)\/?$/);

                        if (
                            url.origin === location.origin &&
                            /^\/s\//i.test(url.pathname) &&
                            match
                        ) {
                            totalFromLinks = Math.max(
                                totalFromLinks,
                                Number.parseInt(match[1], 10)
                            );
                        }
                    } catch (_) {}
                });

                return {
                    page: pageMatch
                        ? Number.parseInt(pageMatch[1], 10)
                        : textMatch
                            ? Number.parseInt(textMatch[1], 10)
                            : null,
                    total: totalFromLinks || (textMatch
                        ? Number.parseInt(textMatch[2], 10)
                        : null),
                    width: dimensionsMatch
                        ? Number.parseInt(dimensionsMatch[1], 10)
                        : null,
                    height: dimensionsMatch
                        ? Number.parseInt(dimensionsMatch[2], 10)
                        : null
                };
            };

            const initialPagePosition = readPagePosition(
                document,
                currentPageUrl
            );
            let totalPages = initialPagePosition.total;
            let galleryIndexUrl = null;
            try {
                const galleryLink = Array.from(
                    document.querySelectorAll('a[href]')
                ).find((link) => {
                    try {
                        const url = new URL(
                            link.getAttribute('href') || link.href,
                            currentPageUrl
                        );
                        return url.origin === location.origin && /^\/g\/\d+\//i.test(url.pathname);
                    } catch (_) {
                        return false;
                    }
                });
                if (galleryLink) {
                    const url = new URL(
                        galleryLink.getAttribute('href') || galleryLink.href,
                        currentPageUrl
                    );
                    url.search = '';
                    url.hash = '';
                    galleryIndexUrl = url.href.endsWith('/') ? url.href : `${url.href}/`;
                }
            } catch (_) {}
            const galleryIndexCache = new Map();
            let galleryIndexBlockedUntil = 0;
            const galleryIndexFetchPromises = new Map();
            const knownPageUrls = new Map();
            const galleryPageInfoCache = new Map();
            const galleryPageInfoFetchPromises = new Map();
            const galleryPageInfoFetchWaiters = [];
            let activeGalleryPageInfoFetches = 0;
            if (initialPagePosition.page) {
                knownPageUrls.set(initialPagePosition.page, currentPageUrl);
            }
            const currentPreviousUrl = findPageLink(
                document,
                'previous',
                currentPageUrl
            );
            let previousPageUrl =
                currentPreviousUrl === currentPageUrl
                    ? null
                    : currentPreviousUrl;
            let nextPageUrl = findPageLink(
                document,
                'next',
                currentPageUrl
            );

            if (nextPageUrl === currentPageUrl) {
                nextPageUrl = null;
            }

            readerStyle = document.createElement('style');
            readerStyle.textContent = `
                html.ehtw-reader,
                html.ehtw-reader body {
                    min-height: 100%;
                    background: #000 !important;
                    color: #fff !important;
                }

                html.ehtw-reader {
                    scroll-behavior: auto !important;
                    height: auto !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                }

                html.ehtw-reader body {
                    margin: 0 !important;
                    padding: 0 !important;
                    position: static !important;
                    height: auto !important;
                    max-height: none !important;
                    min-height: 100vh !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                }

                html.ehtw-reader:not(.ehtw-reader-click) body {
                    overflow: visible !important;
                }

                html.ehtw-reader body > :not(.ehtw-reader-root) {
                    display: none !important;
                }

                html.ehtw-reader .ehtw-reader-root {
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: stretch !important;
                    min-height: 100vh !important;
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: #000 !important;
                    color: #fff !important;
                }

                html.ehtw-reader .ehtw-reader-images {
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    gap: 0 !important;
                    width: 100% !important;
                    min-width: 0 !important;
                    margin: 0 !important;
                    padding: 56px 0 0 !important;
                    overflow-anchor: none !important;
                    background: #000 !important;
                }

                html.ehtw-reader .ehtw-reader-page-image {
                    position: absolute !important;
                    inset: 0 !important;
                    display: block !important;
                    width: 100% !important;
                    height: 100% !important;
                    min-width: 0 !important;
                    min-height: 0 !important;
                    max-width: 100% !important;
                    max-height: none !important;
                    margin: 0 !important;
                    object-fit: contain !important;
                    background: #000 !important;
                    -webkit-user-drag: none !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    touch-action: manipulation !important;
                }

                html.ehtw-reader .ehtw-reader-image-frame {
                    position: relative !important;
                    display: grid !important;
                    flex: 0 0 auto !important;
                    place-items: center !important;
                    max-width: 100vw !important;
                    margin: 0 auto !important;
                    background: #000 !important;
                }

                html.ehtw-reader .ehtw-reader-loading-spinner {
                    position: absolute !important;
                    inset: 0 !important;
                    z-index: 2 !important;
                    width: 40px !important;
                    height: 40px !important;
                    margin: auto !important;
                    box-sizing: border-box !important;
                    border: 3px solid #444 !important;
                    border-top-color: #fff !important;
                    border-radius: 50% !important;
                    animation: ehtw-reader-spin .8s linear infinite !important;
                    pointer-events: none !important;
                }

                html.ehtw-reader .ehtw-reader-page-transition {
                    position: fixed !important;
                    z-index: 2147482999 !important;
                    inset: 0 !important;
                    display: none !important;
                    align-content: center !important;
                    justify-items: center !important;
                    gap: 12px !important;
                    background: rgb(0 0 0 / 48%) !important;
                    color: #aaa !important;
                    font: 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    pointer-events: none !important;
                }

                html.ehtw-reader.ehtw-reader-page-pending .ehtw-reader-page-transition {
                    display: grid !important;
                }

                html.ehtw-reader.ehtw-reader-page-pending .ehtw-reader-images {
                    visibility: hidden !important;
                }

                html.ehtw-reader .ehtw-reader-page-transition .ehtw-reader-loading-spinner {
                    display: block !important;
                    grid-area: auto !important;
                    width: 48px !important;
                    height: 48px !important;
                }

                html.ehtw-reader .ehtw-reader-retry-button {
                    position: absolute !important;
                    inset: 0 !important;
                    z-index: 3 !important;
                    display: none !important;
                    width: 52px !important;
                    height: 52px !important;
                    margin: auto !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 !important;
                    border: 1px solid #555 !important;
                    border-radius: 50% !important;
                    background: rgb(0 0 0 / 70%) !important;
                    color: #fff !important;
                    cursor: pointer !important;
                }

                html.ehtw-reader .ehtw-reader-image-frame.ehtw-reader-image-failed .ehtw-reader-retry-button {
                    display: inline-flex !important;
                }

                html.ehtw-reader .ehtw-reader-retry-button svg {
                    width: 28px !important;
                    height: 28px !important;
                    fill: none !important;
                    stroke: currentColor !important;
                    stroke-width: 2 !important;
                    stroke-linecap: round !important;
                    stroke-linejoin: round !important;
                }

                html.ehtw-reader .ehtw-reader-image-frame:not(.ehtw-reader-image-loading) .ehtw-reader-loading-spinner {
                    display: none !important;
                }

                @keyframes ehtw-reader-spin {
                    to { transform: rotate(360deg); }
                }

                html.ehtw-reader .ehtw-reader-sentinel {
                    flex: 0 0 1px !important;
                    width: 100% !important;
                    height: 1px !important;
                    background: #000 !important;
                    pointer-events: none !important;
                }

                html.ehtw-reader .ehtw-reader-controls {
                    position: fixed !important;
                    transform-origin: 50% 0 !important;
                    z-index: 2147483000 !important;
                    pointer-events: auto !important;
                    top: 10px !important;
                    left: 50% !important;
                    display: flex !important;
                    flex-wrap: wrap !important;
                    justify-content: center !important;
                    max-width: calc(100vw - 20px) !important;
                    gap: 4px !important;
                    padding: 4px !important;
                    border: 1px solid #1a1a1a !important;
                    border-radius: 999px !important;
                    background: #000 !important;
                    overflow: visible !important;
                    transform: translateX(-50%) !important;
                    will-change: transform !important;
                }

                /* 1.17.263 (user request): the top controls also disappear at
                   once; a bar sliding near the edge keeps Safari's tint. */
                html.ehtw-reader .ehtw-reader-root.ehtw-reader-chrome-scroll-hidden .ehtw-reader-controls {
                    display: none !important;
                    pointer-events: none !important;
                }

                /* 1.17.262 (user request): the bottom tools disappear at once
                   instead of sliding (display:none also stops iOS Safari from
                   extending their colour under its toolbar). */
                html.ehtw-reader .ehtw-reader-root.ehtw-reader-chrome-scroll-hidden .ehtw-reader-page-tools {
                    display: none !important;
                }

                html.ehtw-reader .ehtw-reader-root.ehtw-reader-chrome-moving .ehtw-reader-controls,
                html.ehtw-reader .ehtw-reader-root.ehtw-reader-chrome-moving .ehtw-reader-page-tools {
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transition: none !important;
                }

                html.ehtw-reader .ehtw-reader-page-count {
                    display: inline-flex !important;
                    align-items: center !important;
                    min-height: 32px !important;
                    padding: 0 8px !important;
                    color: #aaa !important;
                    font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    white-space: nowrap !important;
                }

                html.ehtw-reader .ehtw-reader-mode {
                    min-height: 32px !important;
                    padding: 0 12px !important;
                    border: 0 !important;
                    border-radius: 999px !important;
                    background: transparent !important;
                    color: #aaa !important;
                    font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    cursor: pointer !important;
                }

                html.ehtw-reader .ehtw-reader-mode[aria-pressed="true"] {
                    background: #1d9bf0 !important;
                    color: #fff !important;
                }

                html.ehtw-reader .ehtw-reader-page-tools {
                    position: fixed !important;
                    transform-origin: 50% 100% !important;
                    z-index: 2147483647 !important;
                    pointer-events: auto !important;
                    right: max(10px, env(safe-area-inset-right)) !important;
                    bottom: max(10px, env(safe-area-inset-bottom)) !important;
                    left: max(10px, env(safe-area-inset-left)) !important;
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 6px !important;
                    width: min(620px, calc(100vw - 20px)) !important;
                    box-sizing: border-box !important;
                    margin: 0 auto !important;
                    padding: 8px 12px !important;
                    border: 1px solid #222 !important;
                    border-radius: 14px !important;
                    background: rgb(0 0 0 / 94%) !important;
                    color: #fff !important;
                    font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    transform: none !important;
                    will-change: transform !important;
                }

                html.ehtw-reader .ehtw-reader-zoom-controls,
                html.ehtw-reader .ehtw-reader-page-seek {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    gap: 8px !important;
                    min-width: 0 !important;
                }

                html.ehtw-reader .ehtw-reader-zoom-button,
                html.ehtw-reader .ehtw-reader-fit-button {
                    display: inline-flex !important;
                    flex: 0 0 auto !important;
                    align-items: center !important;
                    justify-content: center !important;
                    min-width: 42px !important;
                    min-height: 40px !important;
                    padding: 0 10px !important;
                    border: 1px solid #333 !important;
                    border-radius: 9px !important;
                    background: #111 !important;
                    color: #fff !important;
                    font: 18px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    cursor: pointer !important;
                }

                html.ehtw-reader .ehtw-reader-fit-button {
                    min-width: 52px !important;
                    font-size: 13px !important;
                }

                html.ehtw-reader .ehtw-reader-preload-details {
                    position: relative !important;
                    flex: 0 0 auto !important;
                }

                html.ehtw-reader .ehtw-reader-preload-details > summary {
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 44px !important;
                    min-height: 40px !important;
                    box-sizing: border-box !important;
                    border: 1px solid #333 !important;
                    border-radius: 9px !important;
                    background: #111 !important;
                    color: #ddd !important;
                    font-size: 0 !important;
                    list-style: none !important;
                    cursor: pointer !important;
                }

                html.ehtw-reader .ehtw-reader-preload-details > summary svg {
                    display: block !important;
                    width: 20px !important;
                    height: 20px !important;
                    flex: 0 0 auto !important;
                    color: #fff !important;
                }

                html.ehtw-reader .ehtw-reader-preload-details > summary::-webkit-details-marker {
                    display: none !important;
                }

                html.ehtw-reader .ehtw-reader-preload-popover {
                    position: absolute !important;
                    right: 0 !important;
                    top: calc(100% + 8px) !important;
                    bottom: auto !important;
                    z-index: 2147483001 !important;
                    display: flex !important;
                    align-items: stretch !important;
                    flex-direction: column !important;
                    gap: 8px !important;
                    width: max-content !important;
                    max-width: calc(100vw - 24px) !important;
                    box-sizing: border-box !important;
                    padding: 10px !important;
                    border: 1px solid #333 !important;
                    border-radius: 10px !important;
                    background: #111 !important;
                    color: #ddd !important;
                    font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    white-space: nowrap !important;
                }

                html.ehtw-reader .ehtw-reader-preload-details:not([open]) > .ehtw-reader-preload-popover {
                    display: none !important;
                }

                html.ehtw-reader .ehtw-reader-preload-row {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 12px !important;
                }

                html.ehtw-reader .ehtw-reader-preload-count,
                html.ehtw-reader .ehtw-reader-page-link-preload-count {
                    width: 58px !important;
                    height: 36px !important;
                    box-sizing: border-box !important;
                    padding: 0 4px !important;
                    border: 1px solid #444 !important;
                    border-radius: 8px !important;
                    background: #000 !important;
                    color: #fff !important;
                    font: 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    text-align: center !important;
                }

                html.ehtw-reader .ehtw-reader-zoom-input {
                    width: 58px !important;
                    height: 36px !important;
                    box-sizing: border-box !important;
                    padding: 0 4px !important;
                    border: 1px solid #333 !important;
                    border-radius: 8px !important;
                    background: #000 !important;
                    color: #fff !important;
                    font: 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    text-align: center !important;
                }

                html.ehtw-reader .ehtw-reader-zoom-unit,
                html.ehtw-reader .ehtw-reader-seek-current,
                html.ehtw-reader .ehtw-reader-seek-total {
                    flex: 0 0 auto !important;
                    color: #aaa !important;
                    font-variant-numeric: tabular-nums !important;
                    white-space: nowrap !important;
                }

                html.ehtw-reader .ehtw-reader-page-slider {
                    flex: 1 1 auto !important;
                    width: 100% !important;
                    min-width: 40px !important;
                    height: 32px !important;
                    margin: 0 !important;
                    accent-color: #1d9bf0 !important;
                    cursor: pointer !important;
                    touch-action: pan-x !important;
                }

                html.ehtw-reader .ehtw-reader-seek-status {
                    display: block !important;
                    min-height: 14px !important;
                    visibility: hidden !important;
                    color: #aaa !important;
                    font-size: 12px !important;
                    text-align: center !important;
                }

                html.ehtw-reader .ehtw-reader-seek-status:not(:empty) {
                    visibility: visible !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-page-image {
                    cursor: pointer !important;
                    pointer-events: auto !important;
                }

                html.ehtw-reader.ehtw-reader-click body {
                    height: 100vh !important;
                    height: 100dvh !important;
                    overflow: hidden !important;
                    overflow-anchor: none !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-root,
                html.ehtw-reader.ehtw-reader-click .ehtw-reader-images {
                    height: 100vh !important;
                    min-height: 100vh !important;
                    height: 100dvh !important;
                    min-height: 100dvh !important;
                    overflow: hidden !important;
                    overflow-anchor: none !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-images {
                    flex: 1 1 auto !important;
                    position: relative !important;
                    justify-content: center !important;
                    padding-top: 0 !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-image-frame:not(.ehtw-reader-active) {
                    display: grid !important;
                    position: absolute !important;
                    top: 0 !important;
                    left: 0 !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                }

                html.ehtw-reader.ehtw-reader-zoomed .ehtw-reader-image-frame {
                    max-width: none !important;
                }

                html.ehtw-reader.ehtw-reader-zoomed .ehtw-reader-page-image {
                    max-width: none !important;
                }

                html.ehtw-reader.ehtw-reader-click.ehtw-reader-zoomed .ehtw-reader-images {
                    box-sizing: border-box !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                    padding: 72px 0 124px !important;
                    touch-action: manipulation !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-image-frame.ehtw-reader-active {
                    display: grid !important;
                    position: relative !important;
                    visibility: visible !important;
                    pointer-events: auto !important;
                }

                html.ehtw-reader .ehtw-reader-page-image[data-ehtw-load-failed="true"] {
                    cursor: pointer !important;
                }

                html.ehtw-reader.ehtw-reader-click .ehtw-reader-sentinel,
                html.ehtw-reader .ehtw-reader-settings-hidden .ehtw-reader-controls,
                html.ehtw-reader .ehtw-reader-settings-hidden .ehtw-reader-page-tools {
                    display: none !important;
                }

                html.ehtw-reader .ehtw-reader-preload-setting {
                    display: inline-flex !important;
                    align-items: center !important;
                    gap: 5px !important;
                    padding: 0 8px !important;
                    color: #aaa !important;
                    font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                }

                html.ehtw-reader .ehtw-reader-preload-count {
                    width: 48px !important;
                    height: 28px !important;
                    box-sizing: border-box !important;
                    padding: 0 4px !important;
                    border: 1px solid #333 !important;
                    border-radius: 8px !important;
                    background: #000 !important;
                    color: #fff !important;
                    font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    text-align: center !important;
                }

                @media (max-width: 699px) {
                    html.ehtw-reader .ehtw-reader-controls {
                        top: calc(env(safe-area-inset-top, 0px) + 8px) !important;
                        width: max-content !important;
                        max-width: calc(100vw - 16px) !important;
                        flex-wrap: nowrap !important;
                        padding: 4px !important;
                        gap: 4px !important;
                    }

                    html.ehtw-reader .ehtw-reader-page-tools {
                        right: max(8px, env(safe-area-inset-right)) !important;
                        bottom: max(8px, env(safe-area-inset-bottom)) !important;
                        left: max(8px, env(safe-area-inset-left)) !important;
                        width: calc(100vw - 16px) !important;
                        gap: 4px !important;
                        padding: 6px 8px !important;
                        border-radius: 12px !important;
                    }

                    html.ehtw-reader .ehtw-reader-zoom-controls,
                    html.ehtw-reader .ehtw-reader-page-seek {
                        gap: 6px !important;
                    }

                    html.ehtw-reader .ehtw-reader-zoom-button,
                    html.ehtw-reader .ehtw-reader-fit-button {
                        min-height: 40px !important;
                    }

                    html.ehtw-reader .ehtw-reader-preload-details > summary {
                        width: 40px !important;
                        min-height: 40px !important;
                    }

                    html.ehtw-reader .ehtw-reader-mode {
                        min-height: 44px !important;
                        padding: 0 8px !important;
                        font-size: 15px !important;
                    }

                    html.ehtw-reader .ehtw-reader-page-count {
                        min-height: 44px !important;
                        padding: 0 4px !important;
                        font-size: 14px !important;
                    }

                    html.ehtw-reader .ehtw-reader-preload-setting {
                        min-height: 44px !important;
                        gap: 4px !important;
                        padding: 0 4px !important;
                        font-size: 14px !important;
                    }

                    html.ehtw-reader .ehtw-reader-preload-count {
                        width: 56px !important;
                        height: 40px !important;
                        font-size: 16px !important;
                    }

                    html.ehtw-reader .ehtw-reader-images {
                        padding-top: 0 !important;
                    }

                    html.ehtw-reader.ehtw-reader-click .ehtw-reader-images {
                        justify-content: flex-start !important;
                        padding-top: 0 !important;
                    }
                }
            `;

            document.head.appendChild(readerStyle);
            document.documentElement.classList.add('ehtw-reader');

            readerRoot = document.createElement('main');
            readerRoot.className = 'ehtw-reader-root';

            readerControls = document.createElement('div');
            readerControls.className = 'ehtw-reader-controls';
            readerControls.setAttribute('role', 'group');
            readerControls.setAttribute('aria-label', '阅读方式');

            const readerImages = document.createElement('div');
            readerImages.className = 'ehtw-reader-images';

            let currentPageNumber = initialPagePosition.page;
            let pageSlider = null;
            let zoomInput = null;
            let pageSeekCurrent = null;
            let pageSeekTotal = null;
            let pageSeekStatus = null;
            let navigateToPageNumber = () => Promise.resolve();
            let historyTimer = null;
            const syncReaderHistory = (pageNumber) => {
                if (!Number.isFinite(pageNumber)) return;
                if (historyTimer) window.clearTimeout(historyTimer);
                historyTimer = window.setTimeout(() => {
                    historyTimer = null;
                    const pageUrl = knownPageUrls.get(pageNumber);
                    if (!pageUrl || pageUrl === location.href) return;
                    const suppressionReason = historyStateWriteSuppressionReason(location.href);
                    const readerRouteIsNoLongerCurrent = !/^\/s\//i.test(location.pathname) ||
                        !/^\/s\//i.test(new URL(spaRenderedHref, location.href).pathname) ||
                        location.href !== spaRenderedHref;
                    if (suppressionReason || readerRouteIsNoLongerCurrent) {
                        if (navLogEnabled) navLog('reader-history-replace-skipped', {
                            pageNumber,
                            targetHref: pageUrl,
                            reason: readerRouteIsNoLongerCurrent ? 'reader-route-is-no-longer-current' : suppressionReason,
                            currentHref: location.href,
                            renderedHref: spaRenderedHref
                        });
                        return;
                    }
                    const currentHref = location.href;
                    const readerState = recoverSpaHistoryState(currentHref, window.history.state);
                    if (navLogEnabled) navLog('reader-history-replace', {
                        pageNumber,
                        targetHref: pageUrl,
                        scrollY: window.scrollY || 0,
                        historyState: summarizeNavLogState(readerState)
                    });
                    if (safeReplaceHistoryState(window.history, readerState, '', pageUrl, 'reader-page-url-sync')) {
                        forgetRememberedSpaHistoryState(currentHref);
                        rememberSpaHistoryState(pageUrl, readerState);
                        // Reader page tracking is an intentional same-route URL
                        // change. Keep Safari's SPA reconciliation poll in sync
                        // so it does not treat each scroll page as a Back event.
                        spaRenderedHref = pageUrl;
                    }
                }, 500);
            };
            const pageCounter = document.createElement('span');
            pageCounter.className = 'ehtw-reader-page-count';
            pageCounter.setAttribute('aria-live', 'polite');
            let lastReaderCounterPageNumber = currentPageNumber;
            const readerVisitedPageNumbers = new Set(
                Number.isFinite(currentPageNumber) ? [currentPageNumber] : []
            );

            const updatePageCounter = (pageNumber) => {
                const pageChanged = Number.isFinite(pageNumber) &&
                    pageNumber !== lastReaderCounterPageNumber;
                const pageWasVisited = readerVisitedPageNumbers.has(pageNumber);
                if (Number.isFinite(pageNumber)) {
                    currentPageNumber = pageNumber;
                    lastReaderCounterPageNumber = pageNumber;
                    readerVisitedPageNumbers.add(pageNumber);
                }
                if (pageChanged && pageWasVisited) {
                    const returnedImage = readerPageImages?.find((image) =>
                        pageInfo.get(image)?.pageNumber === pageNumber &&
                        image.getAttribute('data-ehtw-load-failed') === 'true'
                    );
                    if (returnedImage) {
                        const listener = imageListeners.find((item) => item.image === returnedImage);
                        listener?.resetAutoRetryAttempts?.();
                        listener?.retryManually?.();
                    }
                }

                pageCounter.textContent =
                    `${currentPageNumber ?? '?'} / ${totalPages ?? '?'}`;
                if (pageSlider) {
                    pageSlider.max = String(Math.max(1, totalPages || currentPageNumber || 1));
                    pageSlider.value = String(Math.max(1, currentPageNumber || 1));
                }
                if (pageSeekCurrent) {
                    pageSeekCurrent.textContent = String(currentPageNumber ?? '?');
                }
                if (pageSeekTotal) {
                    pageSeekTotal.textContent = String(totalPages ?? '?');
                }
                syncReaderHistory(currentPageNumber);

            };

            updatePageCounter(currentPageNumber);
            readerControls.appendChild(pageCounter);

            let clickPaging = false;
            try {
                clickPaging = window.localStorage?.getItem(readerModeStorageKey) === 'click';
            } catch (_) {
                clickPaging = false;
            }
            let clickModeTouchGuardAttached = false;
            // 1.17.248: a single-finger gesture that starts at a screen edge belongs
            // to iOS swipe-back/forward; canceling its touchmove kills that gesture.
            const CLICK_MODE_EDGE_SWIPE_ZONE = 40;
            let clickModeTouchStartedAtEdge = false;
            const recordClickModeTouchStart = (event) => {
                const x = Number(event.touches?.[0]?.clientX);
                const width = document.documentElement.clientWidth || window.innerWidth || 0;
                clickModeTouchStartedAtEdge = event.touches?.length === 1 && Number.isFinite(x) &&
                    (x <= CLICK_MODE_EDGE_SWIPE_ZONE || (width > 0 && x >= width - CLICK_MODE_EDGE_SWIPE_ZONE));
            };
            const preventClickModePageScroll = (event) => {
                if (
                    !clickPaging ||
                    clickModeTouchStartedAtEdge ||
                    document.documentElement.classList.contains('ehtw-reader-zoomed') ||
                    (window.visualViewport && window.visualViewport.scale > 1.01) ||
                    event.touches?.length !== 1 ||
                    event.target?.closest?.('.ehtw-reader-controls, .ehtw-reader-page-tools')
                ) return;
                event.preventDefault();
            };
            const setClickModeTouchGuard = (enabled) => {
                if (enabled && !clickModeTouchGuardAttached) {
                    addSpaPageEventListener(document, 'touchstart', recordClickModeTouchStart, {
                        capture: true,
                        passive: true
                    });
                    addSpaPageEventListener(document, 'touchmove', preventClickModePageScroll, {
                        capture: true,
                        passive: false
                    });
                    clickModeTouchGuardAttached = true;
                } else if (!enabled && clickModeTouchGuardAttached) {
                    document.removeEventListener?.('touchmove', preventClickModePageScroll, true);
                    document.removeEventListener?.('touchstart', recordClickModeTouchStart, true);
                    clickModeTouchStartedAtEdge = false;
                    clickModeTouchGuardAttached = false;
                }
            };
            const modes = [];
            const pageInfo = new WeakMap();
            const pageFrames = new WeakMap();
            const readerPageImages = [readerImage];
            let targetedSeekImagePageNumber = null;
            let activeImageIndex = 0;
            let zoomPercent = 100;
            try {
                const savedZoomPercent = Number.parseInt(
                    window.localStorage?.getItem(readerZoomStorageKey),
                    10
                );
                if (Number.isFinite(savedZoomPercent)) {
                    zoomPercent = Math.max(25, Math.min(300, savedZoomPercent));
                }
            } catch (_) {
                // Keep the default zoom when browser storage is unavailable.
            }
            let preloadCount = 5;
            try {
                const savedPreloadCount = Number.parseInt(
                    window.localStorage?.getItem(preloadStorageKey),
                    10
                );

                if (Number.isFinite(savedPreloadCount)) {
                    preloadCount = Math.max(0, Math.min(50, savedPreloadCount));
                }
            } catch (_) {
                // Keep the default when browser storage is unavailable.
            }
            let pageLinkPreloadCount = 10;
            try {
                const savedPageLinkPreloadCount = Number.parseInt(
                    window.localStorage?.getItem(pageLinkPreloadStorageKey),
                    10
                );
                if (Number.isFinite(savedPageLinkPreloadCount)) {
                    pageLinkPreloadCount = Math.max(
                        0,
                        Math.min(50, savedPageLinkPreloadCount)
                    );
                }
            } catch (_) {
                // Keep the default page link preload count when storage is unavailable.
            }
            let activeBatchPromise = null;
            let activePreviousBatchPromise = null;
            let readerSequenceGeneration = 0;
            let activeNextAbortController = null;
            let activePreviousAbortController = null;
            let loadingStopped = false;
            let previousLoadingStopped = false;
            let loadNextBatch = () => Promise.resolve();
            let loadPreviousBatch = () => Promise.resolve();
            let pumpReaderImagePreloadQueue = () => {};
            let readerImageQueueCenterIndex = 0;
            const activeReaderImageQueueLoads = new Set();
            const seenPages = new Set([currentPageUrl]);
            const topSentinel = document.createElement('div');
            topSentinel.className = 'ehtw-reader-sentinel';
            topSentinel.setAttribute('aria-hidden', 'true');
            const bottomSentinel = document.createElement('div');
            bottomSentinel.className = 'ehtw-reader-sentinel';
            bottomSentinel.setAttribute('aria-hidden', 'true');

            const restoreImageResource = (image) => {
                if (image?.dataset.ehtwMemoryUnloaded !== 'true') return;

                const source = image.dataset.ehtwMemorySource;
                if (!source) return;

                const sourceSet = image.dataset.ehtwMemorySourceSet;
                delete image.dataset.ehtwMemoryUnloaded;
                delete image.dataset.ehtwMemorySource;
                delete image.dataset.ehtwMemorySourceSet;
                delete image.dataset.ehtwPreloadPaused;
                image.dataset.ehtwSeekDeferredSource = source;
                if (sourceSet) image.dataset.ehtwSeekDeferredSourceSet = sourceSet;
                image.loading = 'lazy';
                pageFrames.get(image)?.classList.add('ehtw-reader-image-loading');
                updateBottomReaderStatus();
            };

            const releaseReaderImagesOutsideWindow = (centerIndex) => {
                if (!Number.isFinite(centerIndex)) return;
                const keepRadius = Math.max(0, Math.floor(preloadCount));
                readerPageImages.forEach((image, imageIndex) => {
                    if (
                        image.dataset.ehtwMemoryUnloaded === 'true' ||
                        !image.complete ||
                        image.naturalWidth <= 0
                    ) return;

                    if (Math.abs(imageIndex - centerIndex) <= keepRadius) return;

                    const source = image.currentSrc || image.getAttribute('src');
                    if (!source) return;
                    const sourceSet = image.getAttribute('srcset');
                    image.dataset.ehtwMemorySource = source;
                    if (sourceSet) image.dataset.ehtwMemorySourceSet = sourceSet;
                    image.dataset.ehtwMemoryUnloaded = 'true';
                    image.dataset.ehtwPreloadPaused = 'true';
                    activeReaderImageQueueLoads.delete(image);
                    imageListeners.find((entry) => entry.image === image)
                        ?.cancelAutoRetry?.();
                    image.removeAttribute('srcset');
                    image.removeAttribute('src');
                    image.loading = 'lazy';
                });
            };

            const startDeferredImageResource = (image) => {
                if (!image) return;
                const imageIndex = readerPageImages.indexOf(image);
                if (imageIndex >= 0) readerImageQueueCenterIndex = imageIndex;
                restoreImageResource(image);
                pumpReaderImagePreloadQueue();
            };

            const pauseReaderImagesOutsideWindow = (centerIndex, shouldPause) => {
                if (!shouldPause) return;
                activeReaderImageQueueLoads.forEach((image) => {
                    const imageIndex = readerPageImages.indexOf(image);
                    if (imageIndex < 0) {
                        activeReaderImageQueueLoads.delete(image);
                        return;
                    }
                    if (Math.abs(imageIndex - centerIndex) <= preloadCount) return;
                    if (image.complete && image.naturalWidth > 0) {
                        activeReaderImageQueueLoads.delete(image);
                        return;
                    }

                    const source = image.getAttribute('src');
                    if (!source) {
                        activeReaderImageQueueLoads.delete(image);
                        return;
                    }
                    image.dataset.ehtwSeekDeferredSource = source;
                    const sourceSet = image.getAttribute('srcset');
                    if (sourceSet) image.dataset.ehtwSeekDeferredSourceSet = sourceSet;
                    image.dataset.ehtwPreloadPaused = 'true';
                    image.fetchPriority = 'low';
                    imageListeners.find((entry) => entry.image === image)
                        ?.cancelAutoRetry?.();
                    // Keep this slot until the browser reports the canceled
                    // request as an error; removing src is asynchronous.
                    image.removeAttribute('srcset');
                    image.removeAttribute('src');
                    image.loading = 'lazy';
                });
            };

            const startDeferredImagesAround = (centerIndex) => {
                if (
                    !Number.isFinite(centerIndex) ||
                    centerIndex < 0 ||
                    centerIndex >= readerPageImages.length
                ) return;

                readerImageQueueCenterIndex = Math.floor(centerIndex);

                updateReaderImagePriorities(
                    pageInfo.get(readerPageImages[centerIndex])?.pageNumber ||
                    currentPageNumber
                );
                pumpReaderImagePreloadQueue();
            };

            const updateReaderImagePriorities = (centerPageNumber) => {
                if (!Number.isFinite(centerPageNumber)) return;

                readerPageImages.forEach((image) => {
                    const pageNumber = pageInfo.get(image)?.pageNumber;
                    if (!Number.isFinite(pageNumber)) return;

                    const priority = getReaderImagePriority(
                        pageNumber,
                        centerPageNumber,
                        targetedSeekImagePageNumber,
                        preloadCount
                    );
                    if (image.fetchPriority !== priority) {
                        image.fetchPriority = priority;
                    }
                });
            };

            const showActiveImage = (index, userInitiated = false) => {
                if (!readerPageImages.length) return;

                activeImageIndex = Math.max(
                    0,
                    Math.min(index, readerPageImages.length - 1)
                );
                document.documentElement.classList.remove('ehtw-reader-page-pending');
                if (readerTransitionMessage) readerTransitionMessage.textContent = '';

                readerPageImages.forEach((image, imageIndex) => {
                    image.classList.toggle(
                        'ehtw-reader-active',
                        imageIndex === activeImageIndex
                    );
                    pageFrames.get(image)?.classList.toggle(
                        'ehtw-reader-active',
                        imageIndex === activeImageIndex
                    );
                    if (clickPaging) {
                        if (imageIndex === activeImageIndex) {
                            startDeferredImageResource(image);
                            restoreImageResource(image);
                        }
                    }
                });
                releaseReaderImagesOutsideWindow(activeImageIndex);
                if (clickPaging) startDeferredImagesAround(activeImageIndex);

                const activeInfo = pageInfo.get(
                    readerPageImages[activeImageIndex]
                );
                const activeImage = readerPageImages[activeImageIndex];
                sizeReaderFrame(
                    pageFrames.get(activeImage),
                    activeImage,
                    activeInfo,
                    clickPaging
                );

                if (activeInfo?.pageNumber) {
                    updatePageCounter(activeInfo.pageNumber);
                }
                updateBottomReaderStatus();

                const linkWindowEdge = Math.max(1, preloadCount);
                if (
                    activeImageIndex >= readerPageImages.length - linkWindowEdge - 1 &&
                    nextPageUrl &&
                    !loadingStopped
                ) {
                    loadNextBatch();
                }
                if (
                    activeImageIndex <= linkWindowEdge &&
                    previousPageUrl &&
                    !previousLoadingStopped
                ) {
                    loadPreviousBatch();
                }

                if (!isNativeReaderZoomed() || userInitiated) {
                    readerProgrammaticScrollAt = performance.now();
                    if (userInitiated) recordReaderScrollRewrite(true);
                    readerPageImages[activeImageIndex]?.scrollIntoView?.({
                        block: 'center'
                    });
                }
            };

            const scrollImageToViewportCenter = (image, userInitiated = false) => {
                if ((isNativeReaderZoomed() && !userInitiated) || !image || readerLayoutHeight() <= 0) return;

                const bounds = image.getBoundingClientRect();
                if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.height)) {
                    return;
                }

                const desiredTop = (readerLayoutHeight() - bounds.height) / 2;
                const shift = bounds.top - desiredTop;
                const scrollRoot = document.scrollingElement ||
                    document.documentElement;

                if (Math.abs(shift) > 1 && scrollRoot) {
                    recordReaderScrollRewrite(userInitiated);
                    scrollRoot.scrollTop += shift;
                    suppressReaderScrollUntil = performance.now() + 200;
                }
            };

            const findImageAtViewportCenter = () => {
                if (readerLayoutHeight() <= 0) {
                    return activeImageIndex;
                }

                const viewportCenter = readerLayoutHeight() / 2;
                let closestIndex = activeImageIndex;
                let closestDistance = Infinity;

                readerPageImages.forEach((image, index) => {
                    const bounds = image.getBoundingClientRect();
                    const imageCenter = (bounds.top + bounds.bottom) / 2;
                    const distance = Math.abs(imageCenter - viewportCenter);

                    if (Number.isFinite(distance) && distance < closestDistance) {
                        closestIndex = index;
                        closestDistance = distance;
                    }
                });

                return closestIndex;
            };

            if (typeof window.IntersectionObserver === 'function') {
                imageMemoryObserver = new window.IntersectionObserver(
                    (entries) => {
                        let restoredImage = false;
                        entries.forEach((entry) => {
                            if (entry.isIntersecting) {
                                if (
                                    document.documentElement.classList.contains('ehtw-reader-page-pending') &&
                                    pageInfo.get(entry.target)?.pageNumber !== targetedSeekImagePageNumber
                                ) {
                                    return;
                                }
                                restoredImage ||=
                                    entry.target.dataset.ehtwMemoryUnloaded === 'true';
                                restoreImageResource(entry.target);
                            }
                        });
                        if (restoredImage) {
                            startDeferredImagesAround(
                                clickPaging ? activeImageIndex : findImageAtViewportCenter()
                            );
                        }
                    },
                    { rootMargin: '200% 0px' }
                );
            }

            if (typeof window.IntersectionObserver === 'function') {
                pageObserver = new window.IntersectionObserver(
                    (entries) => {
                        if (
                            clickPaging ||
                            readerInitializing ||
                            isNativeReaderZoomed() ||
                            performance.now() < suppressReaderScrollUntil
                        ) {
                            return;
                        }

                        const viewportCenter = readerLayoutHeight() / 2;
                        let closestInfo = null;
                        let closestDistance = Infinity;

                        entries.forEach((entry) => {
                            if (!entry.isIntersecting) return;

                            const bounds = entry.target.getBoundingClientRect();
                            if (
                                bounds.bottom < 120 ||
                                bounds.top > readerLayoutHeight() - 120
                            ) {
                                return;
                            }

                            const imageCenter = (bounds.top + bounds.bottom) / 2;
                            const distance = Math.abs(imageCenter - viewportCenter);

                            if (Number.isFinite(distance) && distance < closestDistance) {
                                closestInfo = pageInfo.get(entry.target);
                                closestDistance = distance;
                            }
                        });

                        if (closestInfo?.pageNumber) {
                            updatePageCounter(closestInfo.pageNumber);
                            updateReaderImagePriorities(closestInfo.pageNumber);
                        }
                    },
                    { rootMargin: '-120px 0px -120px 0px' }
                );
            }

            const sizeReaderFrame = (frame, image, info, fitViewport = clickPaging) => {
                if (!frame) return;

                const sourceUrl =
                    image.currentSrc ||
                    image.getAttribute('src') ||
                    image.dataset.ehtwMemorySource ||
                    image.getAttribute('data-ehtw-seek-deferred-source') ||
                    '';
                const urlDimensions = sourceUrl.match(
                    /-(\d{2,5})-(\d{2,5})-wbp(?:\/|$)/i
                );
                const sourceWidth =
                    image.naturalWidth ||
                    Number.parseInt(urlDimensions?.[1] || '', 10) ||
                    info?.width ||
                    0;
                const sourceHeight =
                    image.naturalHeight ||
                    Number.parseInt(urlDimensions?.[2] || '', 10) ||
                    info?.height ||
                    0;

                if (sourceWidth > 0 && sourceHeight > 0) {
                    const viewportWidth = readerLayoutWidth() || sourceWidth;
                    const viewportHeight = readerLayoutHeight() || sourceHeight;
                    let availableWidth = viewportWidth;
                    let maxHeight = Infinity;
                    let fitOffsetY = 0;

                    if (fitViewport) {
                        // Reader controls overlay the page, so fit against the full viewport.
                        availableWidth = Math.max(1, viewportWidth - 4);
                        maxHeight = viewportHeight;
                    }

                    const fitScale = Math.min(
                        1,
                        availableWidth / sourceWidth,
                        maxHeight / sourceHeight
                    );
                    const scale = fitScale * (zoomPercent / 100);

                    frame.style.width = `${Math.max(1, Math.round(sourceWidth * scale))}px`;
                    frame.style.height = `${Math.max(1, Math.round(sourceHeight * scale))}px`;
                    frame.style.transform = fitViewport
                        ? `translateY(${Math.round(fitOffsetY)}px)`
                        : '';
                } else {
                    frame.style.width = 'min(100vw, 100%)';
                    frame.style.height = 'min(50vh, 360px)';
                }
            };

            const captureReaderScrollAnchor = () => {
                if (clickPaging || isNativeReaderZoomed() || typeof window.innerHeight !== 'number') return null;
                const viewportCenter = window.innerHeight / 2;
                const candidates = readerPageImages
                    .map((image) => pageFrames.get(image))
                    .filter((frame) => frame?.isConnected)
                    .map((frame) => {
                        const bounds = frame.getBoundingClientRect();
                        const center = (bounds.top + bounds.bottom) / 2;
                        return {
                            frame,
                            center,
                            distance: Math.abs(center - viewportCenter),
                            visible: bounds.bottom > 0 && bounds.top < readerLayoutHeight()
                        };
                    })
                    .filter(({ visible }) => visible)
                    .sort((a, b) => a.distance - b.distance);
                const anchor = candidates[0];
                return anchor
                    ? { frame: anchor.frame, center: anchor.center }
                    : null;
            };

            const restoreReaderScrollAnchor = (anchor) => {
                if (!anchor?.frame?.isConnected) return;
                const bounds = anchor.frame.getBoundingClientRect();
                const anchorAfterCenter = (bounds.top + bounds.bottom) / 2;
                const scrollDelta = anchorAfterCenter - anchor.center;
                const scrollRoot = document.scrollingElement || document.documentElement;
                if (
                    !isNativeReaderZoomed() &&
                    Number.isFinite(scrollDelta) &&
                    Math.abs(scrollDelta) > 1 &&
                    scrollRoot
                ) {
                    recordReaderScrollRewrite();
                    scrollRoot.scrollTop += scrollDelta;
                    suppressReaderScrollUntil = performance.now() + 250;
                }
            };

            const bindImage = (image, info) => {
                const frame = document.createElement('div');
                frame.className = 'ehtw-reader-image-frame';
                const originalAlt = image.getAttribute('alt') || '';

                image.classList.add('ehtw-reader-page-image');
                image.setAttribute('draggable', 'false');
                image.draggable = false;
                if (info?.pageUrl) image.dataset.pageUrl = info.pageUrl;
                pageInfo.set(image, info);
                if (
                    image === readerImage ||
                    (
                        Number.isFinite(info?.pageNumber) &&
                        info.pageNumber === currentPageNumber
                    )
                ) {
                    image.fetchPriority = 'high';
                }

                const sourceAlreadySet =
                    !!image.getAttribute('src') ||
                    !!image.getAttribute('data-src');
                let imageLoadWatchdogTimer = null;
                const clearImageLoadWatchdog = () => {
                    if (imageLoadWatchdogTimer) {
                        window.clearTimeout(imageLoadWatchdogTimer);
                        imageLoadWatchdogTimer = null;
                    }
                };
                const armImageLoadWatchdog = () => {
                    clearImageLoadWatchdog();
                    if (!image.getAttribute('src') || image.complete) return;
                    imageLoadWatchdogTimer = window.setTimeout(() => {
                        imageLoadWatchdogTimer = null;
                        if (image.complete || image.getAttribute('data-ehtw-load-failed') === 'true') {
                            return;
                        }
                        onImageError();
                    }, READER_IMAGE_LOAD_TIMEOUT_MS);
                };
                imageLoadWatchdogCallbacks.set(image, armImageLoadWatchdog);

                if (
                    sourceAlreadySet &&
                    image.complete &&
                    image.naturalWidth === 0
                ) {
                    image.setAttribute('data-ehtw-load-failed', 'true');
                    image.alt = '';
                    frame.classList.add('ehtw-reader-image-failed');
                }

                if (
                    image.getAttribute('data-ehtw-load-failed') !== 'true' &&
                    (!image.complete || image.naturalWidth === 0)
                ) {
                    frame.classList.add('ehtw-reader-image-loading');
                }

                sizeReaderFrame(frame, image, info, clickPaging);
                pageFrames.set(image, frame);
                frame.appendChild(image);

                const spinner = document.createElement('div');
                spinner.className = 'ehtw-reader-loading-spinner';
                spinner.setAttribute('aria-hidden', 'true');
                frame.appendChild(spinner);

                const retryButton = document.createElement('button');
                retryButton.type = 'button';
                retryButton.className = 'ehtw-reader-retry-button';
                retryButton.setAttribute('aria-label', '重新加载图片');
                const retryIcon = document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'svg'
                );
                retryIcon.setAttribute('viewBox', '0 0 24 24');
                retryIcon.setAttribute('aria-hidden', 'true');
                const retryPath = document.createElementNS(
                    'http://www.w3.org/2000/svg',
                    'path'
                );
                retryPath.setAttribute(
                    'd',
                    'M20 7v5h-5M4 17v-5h5M5.64 8.64A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.36-2.64'
                );
                retryIcon.appendChild(retryPath);
                retryButton.appendChild(retryIcon);
                frame.appendChild(retryButton);
                imageMemoryObserver?.observe(image);

                let retryingImage = false;
                let autoRetryAttempts = 0;
                let autoRetryTimer = null;
                const cancelAutoRetry = () => {
                    if (autoRetryTimer === null) return;
                    window.clearTimeout(autoRetryTimer);
                    autoRetryTimer = null;
                };
                const retryImage = async () => {
                    if (retryingImage) return;

                    let retrySource =
                        image.currentSrc ||
                        image.getAttribute('src') ||
                        image.getAttribute('data-src') ||
                        image.dataset.ehtwSeekDeferredSource ||
                        image.dataset.ehtwMemorySource;

                    if (!retrySource) return;

                    const retryPageNumber = pageInfo.get(image)?.pageNumber;
                    const retryIsPreload = Number.isFinite(retryPageNumber) &&
                        retryPageNumber !== currentPageNumber;
                    if (
                        retryIsPreload &&
                        !activeReaderImageQueueLoads.has(image) &&
                        activeReaderImageQueueLoads.size >= READER_IMAGE_PREFETCH_CONCURRENCY
                    ) {
                        autoRetryTimer = window.setTimeout(() => {
                            autoRetryTimer = null;
                            return retryImage();
                        }, 100);
                        return;
                    }
                    if (retryIsPreload) activeReaderImageQueueLoads.add(image);

                    retryingImage = true;
                    const sourceSet = image.getAttribute('srcset');
                    frame.classList.remove('ehtw-reader-image-failed');
                    frame.classList.add('ehtw-reader-image-loading');
                    image.removeAttribute('data-ehtw-load-failed');
                    image.alt = originalAlt;
                    updateBottomReaderStatus();

                    if (
                        info?.pageUrl &&
                        typeof window.fetch === 'function' &&
                        typeof window.DOMParser === 'function'
                    ) {
                        try {
                            const response = await window.fetch(info.pageUrl, {
                                credentials: 'same-origin',
                                cache: 'no-store'
                            });

                            if (response?.ok) {
                                const pageText = await response.text();
                                const parsedPage = new window.DOMParser()
                                    .parseFromString(pageText, 'text/html');
                                const refreshedImage =
                                    parsedPage.querySelector('#img') ||
                                    parsedPage.querySelector('#i3 img');
                                const refreshedSource = resolveImageUrl(
                                    getImageSource(refreshedImage),
                                    info.pageUrl
                                );

                                if (refreshedSource) {
                                    retrySource = refreshedSource;
                                    info.imageUrl = refreshedSource;
                                }
                            }
                        } catch (_) {
                            // Fall back to retrying the last known image URL.
                        }
                    }

                    image.removeAttribute('srcset');
                    image.removeAttribute('src');
                    if (sourceSet) image.setAttribute('srcset', sourceSet);
                    startPageImageSource(image, retrySource);
                    retryingImage = false;
                };
                const scheduleAutomaticRetry = () => {
                    if (
                        retryingImage ||
                        autoRetryAttempts >= READER_IMAGE_AUTO_RETRY_LIMIT
                    ) {
                        return false;
                    }

                    cancelAutoRetry();
                    const delay = READER_IMAGE_AUTO_RETRY_DELAYS_MS[
                        autoRetryAttempts
                    ] || READER_IMAGE_AUTO_RETRY_DELAYS_MS[
                        READER_IMAGE_AUTO_RETRY_DELAYS_MS.length - 1
                    ];
                    autoRetryAttempts++;
                    frame.classList.remove('ehtw-reader-image-failed');
                    frame.classList.add('ehtw-reader-image-loading');
                    image.removeAttribute('data-ehtw-load-failed');
                    image.alt = originalAlt;
                    updateBottomReaderStatus();
                    autoRetryTimer = window.setTimeout(() => {
                        autoRetryTimer = null;
                        return retryImage();
                    }, delay);
                    return true;
                };
                const retryManually = () => {
                    cancelAutoRetry();
                    autoRetryAttempts = 0;
                    return retryImage();
                };
                pageObserver?.observe(image);

                const onImageError = () => {
                    clearImageLoadWatchdog();
                    if (image.dataset.ehtwPreloadPaused === 'true') {
                        activeReaderImageQueueLoads.delete(image);
                        pumpReaderImagePreloadQueue();
                        return;
                    }
                    if (retryingImage) return;
                    if (autoRetryTimer !== null) return;
                    if (scheduleAutomaticRetry()) return;
                    activeReaderImageQueueLoads.delete(image);
                    frame.classList.remove('ehtw-reader-image-loading');
                    frame.classList.add('ehtw-reader-image-failed');
                    image.setAttribute('data-ehtw-load-failed', 'true');
                    image.alt = '';
                    updateBottomReaderStatus();
                    pumpReaderImagePreloadQueue();
                };

                const onImageLoad = () => {
                    const scrollAnchor = captureReaderScrollAnchor();
                    retryingImage = false;
                    cancelAutoRetry();
                    autoRetryAttempts = 0;
                    clearImageLoadWatchdog();
                    delete image.dataset.ehtwPreloadPaused;
                    activeReaderImageQueueLoads.delete(image);
                    frame.classList.remove('ehtw-reader-image-loading');
                    frame.classList.remove('ehtw-reader-image-failed');
                    image.removeAttribute('data-ehtw-load-failed');
                    image.alt = originalAlt;
                    sizeReaderFrame(frame, image, info, clickPaging);
                    restoreReaderScrollAnchor(scrollAnchor);
                    releaseReaderImagesOutsideWindow(
                        readerImageQueueCenterIndex
                    );
                    updateBottomReaderStatus();
                    pumpReaderImagePreloadQueue();
                };

                const onRetryClick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    return retryManually();
                };

                const onImageDragStart = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                };

                const onImageClick = async (event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    const page = pageInfo.get(image);
                    const imageIndex = readerPageImages.indexOf(image);

                    const bounds = image.getBoundingClientRect();
                    // 1.17.255: when natively zoomed only part of the image is on
                    // screen, so measure the tap against the visible part.
                    let visibleLeft = bounds.left;
                    let visibleWidth = bounds.width;
                    const zoomViewport = window.visualViewport;
                    if (isNativeReaderZoomed() && zoomViewport) {
                        const viewLeft = Number(zoomViewport.offsetLeft) || 0;
                        const viewRight = viewLeft + (Number(zoomViewport.width) || 0);
                        const left = Math.max(bounds.left, viewLeft);
                        const right = Math.min(bounds.right, viewRight);
                        if (right - left > 0) {
                            visibleLeft = left;
                            visibleWidth = right - left;
                        }
                    }
                    const position = visibleWidth > 0
                        ? (event.clientX - visibleLeft) / visibleWidth
                        : 0.5;

                    // 图片中央区域用来隐藏或重新显示阅读设置。
                    if (position >= 0.4 && position <= 0.6) {
                        // Zoomed taps go to the zoom toggle; it clears auto-hide too.
                        const scrollHiddenShown = showReaderScrollHiddenChrome();
                        if (scrollHiddenShown && !isNativeReaderZoomed()) {
                            if (imageIndex >= 0) activeImageIndex = imageIndex;
                            return;
                        }
                        if (toggleReaderChromeWhileZoomed()) {
                            if (imageIndex >= 0) activeImageIndex = imageIndex;
                            return;
                        }
                        if (imageIndex >= 0) activeImageIndex = imageIndex;
                        readerRoot.classList.toggle(
                            'ehtw-reader-settings-hidden'
                        );
                        updateReaderPageToolsViewport();
                        sizeReaderFrame(
                            pageFrames.get(image),
                            image,
                            pageInfo.get(image),
                            clickPaging
                        );
                        return;
                    }

                    if (!clickPaging || !page) return;

                    if (position < 0.4) {
                        if (imageIndex > 0) {
                            showActiveImage(imageIndex - 1, true);
                        } else if (
                            previousPageUrl ||
                            (
                                page.previousUrl &&
                                page.previousUrl !== page.pageUrl
                            )
                        ) {
                            if (previousPageUrl) {
                                await loadPreviousBatch();

                                if (activeImageIndex > 0) {
                                    showActiveImage(activeImageIndex - 1, true);
                                } else if (
                                    page.previousUrl &&
                                    page.previousUrl !== page.pageUrl
                                ) {
                                    navigatePage(page.previousUrl);
                                }
                            } else {
                                navigatePage(page.previousUrl);
                            }
                        }
                        return;
                    }

                    if (imageIndex + 1 < readerPageImages.length) {
                        showActiveImage(imageIndex + 1, true);
                        return;
                    }

                    if (
                        page.nextUrl &&
                        page.nextUrl !== page.pageUrl &&
                        nextPageUrl
                    ) {
                        await loadNextBatch();

                        if (imageIndex + 1 < readerPageImages.length) {
                            showActiveImage(imageIndex + 1, true);
                        } else if (page.nextUrl !== page.pageUrl) {
                            navigatePage(page.nextUrl);
                        }
                    }
                };

                image.addEventListener('load', onImageLoad);
                image.addEventListener('error', onImageError);
                image.addEventListener('dragstart', onImageDragStart);
                image.addEventListener('click', onImageClick);
                retryButton.addEventListener('click', onRetryClick);
                if (frame.classList.contains('ehtw-reader-image-loading')) {
                    armImageLoadWatchdog();
                }
                if (image.getAttribute('data-ehtw-load-failed') === 'true') {
                    scheduleAutomaticRetry();
                }
                imageListeners.push({
                    image,
                    frame,
                    spinner,
                    retryButton,
                    onImageLoad,
                    onImageError,
                    onImageDragStart,
                    onImageClick,
                    onRetryClick,
                    clearImageLoadWatchdog,
                    retryManually,
                    resetAutoRetryAttempts: () => { autoRetryAttempts = 0; },
                    cancelAutoRetry
                });

                return frame;
            };

            const currentFrame = bindImage(readerImage, {
                pageUrl: currentPageUrl,
                previousUrl: currentPreviousUrl,
                nextUrl: nextPageUrl,
                pageNumber: initialPagePosition.page,
                totalPages: initialPagePosition.total
            });
            readerImages.appendChild(topSentinel);
            readerImages.appendChild(currentFrame);
            readerImages.appendChild(bottomSentinel);

            const updateMode = (enabled) => {
                if (enabled) {
                    activeImageIndex = findImageAtViewportCenter();
                }
                const imageToKeepOnScroll = !enabled
                    ? readerPageImages[activeImageIndex]
                    : null;

                clickPaging = enabled;
                readerRoot?.classList.remove('ehtw-reader-chrome-scroll-hidden');
                setClickModeTouchGuard(enabled);
                try {
                    window.localStorage?.setItem(
                        readerModeStorageKey,
                        enabled ? 'click' : 'scroll'
                    );
                } catch (_) {
                    // The current reader still changes mode when storage is unavailable.
                }
                document.documentElement.classList.toggle(
                    'ehtw-reader-click',
                    enabled
                );
                document.documentElement.classList.toggle(
                    'ehtw-reader-zoomed',
                    zoomPercent > 100
                );

                if (enabled) {
                    showActiveImage(activeImageIndex);
                } else {
                    readerPageImages.forEach((image) => {
                        image.classList.remove('ehtw-reader-active');
                        sizeReaderFrame(
                            pageFrames.get(image),
                            image,
                            pageInfo.get(image),
                            false
                        );
                    });
                    const activeInfo = imageToKeepOnScroll
                        ? pageInfo.get(imageToKeepOnScroll)
                        : null;
                    if (activeInfo?.pageNumber) {
                        currentPageNumber = activeInfo.pageNumber;
                        updatePageCounter(currentPageNumber);
                    }
                    startDeferredImagesAround(activeImageIndex);
                    scrollImageToViewportCenter(imageToKeepOnScroll);
                    lastReaderScrollY = window.scrollY;
                    updateBottomReaderStatus();
                }

                modes.forEach(({ button, mode }) => {
                    button.setAttribute(
                        'aria-pressed',
                        String((mode === 'click') === enabled)
                    );
                });
                updateReaderPageToolsViewport();
            };

            [
                ['scroll', '上下滚动'],
                ['click', '点击翻页']
            ].forEach(([mode, label]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ehtw-reader-mode';
                button.setAttribute('data-mode', mode);
                button.textContent = label;
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateMode(mode === 'click');
                });
                modes.push({ button, mode });
                readerControls.appendChild(button);
            });

            const preloadDetails = document.createElement('details');
            preloadDetails.className = 'ehtw-reader-preload-details';
            const preloadSummary = document.createElement('summary');
            preloadSummary.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
            preloadSummary.setAttribute('aria-label', '预载设置');
            preloadSummary.setAttribute('title', '预载设置');
            preloadDetails.appendChild(preloadSummary);

            const preloadPopover = document.createElement('div');
            preloadPopover.className = 'ehtw-reader-preload-popover';
            const imagePreloadRow = document.createElement('label');
            imagePreloadRow.className = 'ehtw-reader-preload-row';
            const preloadLabel = document.createElement('span');
            preloadLabel.textContent = '图片上下各预载';
            imagePreloadRow.appendChild(preloadLabel);

            const preloadInput = document.createElement('input');
            preloadInput.className = 'ehtw-reader-preload-count';
            preloadInput.type = 'number';
            preloadInput.min = '0';
            preloadInput.max = '50';
            preloadInput.step = '1';
            preloadInput.value = String(preloadCount);
            preloadInput.setAttribute('aria-label', '图片上下各预载数量');
            preloadInput.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            preloadInput.addEventListener('change', () => {
                const requestedCount = Number.parseInt(
                    preloadInput.value,
                    10
                );

                if (!Number.isFinite(requestedCount)) {
                    preloadInput.value = String(preloadCount);
                    return;
                }

                preloadCount = Math.max(0, Math.min(50, requestedCount));
                preloadInput.value = String(preloadCount);
                try {
                    window.localStorage?.setItem(
                        preloadStorageKey,
                        String(preloadCount)
                    );
                } catch (_) {
                    // The current reader still uses the value when storage is unavailable.
                }
                startDeferredImagesAround(clickPaging ? activeImageIndex : findImageAtViewportCenter());
            });

            imagePreloadRow.appendChild(preloadInput);

            const preloadUnit = document.createElement('span');
            preloadUnit.textContent = '张（上/下）';
            imagePreloadRow.appendChild(preloadUnit);
            preloadPopover.appendChild(imagePreloadRow);

            const pageLinkPreloadRow = document.createElement('label');
            pageLinkPreloadRow.className = 'ehtw-reader-preload-row';
            const pageLinkPreloadLabel = document.createElement('span');
            pageLinkPreloadLabel.textContent = '页码链接上下各预载';
            pageLinkPreloadRow.appendChild(pageLinkPreloadLabel);
            const pageLinkPreloadInput = document.createElement('input');
            pageLinkPreloadInput.className = 'ehtw-reader-page-link-preload-count';
            pageLinkPreloadInput.type = 'number';
            pageLinkPreloadInput.min = '0';
            pageLinkPreloadInput.max = '50';
            pageLinkPreloadInput.step = '1';
            pageLinkPreloadInput.value = String(pageLinkPreloadCount);
            pageLinkPreloadInput.setAttribute('aria-label', '页码链接上下各预载数量');
            pageLinkPreloadInput.addEventListener('click', (event) => event.stopPropagation());
            pageLinkPreloadInput.addEventListener('change', () => {
                const requestedCount = Number.parseInt(pageLinkPreloadInput.value, 10);
                if (!Number.isFinite(requestedCount)) {
                    pageLinkPreloadInput.value = String(pageLinkPreloadCount);
                    return;
                }
                pageLinkPreloadCount = Math.max(0, Math.min(50, requestedCount));
                pageLinkPreloadInput.value = String(pageLinkPreloadCount);
                try {
                    window.localStorage?.setItem(pageLinkPreloadStorageKey, String(pageLinkPreloadCount));
                } catch (_) {
                    // Current session still uses the changed value.
                }
                loadNextBatch();
                loadPreviousBatch();
            });
            pageLinkPreloadRow.appendChild(pageLinkPreloadInput);
            const pageLinkPreloadUnit = document.createElement('span');
            pageLinkPreloadUnit.textContent = '页（上/下）';
            pageLinkPreloadRow.appendChild(pageLinkPreloadUnit);
            preloadPopover.appendChild(pageLinkPreloadRow);
            preloadDetails.appendChild(preloadPopover);
            readerControls.appendChild(preloadDetails);

            readerPageTools = document.createElement('div');
            readerPageTools.className = 'ehtw-reader-page-tools';
            readerPageTools.setAttribute('aria-label', '翻页和缩放');

            const zoomControls = document.createElement('div');
            zoomControls.className = 'ehtw-reader-zoom-controls';

            const createZoomButton = (text, label, action, className = 'ehtw-reader-zoom-button') => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = className;
                button.textContent = text;
                button.setAttribute('aria-label', label);
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    action();
                });
                return button;
            };

            const applyZoomPercent = (value) => {
                const parsed = Number.parseInt(value, 10);
                if (!Number.isFinite(parsed)) {
                    if (zoomInput) zoomInput.value = String(zoomPercent);
                    return;
                }

                zoomPercent = Math.max(25, Math.min(300, parsed));
                if (zoomInput) zoomInput.value = String(zoomPercent);
                try {
                    window.localStorage?.setItem(
                        readerZoomStorageKey,
                        String(zoomPercent)
                    );
                } catch (_) {
                    // The current reader still uses the value when storage is unavailable.
                }
                document.documentElement.classList.toggle(
                    'ehtw-reader-zoomed',
                    zoomPercent > 100
                );

                if (clickPaging) {
                    const activeImage = readerPageImages[activeImageIndex];
                    sizeReaderFrame(
                        pageFrames.get(activeImage),
                        activeImage,
                        pageInfo.get(activeImage),
                        true
                    );
                    if (!isNativeReaderZoomed()) activeImage?.scrollIntoView?.({ block: 'center' });
                } else {
                    readerPageImages.forEach((image) => {
                        sizeReaderFrame(
                            pageFrames.get(image),
                            image,
                            pageInfo.get(image),
                            false
                        );
                    });
                }
                updateReaderPageToolsViewport();
            };

            zoomControls.appendChild(createZoomButton(
                '−',
                '缩小图片',
                () => applyZoomPercent(zoomPercent - 10)
            ));

            zoomInput = document.createElement('input');
            zoomInput.className = 'ehtw-reader-zoom-input';
            zoomInput.type = 'number';
            zoomInput.min = '25';
            zoomInput.max = '300';
            zoomInput.step = '5';
            zoomInput.value = String(zoomPercent);
            zoomInput.setAttribute('aria-label', '缩放百分比');
            zoomInput.addEventListener('click', (event) => event.stopPropagation());
            zoomInput.addEventListener('change', () => applyZoomPercent(zoomInput.value));
            zoomControls.appendChild(zoomInput);

            const zoomUnit = document.createElement('span');
            zoomUnit.className = 'ehtw-reader-zoom-unit';
            zoomUnit.textContent = '%';
            zoomControls.appendChild(zoomUnit);
            zoomControls.appendChild(createZoomButton(
                '+',
                '放大图片',
                () => applyZoomPercent(zoomPercent + 10)
            ));
            zoomControls.appendChild(createZoomButton(
                '适屏',
                '适应页面',
                () => applyZoomPercent(100),
                'ehtw-reader-fit-button'
            ));

            readerPageTools.appendChild(zoomControls);

            const pageSeek = document.createElement('div');
            pageSeek.className = 'ehtw-reader-page-seek';
            pageSeekCurrent = document.createElement('span');
            pageSeekCurrent.className = 'ehtw-reader-seek-current';
            pageSeekCurrent.textContent = String(currentPageNumber ?? '?');
            pageSeek.appendChild(pageSeekCurrent);

            pageSlider = document.createElement('input');
            pageSlider.className = 'ehtw-reader-page-slider';
            pageSlider.type = 'range';
            pageSlider.min = '1';
            pageSlider.max = String(Math.max(1, totalPages || currentPageNumber || 1));
            pageSlider.step = '1';
            pageSlider.value = String(Math.max(1, currentPageNumber || 1));
            pageSlider.setAttribute('aria-label', '跳转到页码');
            pageSlider.addEventListener('click', (event) => event.stopPropagation());
            let lastSliderCommitValue = null;
            const previewPageSliderValue = () => {
                const requestedPage = Number.parseInt(pageSlider.value, 10);
                if (!Number.isFinite(requestedPage)) return;

                pageSeekCurrent.textContent = String(requestedPage);
                const loadedIndex = readerPageImages.findIndex((image) =>
                    pageInfo.get(image)?.pageNumber === requestedPage
                );

                if (loadedIndex >= 0) {
                    if (pageSeekPromise) {
                        pageSeekTargetNumber = requestedPage;
                        targetedSeekImagePageNumber = requestedPage;
                    } else {
                        targetedSeekImagePageNumber = null;
                    }
                    if (clickPaging) {
                        showActiveImage(loadedIndex, true);
                    } else {
                        const image = readerPageImages[loadedIndex];
                        startDeferredImagesAround(loadedIndex);
                        startDeferredImageResource(image);
                        restoreImageResource(image);
                        scrollImageToViewportCenter(image, true);
                        updatePageCounter(requestedPage);
                            updateBottomReaderStatus();
                    }
                    return;
                }

                navigateToPageNumber(requestedPage);
            };
            const commitPageSliderValue = () => {
                const requestedPage = Number.parseInt(pageSlider.value, 10);
                if (!Number.isFinite(requestedPage) || requestedPage === currentPageNumber) {
                    pageSlider.value = String(Math.max(1, currentPageNumber || 1));
                    pageSeekCurrent.textContent = String(currentPageNumber ?? '?');
                    return;
                }
                if (lastSliderCommitValue === requestedPage && pageSeekPromise) return;
                lastSliderCommitValue = requestedPage;
                navigateToPageNumber(requestedPage);
            };
            pageSlider.addEventListener('pointerdown', (event) => {
                pageSliderDragActive = true;
                event.stopPropagation();
            });
            pageSlider.addEventListener('touchstart', () => {
                pageSliderDragActive = true;
            }, { passive: true });
            pageSlider.addEventListener('input', () => {
                previewPageSliderValue();
            });
            pageSlider.addEventListener('change', () => {
                if (!pageSliderDragActive) commitPageSliderValue();
            });
            pageSliderReleaseHandler = () => {
                if (!pageSliderDragActive) return;
                pageSliderDragActive = false;
                commitPageSliderValue();
            };
            pageSliderCancelHandler = () => {
                if (!pageSliderDragActive) return;
                pageSliderDragActive = false;
                pageSlider.value = String(Math.max(1, currentPageNumber || 1));
                pageSeekCurrent.textContent = String(currentPageNumber ?? '?');
            };
            addSpaPageEventListener(window, 'pointerup', pageSliderReleaseHandler);
            addSpaPageEventListener(window, 'touchend', pageSliderReleaseHandler, { passive: true });
            addSpaPageEventListener(window, 'pointercancel', pageSliderCancelHandler);
            addSpaPageEventListener(window, 'touchcancel', pageSliderCancelHandler, { passive: true });
            pageSeek.appendChild(pageSlider);

            pageSeekTotal = document.createElement('span');
            pageSeekTotal.className = 'ehtw-reader-seek-total';
            pageSeekTotal.textContent = String(totalPages ?? '?');
            pageSeek.appendChild(pageSeekTotal);
            readerPageTools.appendChild(pageSeek);

            pageSeekStatus = document.createElement('span');
            pageSeekStatus.className = 'ehtw-reader-seek-status';
            pageSeekStatus.setAttribute('aria-live', 'polite');
            readerPageTools.appendChild(pageSeekStatus);
            updateBottomReaderStatus = () => {
                if (
                    !pageSeekStatus ||
                    readerPageTools.classList.contains('ehtw-reader-seeking')
                ) {
                    return;
                }

                const loadingPages = [];
                const failedPages = [];
                readerPageImages.forEach((image) => {
                    const info = pageInfo.get(image);
                    const frame = pageFrames.get(image);
                    if (!info || image.dataset.ehtwMemoryUnloaded === 'true') return;
                    if (
                        image.dataset.ehtwDeferredSource ||
                        image.dataset.ehtwSeekDeferredSource
                    ) {
                        return;
                    }
                    if (frame?.classList.contains('ehtw-reader-image-loading')) {
                        loadingPages.push(info.pageNumber);
                    } else if (image.getAttribute('data-ehtw-load-failed') === 'true') {
                        failedPages.push(info.pageNumber);
                    }
                });

                const formatPages = (pages) => pages
                    .filter(Number.isFinite)
                    .slice(0, 4)
                    .join('、');
                if (loadingPages.length) {
                    const visiblePages = formatPages(loadingPages);
                    const extraCount = Math.max(0, loadingPages.length - 4);
                    pageSeekStatus.textContent = visiblePages
                        ? `正在加载图片：第 ${visiblePages} 页${extraCount ? ` 等 ${extraCount} 页` : ''}`
                        : `正在加载图片（${loadingPages.length} 张）`;
                } else if (failedPages.length) {
                    const visiblePages = formatPages(failedPages);
                    pageSeekStatus.textContent = visiblePages
                        ? `第 ${visiblePages} 页图片加载失败，点击重试图标重试`
                        : `${failedPages.length} 张图片加载失败，点击重试图标重试`;
                } else {
                    pageSeekStatus.textContent = '';
                }
            };
            updateBottomReaderStatus();

            readerPageTransition = document.createElement('div');
            readerPageTransition.className = 'ehtw-reader-page-transition';
            readerPageTransition.setAttribute('role', 'status');
            readerPageTransition.setAttribute('aria-live', 'polite');
            const transitionSpinner = document.createElement('div');
            transitionSpinner.className = 'ehtw-reader-loading-spinner';
            transitionSpinner.setAttribute('aria-hidden', 'true');
            readerPageTransition.appendChild(transitionSpinner);
            readerTransitionMessage = document.createElement('span');
            readerPageTransition.appendChild(readerTransitionMessage);

            readerRoot.appendChild(readerControls);
            readerRoot.appendChild(readerImages);
            readerRoot.appendChild(readerPageTools);
            readerRoot.appendChild(readerPageTransition);
            document.body.appendChild(readerRoot);
            const controlsBaselineRect = readerControls.getBoundingClientRect();
            const toolsBaselineRect = readerPageTools.getBoundingClientRect();
            const readerStylePixel = (element, property, fallback) => {
                const value = Number.parseFloat(window.getComputedStyle?.(element)?.[property]);
                return Number.isFinite(value) ? value : fallback;
            };
            const controlsTopBaseline = readerStylePixel(readerControls, 'top', controlsBaselineRect.top);
            const baselineLayoutHeight = document.documentElement.clientHeight || readerLayoutHeight();
            const toolsBottomBaseline = readerStylePixel(readerPageTools, 'bottom', baselineLayoutHeight - toolsBaselineRect.bottom);
            let readerZoomBaselineCaptured = false;
            let readerViewportBaselineMargins = {
                controlsTop: Number.isFinite(controlsTopBaseline) ? controlsTopBaseline : controlsBaselineRect.top,
                controlsTopTarget: Number.isFinite(controlsTopBaseline) ? controlsTopBaseline : controlsBaselineRect.top,
                toolsBottom: Number.isFinite(toolsBottomBaseline) ? toolsBottomBaseline : 0,
                toolsBottomTarget: Number.isFinite(toolsBottomBaseline) ? toolsBottomBaseline : 0
            };
            // 1.17.261: the scroll auto-hide slides the toolbars with the CSS
            // `translate` property (also mid-transition). Measure positions
            // without it, or the viewport correction cancels the slide.
            const readerRectWithoutTranslate = (element) => {
                const rect = element.getBoundingClientRect();
                const translate = String(window.getComputedStyle?.(element)?.translate || 'none');
                if (translate === 'none') return rect;
                const [tx = 0, ty = 0] = translate.split(/\s+/).map((part) => Number.parseFloat(part) || 0);
                if (!tx && !ty) return rect;
                return {
                    left: rect.left - tx,
                    right: rect.right - tx,
                    top: rect.top - ty,
                    bottom: rect.bottom - ty,
                    width: rect.width,
                    height: rect.height
                };
            };
            updateReaderPageToolsViewport = () => {
                const viewport = window.visualViewport;
                if (!viewport || !readerPageTools?.isConnected) return;
                if (readerViewportUpdateRaf) return;
                const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
                readerViewportUpdateRaf = requestFrame(() => {
                    readerViewportUpdateRaf = 0;
                    if (!readerPageTools?.isConnected) return;
                    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0
                        ? viewport.scale
                        : 1;
                    const offsetX = Number(viewport.offsetLeft) || 0;
                    const offsetY = Number(viewport.offsetTop) || 0;
                    // Measure the fixed elements in their untransformed layout
                    // positions. Their offset metrics can be rounded or relative
                    // to a transformed containing block on mobile browsers.
                    readerControls.style.removeProperty('transform');
                    readerPageTools.style.removeProperty('transform');
                    const controlsLayoutRect = readerRectWithoutTranslate(readerControls);
                    const toolsLayoutRect = readerRectWithoutTranslate(readerPageTools);
                    const inverseScale = 1 / scale;
                    const visualCenterX = offsetX + viewport.width / 2;
                    const controlShiftX = visualCenterX - (controlsLayoutRect.left + controlsLayoutRect.width / 2);
                    const toolsShiftX = visualCenterX - (toolsLayoutRect.left + toolsLayoutRect.width / 2);
                    const controlShiftY = offsetY + readerViewportBaselineMargins.controlsTop * inverseScale - controlsLayoutRect.top;
                    const toolsShiftY = offsetY + viewport.height - readerViewportBaselineMargins.toolsBottom * inverseScale - toolsLayoutRect.bottom;
                    const needsVisualViewportCorrection = scale > 1.01 ||
                        Math.abs(controlShiftX) > 1 || Math.abs(controlShiftY) > 1 ||
                        Math.abs(toolsShiftX) > 1 || Math.abs(toolsShiftY) > 1;
                    if (!needsVisualViewportCorrection) return;
                    const controlsTransform = `translate3d(${controlShiftX}px, ${controlShiftY}px, 0) translateX(-50%) scale(${inverseScale})`;
                    const toolsTransform = `translate3d(${toolsShiftX}px, ${toolsShiftY}px, 0) scale(${inverseScale})`;
                    readerControls.style.setProperty('transform', controlsTransform, 'important');
                    readerPageTools.style.setProperty('transform', toolsTransform, 'important');
                    // Some mobile engines round fixed bottom offsets before
                    // applying transforms. Correct from the measured result so
                    // the visual viewport edges stay aligned to screen pixels.
                    const controlsTransformedRect = readerRectWithoutTranslate(readerControls);
                    const toolsTransformedRect = readerRectWithoutTranslate(readerPageTools);
                    const controlCorrectionX = (visualCenterX - (controlsTransformedRect.left + controlsTransformedRect.width / 2)) * scale;
                    const controlCorrectionY = (offsetY + readerViewportBaselineMargins.controlsTop * inverseScale - controlsTransformedRect.top) * scale;
                    const toolsCorrectionX = (visualCenterX - (toolsTransformedRect.left + toolsTransformedRect.width / 2)) * scale;
                    const toolsCorrectionY = (offsetY + viewport.height - readerViewportBaselineMargins.toolsBottom * inverseScale - toolsTransformedRect.bottom) * scale;
                    if (Math.abs(controlCorrectionX) > 0.01 || Math.abs(controlCorrectionY) > 0.01) {
                        readerControls.style.setProperty('transform', `translate3d(${controlShiftX + controlCorrectionX}px, ${controlShiftY + controlCorrectionY}px, 0) translateX(-50%) scale(${inverseScale})`, 'important');
                    }
                    if (Math.abs(toolsCorrectionX) > 0.01 || Math.abs(toolsCorrectionY) > 0.01) {
                        readerPageTools.style.setProperty('transform', `translate3d(${toolsShiftX + toolsCorrectionX}px, ${toolsShiftY + toolsCorrectionY}px, 0) scale(${inverseScale})`, 'important');
                    }
                });
            };
            const refreshReaderPageToolsBaseline = () => {
                const controlsTop = readerStylePixel(readerControls, 'top', readerViewportBaselineMargins.controlsTop);
                const toolsBottom = readerStylePixel(readerPageTools, 'bottom', readerViewportBaselineMargins.toolsBottom);
                if (Number.isFinite(controlsTop)) {
                    readerViewportBaselineMargins.controlsTop = controlsTop;
                    readerViewportBaselineMargins.controlsTopTarget = controlsTop;
                }
                if (Number.isFinite(toolsBottom)) {
                    readerViewportBaselineMargins.toolsBottom = toolsBottom;
                    readerViewportBaselineMargins.toolsBottomTarget = toolsBottom;
                }
            };
            const clearReaderChromeFadeTimer = () => {
                if (readerChromeFadeTimer !== null) {
                    window.clearTimeout?.(readerChromeFadeTimer);
                    readerChromeFadeTimer = null;
                }
            };
            const readerViewportSnapshot = () => {
                const viewport = window.visualViewport;
                if (!viewport) return null;
                return {
                    scale: Number(viewport.scale) || 1,
                    width: Number(viewport.width) || 0,
                    height: Number(viewport.height) || 0,
                    offsetLeft: Number(viewport.offsetLeft) || 0,
                    offsetTop: Number(viewport.offsetTop) || 0
                };
            };
            const viewportSnapshotChanged = (previous, next) => !!previous && !!next && (
                Math.abs(previous.scale - next.scale) > 0.01 ||
                Math.abs(previous.width - next.width) > 1 ||
                Math.abs(previous.height - next.height) > 1 ||
                Math.abs(previous.offsetLeft - next.offsetLeft) > 1 ||
                Math.abs(previous.offsetTop - next.offsetTop) > 1
            );
            let readerLastViewportSnapshot = readerViewportSnapshot();
            const logReaderNativeZoomDiagnostic = () => {
                if (!navLogEnabled || readerZoomDiagnosticCount >= 3 || !isNativeReaderZoomed()) return;
                const viewport = window.visualViewport;
                if (!viewport) return;
                const scrollY = Number(window.scrollY) || 0;
                const eventScrollDelta = readerZoomLastViewportScrollY === null
                    ? 0
                    : scrollY - readerZoomLastViewportScrollY;
                if (Math.abs(eventScrollDelta) > (Number(viewport.height) || readerLayoutHeight())) {
                    readerZoomNonUserScrollJumpCount++;
                    readerZoomLastScrollJump = eventScrollDelta;
                }
                readerZoomLastViewportScrollY = scrollY;
                readerZoomDiagnosticCount++;
                navLog('reader-native-zoom-diagnostic', {
                    scale: Number((Number(viewport.scale) || 1).toFixed(3)),
                    innerWidth: Number(window.innerWidth) || 0,
                    clientWidth: Number(document.documentElement.clientWidth) || 0,
                    visualViewportWidth: Number(viewport.width) || 0,
                    windowResizeCount: readerZoomResizeCount,
                    visualViewportEventCount: readerZoomViewportEventCount,
                    maximumScale: Number(readerZoomMaximumScale.toFixed(3)),
                    scrollRewriteCount: readerZoomScrollRewriteCount,
                    userScrollRewriteCount: readerZoomUserScrollRewriteCount,
                    nonUserScrollJumpCount: readerZoomNonUserScrollJumpCount,
                    lastNonUserScrollJump: Number(readerZoomLastScrollJump.toFixed(1))
                }, true);
            };
            // 1.17.255: iOS does not always deliver a final visualViewport event
            // once a pinch settles back at scale 1, and may settle a hair above 1.
            // A slightly tolerant threshold plus a watchdog that re-checks while
            // the chrome is hidden guarantees the toolbars come back.
            const READER_CHROME_ZOOM_THRESHOLD = 1.02;
            let readerChromeRestoreWatchdog = null;
            // 1.17.255: a two-finger pinch hides the chrome on the very first
            // touch, before iOS starts scaling, and the chrome stays hidden until
            // every finger is lifted. It never visibly moves with the zoom.
            let readerPinchGestureActive = false;
            let readerChromeWatchdogLastScale = null;
            const stopReaderChromeRestoreWatchdog = () => {
                if (readerChromeRestoreWatchdog !== null) {
                    window.clearInterval?.(readerChromeRestoreWatchdog);
                    readerChromeRestoreWatchdog = null;
                }
                readerChromeWatchdogLastScale = null;
            };
            const startReaderChromeRestoreWatchdog = () => {
                if (readerChromeRestoreWatchdog !== null) return;
                readerChromeWatchdogLastScale = null;
                readerChromeRestoreWatchdog = window.setInterval(() => {
                    if (!readerRoot?.isConnected || !readerRoot.classList.contains('ehtw-reader-chrome-moving')) {
                        stopReaderChromeRestoreWatchdog();
                        return;
                    }
                    updateReaderChromeMovement(false, 3);
                    if (readerChromeRestoreWatchdog !== null) readerChromeWatchdogLastScale = Number(window.visualViewport?.scale) || 1;
                }, 400);
            };
            const updateReaderChromeMovement = (hasMoved = false, restoreVia = 1) => {
                const viewport = window.visualViewport;
                if (!viewport || !readerRoot?.isConnected) {
                    stopReaderChromeRestoreWatchdog();
                    return;
                }
                const scale = Number(viewport.scale) || 1;
                readerZoomMaximumScale = Math.max(readerZoomMaximumScale, scale);
                // Below scale ~1 iOS is still rubber-banding back; wait until it
                // settles (or the watchdog sees the same scale twice in a row).
                const settledBelowOne = scale < 0.98 && restoreVia === 3 &&
                    readerChromeWatchdogLastScale !== null &&
                    Math.abs(readerChromeWatchdogLastScale - scale) < 0.001;
                const unzoomed = scale <= READER_CHROME_ZOOM_THRESHOLD && (scale >= 0.98 || settledBelowOne);
                if (unzoomed && readerPinchGestureActive && readerRoot.classList.contains('ehtw-reader-chrome-moving')) return;
                if (scale <= READER_CHROME_ZOOM_THRESHOLD && !unzoomed) {
                    readerRoot.classList.add('ehtw-reader-chrome-moving');
                    startReaderChromeRestoreWatchdog();
                    return;
                }
                if (unzoomed) {
                    readerZoomChromeRequested = false;
                    clearReaderChromeFadeTimer();
                    // 1.17.255: re-anchor the toolbars to their CSS offsets on every
                    // return to scale 1, even if no viewport event announced it.
                    if (readerRoot.classList.contains('ehtw-reader-chrome-moving')) {
                        readerZoomBaselineCaptured = false;
                        refreshReaderPageToolsBaseline();
                        updateReaderPageToolsViewport();
                    }
                    stopReaderChromeRestoreWatchdog();
                    if (readerRoot.classList.contains('ehtw-reader-chrome-moving')) {
                        readerRoot.classList.remove('ehtw-reader-chrome-moving');
                        navLog('reader-native-zoom-chrome-restored', {
                            scale: Number(scale.toFixed(3)),
                            via: restoreVia
                        }, true);
                    }
                    readerZoomDiagnosticCount = 0;
                    readerZoomLastViewportScrollY = null;
                    return;
                }
                // 1.17.247: while natively pinch-zoomed the reader chrome stays
                // hidden. iOS positions fixed elements unpredictably at zoom, so
                // the toolbars only come back once the page is at scale 1 again.
                const shownOnRequest = readerZoomChromeRequested &&
                    !readerRoot.classList.contains('ehtw-reader-chrome-moving');
                if (shownOnRequest && !hasMoved && !readerPinchGestureActive) return;
                readerRoot.classList.add('ehtw-reader-chrome-moving');
                startReaderChromeRestoreWatchdog();
                if (!hasMoved && !readerZoomChromeRequested) return;
                clearReaderChromeFadeTimer();
                readerChromeFadeTimer = window.setTimeout(() => {
                    readerChromeFadeTimer = null;
                    if (readerTouchActive || readerPinchGestureActive || isNativeReaderZoomed() === false || !readerRoot?.isConnected) return;
                    logReaderNativeZoomDiagnostic();
                    if (readerZoomChromeRequested) showReaderChromeAtZoom();
                }, 250);
            };
            const showReaderChromeAtZoom = () => {
                if (!readerRoot?.isConnected) return;
                readerRoot.classList.remove('ehtw-reader-chrome-moving');
                updateReaderPageToolsViewport();
            };
            toggleReaderChromeWhileZoomed = () => {
                if (!isNativeReaderZoomed() || !readerRoot?.isConnected) return false;
                const visible = !readerRoot.classList.contains('ehtw-reader-chrome-moving') &&
                    !readerRoot.classList.contains('ehtw-reader-settings-hidden');
                clearReaderChromeFadeTimer();
                if (visible) {
                    readerZoomChromeRequested = false;
                    readerRoot.classList.add('ehtw-reader-settings-hidden');
                } else {
                    readerZoomChromeRequested = true;
                    readerRoot.classList.remove('ehtw-reader-settings-hidden');
                    showReaderChromeAtZoom();
                }
                return true;
            };
            const onReaderViewportMovement = () => {
                const nextSnapshot = readerViewportSnapshot();
                if (isNativeReaderZoomed()) {
                    if (!readerZoomBaselineCaptured && (
                        readerControls.getBoundingClientRect().height <= 0 ||
                        readerPageTools.getBoundingClientRect().height <= 0
                    )) {
                        // 1.17.255: toolbars hidden (display:none) when the zoom
                        // started measure as 0x0 at the top; use their CSS offsets.
                        refreshReaderPageToolsBaseline();
                        readerZoomBaselineCaptured = true;
                    }
                    if (!readerZoomBaselineCaptured) {
                        const controlsRect = readerRectWithoutTranslate(readerControls);
                        const toolsRect = readerRectWithoutTranslate(readerPageTools);
                        readerViewportBaselineMargins.controlsTop = controlsRect.top;
                        readerViewportBaselineMargins.controlsTopTarget = controlsRect.top;
                        // iOS may already report a shrunken innerHeight on the first
                        // pinch event; never measure the baseline against less than
                        // the layout height.
                        const baselineBottomEdge = Math.max(Number(window.innerHeight) || 0, readerLayoutHeight());
                        readerViewportBaselineMargins.toolsBottom = baselineBottomEdge - toolsRect.bottom;
                        readerViewportBaselineMargins.toolsBottomTarget = baselineBottomEdge - toolsRect.bottom;
                        readerZoomBaselineCaptured = true;
                    }
                    readerZoomViewportEventCount++;
                    const scrollY = Number(window.scrollY) || 0;
                    if (readerZoomLastViewportScrollY !== null) {
                        const delta = scrollY - readerZoomLastViewportScrollY;
                        if (Math.abs(delta) > (Number(window.visualViewport?.height) || readerLayoutHeight())) {
                            readerZoomNonUserScrollJumpCount++;
                            readerZoomLastScrollJump = delta;
                        }
                    }
                    readerZoomLastViewportScrollY = scrollY;
                } else {
                    readerZoomDiagnosticCount = 0;
                    readerZoomLastViewportScrollY = null;
                    readerZoomBaselineCaptured = false;
                    refreshReaderPageToolsBaseline();
                    readerZoomMaximumScale = 1;
                    readerZoomResizeCount = 0;
                    readerZoomViewportEventCount = 0;
                    readerZoomScrollRewriteCount = 0;
                    readerZoomUserScrollRewriteCount = 0;
                    readerZoomNonUserScrollJumpCount = 0;
                    readerZoomLastScrollJump = 0;
                }
                const changed = viewportSnapshotChanged(readerLastViewportSnapshot, nextSnapshot);
                readerLastViewportSnapshot = nextSnapshot;
                const changedSinceTouchStart = viewportSnapshotChanged(readerTouchStartViewport, nextSnapshot);
                if (!readerTouchStartedOnChrome || (changed && changedSinceTouchStart)) {
                    updateReaderChromeMovement(changed);
                }
                updateReaderPageToolsViewport();
            };
            const onReaderTouchStart = (event) => {
                const touchCount = Number(event.touches?.length) || 0;
                readerTouchActive = touchCount > 0;
                if (!readerTouchActive) return;
                // A fresh single-finger touch means any earlier gesture is over,
                // even if its touchend/touchcancel was lost.
                if (touchCount === 1) readerPinchGestureActive = false;
                if (touchCount >= 2 && readerRoot?.isConnected) {
                    readerPinchGestureActive = true;
                    clearReaderChromeFadeTimer();
                    readerRoot.classList.add('ehtw-reader-chrome-moving');
                    startReaderChromeRestoreWatchdog();
                }
                if (!isNativeReaderZoomed()) {
                    const controlsTop = readerStylePixel(readerControls, 'top', readerViewportBaselineMargins.controlsTop);
                    const toolsBottom = readerStylePixel(readerPageTools, 'bottom', readerViewportBaselineMargins.toolsBottom);
                    if (Number.isFinite(controlsTop)) {
                        readerViewportBaselineMargins.controlsTop = controlsTop;
                        readerViewportBaselineMargins.controlsTopTarget = controlsTop;
                    }
                    if (Number.isFinite(toolsBottom)) {
                        readerViewportBaselineMargins.toolsBottom = toolsBottom;
                        readerViewportBaselineMargins.toolsBottomTarget = toolsBottom;
                    }
                    readerZoomBaselineCaptured = true;
                }
                const target = event.target;
                if (target?.closest?.('.ehtw-reader-controls, .ehtw-reader-page-tools')) {
                    readerTouchStartedOnChrome = true;
                    readerTouchStartViewport = readerViewportSnapshot();
                } else if (!readerTouchStartedOnChrome) {
                    readerTouchStartViewport = readerViewportSnapshot();
                }
            };
            const onReaderTouchMove = (event) => {
                readerTouchActive = Number(event.touches?.length) > 0;
                if (!window.visualViewport || !isNativeReaderZoomed()) return;
                if (!readerTouchStartedOnChrome) updateReaderChromeMovement(true);
                else if (viewportSnapshotChanged(readerTouchStartViewport, readerViewportSnapshot())) updateReaderChromeMovement(true);
            };
            const onReaderTouchEnd = (event) => {
                readerTouchActive = Boolean(event.touches?.length);
                if (!readerTouchActive) {
                    readerPinchGestureActive = false;
                    readerTouchStartedOnChrome = false;
                    readerTouchStartViewport = null;
                    if (readerRoot?.classList.contains('ehtw-reader-chrome-moving')) updateReaderChromeMovement(isNativeReaderZoomed(), 2);
                }
            };
            addSpaPageEventListener(readerRoot, 'focusin', updateReaderPageToolsViewport, true);
            addSpaPageEventListener(readerRoot, 'focusout', updateReaderPageToolsViewport, true);
            addSpaPageEventListener(window, 'resize', updateReaderPageToolsViewport);
            if (window.visualViewport) {
                addSpaPageEventListener(window.visualViewport, 'resize', onReaderViewportMovement);
                addSpaPageEventListener(window.visualViewport, 'scroll', onReaderViewportMovement);
            }
            let readerScrollChromeLastY = Number(window.scrollY) || 0;
            let readerScrollChromeTravel = 0;
            let readerUserScrollInputAt = 0;
            const markReaderUserScrollInput = () => {
                readerUserScrollInputAt = performance.now();
            };
            const setReaderScrollChromeHidden = (hidden) => {
                if (!readerRoot?.isConnected) return;
                if (readerRoot.classList.contains('ehtw-reader-chrome-scroll-hidden') !== hidden) {
                    navLog('reader-scroll-chrome', { hidden: hidden ? 1 : 0, scrollY: Math.round(Number(window.scrollY) || 0) }, true);
                }
                readerRoot.classList.toggle('ehtw-reader-chrome-scroll-hidden', hidden);
                if (!hidden) updateReaderPageToolsViewport();
            };
            // Nav-log only: why a noticeable scroll did not toggle the chrome.
            let readerScrollChromeSkipLoggedAt = 0;
            const logReaderScrollChromeSkip = (reason, delta) => {
                if (!navLogEnabled || Math.abs(delta) < 24) return;
                const now = performance.now();
                if (now - readerScrollChromeSkipLoggedAt < 1000) return;
                readerScrollChromeSkipLoggedAt = now;
                navLog('reader-scroll-chrome-skip', { reason, delta: Math.round(delta), touch: readerTouchActive ? 1 : 0 }, true);
            };
            showReaderScrollHiddenChrome = () => {
                if (!readerRoot?.classList.contains('ehtw-reader-chrome-scroll-hidden')) return false;
                readerScrollChromeTravel = 0;
                setReaderScrollChromeHidden(false);
                return true;
            };
            const onReaderScrollChrome = () => {
                const y = Number(window.scrollY) || 0;
                const delta = y - readerScrollChromeLastY;
                readerScrollChromeLastY = y;
                const now = performance.now();
                if (
                    !readerRoot?.isConnected ||
                    clickPaging ||
                    isNativeReaderZoomed() ||
                    readerTouchStartedOnChrome ||
                    pageSliderDragActive ||
                    now - readerProgrammaticScrollAt < 300
                ) {
                    logReaderScrollChromeSkip(
                        clickPaging ? 1 : isNativeReaderZoomed() ? 2 : readerTouchStartedOnChrome ? 3 : pageSliderDragActive ? 4 : 5,
                        delta
                    );
                    readerScrollChromeTravel = 0;
                    if (clickPaging) setReaderScrollChromeHidden(false);
                    return;
                }
                // Only finger, momentum, wheel or key scrolling counts; page loads
                // and scroll anchoring never toggle the chrome.
                const userDriven = readerTouchActive || now - readerUserScrollInputAt < 1200;
                if (!userDriven || Math.abs(delta) > readerLayoutHeight()) {
                    logReaderScrollChromeSkip(userDriven ? 7 : 6, delta);
                    readerScrollChromeTravel = 0;
                    return;
                }
                readerUserScrollInputAt = now;
                if (y <= 8) {
                    readerScrollChromeTravel = 0;
                    setReaderScrollChromeHidden(false);
                    return;
                }
                if (delta === 0) return;
                if (Math.sign(delta) !== Math.sign(readerScrollChromeTravel)) readerScrollChromeTravel = 0;
                readerScrollChromeTravel += delta;
                if (readerScrollChromeTravel > 24) setReaderScrollChromeHidden(true);
                else if (readerScrollChromeTravel < -24) setReaderScrollChromeHidden(false);
            };
            addSpaPageEventListener(window, 'scroll', onReaderScrollChrome, { passive: true });
            addSpaPageEventListener(document, 'touchstart', markReaderUserScrollInput, { passive: true });
            addSpaPageEventListener(document, 'touchend', markReaderUserScrollInput, { passive: true });
            addSpaPageEventListener(window, 'wheel', markReaderUserScrollInput, { passive: true });
            addSpaPageEventListener(window, 'keydown', markReaderUserScrollInput, { passive: true });
            addSpaPageEventListener(document, 'touchstart', onReaderTouchStart, { passive: true });
            addSpaPageEventListener(document, 'touchmove', onReaderTouchMove, { passive: true });
            addSpaPageEventListener(document, 'touchend', onReaderTouchEnd, { passive: true });
            addSpaPageEventListener(document, 'touchcancel', onReaderTouchEnd, { passive: true });
            updateReaderPageToolsViewport();
            // 1.17.255: numeric-only diagnostic for the iOS status bar area above
            // the reader (is the page drawn under it, and where the image starts).
            let readerStatusBarDiagnosticCount = 0;
            const logReaderStatusBarDiagnostic = (trigger) => {
                if (!navLogEnabled || readerStatusBarDiagnosticCount >= 6 || !readerRoot?.isConnected || isNativeReaderZoomed()) return;
                readerStatusBarDiagnosticCount++;
                try {
                    const probe = document.createElement('div');
                    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
                    document.body.appendChild(probe);
                    const probeStyle = window.getComputedStyle(probe);
                    const safeTop = Number.parseFloat(probeStyle.paddingTop) || 0;
                    const safeBottom = Number.parseFloat(probeStyle.paddingBottom) || 0;
                    probe.remove();
                    const activeFrame = readerRoot.querySelector('.ehtw-reader-image-frame.ehtw-reader-active') ||
                        readerRoot.querySelector('.ehtw-reader-image-frame');
                    const frameRect = activeFrame?.getBoundingClientRect();
                    const viewport = window.visualViewport;
                    const round = (value) => Number((Number(value) || 0).toFixed(1));
                    const unitHeight = (value) => {
                        const unitProbe = document.createElement('div');
                        unitProbe.style.cssText = `position:absolute;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:${value}`;
                        document.body.appendChild(unitProbe);
                        const height = unitProbe.getBoundingClientRect().height;
                        unitProbe.remove();
                        return height;
                    };
                    const spaEnteredReader = performance.getEntriesByType?.('navigation')?.[0]?.name
                        ? !/\/s\//.test(new URL(performance.getEntriesByType('navigation')[0].name).pathname)
                        : false;
                    navLog('reader-status-bar-diagnostic', {
                        trigger: trigger === 'resize' ? 2 : 1,
                        clickMode: clickPaging ? 1 : 0,
                        standalone: window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone ? 1 : 0,
                        safeAreaTop: round(safeTop),
                        safeAreaBottom: round(safeBottom),
                        innerHeight: Number(window.innerHeight) || 0,
                        outerHeight: Number(window.outerHeight) || 0,
                        clientHeight: Number(document.documentElement.clientHeight) || 0,
                        screenHeight: Number(window.screen?.height) || 0,
                        screenAvailHeight: Number(window.screen?.availHeight) || 0,
                        visualViewportHeight: round(viewport?.height),
                        visualViewportOffsetTop: round(viewport?.offsetTop),
                        scrollY: round(window.scrollY),
                        devicePixelRatio: Number(window.devicePixelRatio) || 0,
                        frameTop: round(frameRect?.top),
                        frameHeight: round(frameRect?.height),
                        // 1.17.261: toolbar edges and viewport-unit heights, to see
                        // what Safari's top/bottom bar areas overlap.
                        controlsTop: round(readerControls?.getBoundingClientRect().top),
                        toolsBottom: round(readerPageTools?.getBoundingClientRect().bottom),
                        svh: round(unitHeight('100svh')),
                        lvh: round(unitHeight('100lvh')),
                        dvh: round(unitHeight('100dvh')),
                        enteredInPage: spaEnteredReader ? 1 : 0
                    }, true);
                } catch (_) {}
            };
            if (navLogEnabled) {
                window.setTimeout(() => logReaderStatusBarDiagnostic('ready'), 600);
                addSpaPageEventListener(window, 'resize', () => logReaderStatusBarDiagnostic('resize'));
            }
            releasePageBoot();
            const beginPageTransition = (pageNumber) => {
                document.documentElement.classList.add('ehtw-reader-page-pending');
                readerTransitionMessage.textContent = Number.isFinite(pageNumber)
                    ? `正在加载第 ${pageNumber} 页…`
                    : '正在加载…';
            };
            const endPageTransition = () => {
                document.documentElement.classList.remove('ehtw-reader-page-pending');
                readerTransitionMessage.textContent = '';
            };
            let lastReaderLayoutWidth = readerLayoutWidth();
            let lastReaderLayoutHeight = readerLayoutHeight();
            resizeHandler = () => {
                if (isNativeReaderZoomed()) {
                    readerZoomResizeCount++;
                    readerZoomMaximumScale = Math.max(readerZoomMaximumScale, Number(window.visualViewport?.scale) || 1);
                    logReaderNativeZoomDiagnostic();
                }
                const layoutWidth = readerLayoutWidth();
                const layoutHeight = readerLayoutHeight();
                if (layoutWidth === lastReaderLayoutWidth && layoutHeight === lastReaderLayoutHeight) {
                    return;
                }
                if (!isNativeReaderZoomed()) refreshReaderPageToolsBaseline();
                lastReaderLayoutWidth = layoutWidth;
                lastReaderLayoutHeight = layoutHeight;
                const scrollAnchor = captureReaderScrollAnchor();
                if (clickPaging) {
                    const image = readerPageImages[activeImageIndex];
                    sizeReaderFrame(
                        pageFrames.get(image),
                        image,
                        pageInfo.get(image),
                        true
                    );
                } else {
                    readerPageImages.forEach((image) => {
                        sizeReaderFrame(
                            pageFrames.get(image),
                            image,
                            pageInfo.get(image),
                            false
                        );
                    });
                }
                restoreReaderScrollAnchor(scrollAnchor);
            };
            addSpaPageEventListener(window, 'resize', resizeHandler);
            updateMode(clickPaging);

            let autoFillBatches = 0;
            let scrollDuringBatch = false;
            let autoFillPreviousBatches = 0;
            let scrollDuringPreviousBatch = false;

            const getImageSource = (image) => {
                const dataSrc = image.getAttribute('data-src');
                const src = image.getAttribute('src');

                if (dataSrc && !/^data:image\//i.test(dataSrc)) {
                    return dataSrc;
                }

                if (src && !/^data:image\//i.test(src)) {
                    return src;
                }

                return dataSrc || src || '';
            };

            const resolveImageUrl = (rawUrl, baseUrl) => {
                if (!rawUrl) return null;

                try {
                    return new URL(rawUrl, baseUrl).href;
                } catch (_) {
                    return null;
                }
            };

            const fetchGalleryIndexPage = (index) => {
                if (galleryIndexCache.has(index)) {
                    return Promise.resolve(galleryIndexCache.get(index));
                }
                if (galleryIndexFetchPromises.has(index)) {
                    return galleryIndexFetchPromises.get(index);
                }
                if (
                    !galleryIndexUrl ||
                    Date.now() < galleryIndexBlockedUntil ||
                    typeof window.fetch !== 'function' ||
                    typeof window.DOMParser !== 'function'
                ) {
                    return Promise.resolve(null);
                }

                const request = (async () => {
                    const indexUrl = new URL(galleryIndexUrl);
                    indexUrl.searchParams.set('p', String(index));
                    const response = await window.fetch(indexUrl.href, {
                        credentials: 'same-origin'
                    });
                    if (response?.status === 429 || response?.status === 403) {
                        galleryIndexBlockedUntil = Date.now() + 30 * 60 * 1000;
                        return null;
                    }
                    if (!response?.ok) return null;

                    const pageText = await response.text();
                    if (
                        pageText.length < 3000 &&
                        !pageText.includes('id="gdt"') &&
                        /temporarily banned|too fast|excessive/i.test(pageText)
                    ) {
                        galleryIndexBlockedUntil = Date.now() + 30 * 60 * 1000;
                        return null;
                    }
                    const parsedPage = new window.DOMParser()
                        .parseFromString(pageText, 'text/html');
                    const galleryId = new URL(galleryIndexUrl).pathname
                        .match(/^\/g\/(\d+)\//i)?.[1];
                    const listing = parsedPage.querySelector('#gdt') || parsedPage;
                    const urlsByPage = new Map();

                    Array.from(listing.querySelectorAll('a[href]')).forEach((link) => {
                        try {
                            const url = new URL(
                                link.getAttribute('href') || link.href,
                                indexUrl.href
                            );
                            const match = url.pathname.match(/\/s\/[^/]+\/(\d+)-(\d+)\/?$/i);
                            if (
                                url.origin === location.origin &&
                                match &&
                                (!galleryId || match[1] === galleryId)
                            ) {
                                urlsByPage.set(Number.parseInt(match[2], 10), url.href);
                            }
                        } catch (_) {}
                    });

                    galleryIndexCache.set(index, urlsByPage);
                    urlsByPage.forEach((pageUrl, pageNumber) => {
                        knownPageUrls.set(pageNumber, pageUrl);
                    });
                    return urlsByPage;
                })().finally(() => {
                    galleryIndexFetchPromises.delete(index);
                });
                galleryIndexFetchPromises.set(index, request);
                return request;
            };

            const findGalleryPageUrl = async (pageNumber) => {
                if (knownPageUrls.has(pageNumber)) {
                    return knownPageUrls.get(pageNumber);
                }

                const firstIndex = await fetchGalleryIndexPage(0);
                if (!firstIndex?.size) return null;

                const pagesPerIndex = firstIndex.size;
                const index = Math.floor((pageNumber - 1) / pagesPerIndex);
                const pageIndex = index === 0
                    ? firstIndex
                    : await fetchGalleryIndexPage(index);
                return pageIndex?.get(pageNumber) || null;
            };

            const acquireGalleryPageInfoSlot = () => new Promise((resolve) => {
                if (activeGalleryPageInfoFetches < 5) {
                    activeGalleryPageInfoFetches += 1;
                    resolve();
                } else {
                    galleryPageInfoFetchWaiters.push(resolve);
                }
            });

            const releaseGalleryPageInfoSlot = () => {
                const next = galleryPageInfoFetchWaiters.shift();
                if (next) next();
                else activeGalleryPageInfoFetches = Math.max(0, activeGalleryPageInfoFetches - 1);
            };

            const fetchGalleryPageInfo = (pageUrl, requestedPageNumber, signal) => {
                const safeUrl = safePageUrl(pageUrl, currentPageUrl);
                if (!safeUrl) return Promise.resolve(null);
                if (galleryPageInfoCache.has(safeUrl)) {
                    return Promise.resolve(galleryPageInfoCache.get(safeUrl));
                }
                if (galleryPageInfoFetchPromises.has(safeUrl)) {
                    return galleryPageInfoFetchPromises.get(safeUrl);
                }

                const request = (async () => {
                    await acquireGalleryPageInfoSlot();
                    try {
                        if (signal?.aborted) return null;
                        const response = await window.fetch(safeUrl, {
                            credentials: 'same-origin',
                            cache: 'no-store',
                            ...(signal ? { signal } : {})
                        });
                        if (!response?.ok) return null;

                        const pageText = await response.text();
                        if (signal?.aborted) return null;
                        const parsedPage = new window.DOMParser()
                            .parseFromString(pageText, 'text/html');
                        const image = parsedPage.querySelector('#img') ||
                            parsedPage.querySelector('#i3 img');
                        const imageUrl = resolveImageUrl(getImageSource(image), safeUrl);
                        if (!imageUrl) return null;

                        const position = readPagePosition(parsedPage, safeUrl);
                        const pageNumber = position.page || requestedPageNumber;
                        const page = {
                            pageUrl: safeUrl,
                            imageUrl,
                            previousUrl: findPageLink(parsedPage, 'previous', safeUrl),
                            nextUrl: findPageLink(parsedPage, 'next', safeUrl),
                            pageNumber,
                            totalPages: position.total,
                            width: position.width,
                            height: position.height
                        };
                        if (page.pageNumber) {
                            knownPageUrls.set(page.pageNumber, page.pageUrl);
                            if (page.previousUrl) {
                                knownPageUrls.set(page.pageNumber - 1, page.previousUrl);
                            }
                            if (page.nextUrl) {
                                knownPageUrls.set(page.pageNumber + 1, page.nextUrl);
                            }
                        }
                        galleryPageInfoCache.set(safeUrl, page);
                        if (galleryPageInfoCache.size > 100) {
                            galleryPageInfoCache.delete(
                                galleryPageInfoCache.keys().next().value
                            );
                        }
                        return page;
                    } finally {
                        releaseGalleryPageInfoSlot();
                    }
                })().finally(() => {
                    galleryPageInfoFetchPromises.delete(safeUrl);
                });
                galleryPageInfoFetchPromises.set(safeUrl, request);
                return request;
            };

            const prefetchGalleryPageInfoRange = async (firstPage, lastPage, signal) => {
                if (
                    !galleryIndexUrl ||
                    !Number.isFinite(firstPage) ||
                    !Number.isFinite(lastPage) ||
                    lastPage < firstPage
                ) return;

                const pageNumbers = [];
                for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
                    pageNumbers.push(pageNumber);
                }
                const pageUrls = await Promise.all(
                    pageNumbers.map((pageNumber) => findGalleryPageUrl(pageNumber))
                );
                await Promise.all(pageUrls.map((pageUrl, index) =>
                    pageUrl
                        ? fetchGalleryPageInfo(pageUrl, pageNumbers[index], signal)
                        : Promise.resolve(null)
                ));
            };

            const startPageImageSource = (imageNode, source) => {
                imageNode.loading = 'eager';
                imageNode.src = source;
                imageLoadWatchdogCallbacks.get(imageNode)?.();
                updateBottomReaderStatus();
            };

            pumpReaderImagePreloadQueue = () => {
                if (!readerPageImages.length) return;
                const centerIndex = Math.max(
                    0,
                    Math.min(readerImageQueueCenterIndex, readerPageImages.length - 1)
                );
                const centerPageNumber = pageInfo.get(
                    readerPageImages[centerIndex]
                )?.pageNumber || currentPageNumber;
                updateReaderImagePriorities(centerPageNumber);

                const pageTransitionPending = document.documentElement.classList.contains(
                    'ehtw-reader-page-pending'
                );
                const groups = getReaderImagePreloadGroups(
                    readerPageImages.length,
                    centerIndex,
                    preloadCount
                );

                const windowImages = groups
                    .flatMap((group) => group.map((index) => readerPageImages[index]))
                    .filter((image) => !pageTransitionPending ||
                        pageInfo.get(image)?.pageNumber === targetedSeekImagePageNumber);
                const isImageSettled = (image) =>
                    image.dataset.ehtwMemoryUnloaded === 'true' ||
                    image.getAttribute('data-ehtw-load-failed') === 'true' ||
                    (image.complete && image.naturalWidth > 0) ||
                    (!image.getAttribute('src') &&
                        !image.dataset.ehtwSeekDeferredSource &&
                        !image.dataset.ehtwMemorySource);
                const windowComplete = !pageTransitionPending &&
                    windowImages.every(isImageSettled);
                pauseReaderImagesOutsideWindow(centerIndex, !windowComplete);

                const windowImageSet = new Set(windowImages);
                const waitingToStart = windowImages.filter((image) =>
                    image.dataset.ehtwMemoryUnloaded !== 'true' &&
                    image.getAttribute('data-ehtw-load-failed') !== 'true' &&
                    !(image.complete && image.naturalWidth > 0) &&
                    !image.getAttribute('src') &&
                    (image.dataset.ehtwSeekDeferredSource || image.dataset.ehtwMemorySource)
                );

                const capacity = Math.max(
                    0,
                    READER_IMAGE_PREFETCH_CONCURRENCY - activeReaderImageQueueLoads.size
                );
                waitingToStart.slice(0, capacity).forEach((image) => {
                    restoreImageResource(image);
                    const source = image.dataset.ehtwSeekDeferredSource ||
                        image.dataset.ehtwMemorySource;
                    if (!source) return;
                    const sourceSet = image.dataset.ehtwSeekDeferredSourceSet ||
                        image.dataset.ehtwMemorySourceSet;
                    delete image.dataset.ehtwSeekDeferredSource;
                    delete image.dataset.ehtwSeekDeferredSourceSet;
                    delete image.dataset.ehtwMemoryUnloaded;
                    delete image.dataset.ehtwMemorySource;
                    delete image.dataset.ehtwMemorySourceSet;
                    delete image.dataset.ehtwPreloadPaused;
                    if (sourceSet) image.setAttribute('srcset', sourceSet);
                    image.loading = 'eager';
                    pageFrames.get(image)?.classList.add('ehtw-reader-image-loading');
                    activeReaderImageQueueLoads.add(image);
                    startPageImageSource(image, source);
                });
            };

            const preparePageImage = (page, batchIndex = 0) => {
                const imageNode = document.createElement('img');
                imageNode.alt = '';
                imageNode.decoding = 'async';
                imageNode.loading = 'eager';
                imageNode.fetchPriority = getReaderImagePriority(
                    page.pageNumber,
                    currentPageNumber,
                    targetedSeekImagePageNumber,
                    preloadCount,
                    batchIndex === 0
                );
                imageNode.dataset.pageUrl = page.pageUrl;
                if (page.width > 0 && page.height > 0) {
                    imageNode.width = page.width;
                    imageNode.height = page.height;
                }

                const deferForTargetSeek =
                    Number.isFinite(targetedSeekImagePageNumber) &&
                    page.pageNumber !== targetedSeekImagePageNumber;
                const outsideImagePreloadWindow = Number.isFinite(page.pageNumber) &&
                    Number.isFinite(currentPageNumber) &&
                    Math.abs(page.pageNumber - currentPageNumber) > preloadCount;
                imageNode.dataset.ehtwSeekDeferredSource = page.imageUrl;
                if (deferForTargetSeek || outsideImagePreloadWindow) imageNode.loading = 'lazy';

                const frame = bindImage(imageNode, page);
                return { imageNode, frame };
            };

            loadNextBatch = () => {
                if (
                    activeBatchPromise ||
                    loadingStopped ||
                    !nextPageUrl ||
                    typeof window.fetch !== 'function' ||
                    typeof window.DOMParser !== 'function'
                ) {
                    return activeBatchPromise || Promise.resolve();
                }

                const batchLimit = pageLinkPreloadCount;
                const sequenceGeneration = readerSequenceGeneration;
                const abortController = typeof window.AbortController === 'function'
                    ? new window.AbortController()
                    : null;
                activeNextAbortController = abortController;
                scrollDuringBatch = false;
                const loadedPageNumbers = readerPageImages
                    .map((image) => pageInfo.get(image)?.pageNumber)
                    .filter(Number.isFinite);
                const nextMetadataStart = loadedPageNumbers.length
                    ? Math.max(...loadedPageNumbers) + 1
                    : currentPageNumber + 1;
                const nextMetadataEnd = Math.min(
                    totalPages || nextMetadataStart + batchLimit - 1,
                    nextMetadataStart + batchLimit - 1
                );
                const lastKnownPage = readerPageImages
                    .map((image) => pageInfo.get(image))
                    .filter((info) => Number.isFinite(info?.pageNumber))
                    .sort((a, b) => b.pageNumber - a.pageNumber)[0];
                if (lastKnownPage?.nextUrl) {
                    knownPageUrls.set(lastKnownPage.pageNumber + 1, lastKnownPage.nextUrl);
                }
                prefetchGalleryPageInfoRange(
                    nextMetadataStart,
                    nextMetadataEnd,
                    abortController?.signal
                ).catch(() => {});

                activeBatchPromise = (async () => {
                    try {
                        for (let i = 0; i < batchLimit && nextPageUrl; i++) {
                            const pageUrl = nextPageUrl;

                            if (seenPages.has(pageUrl)) {
                                nextPageUrl = null;
                                loadingStopped = true;
                                break;
                            }

                            seenPages.add(pageUrl);

                            const page = await fetchGalleryPageInfo(
                                pageUrl,
                                nextMetadataStart + i,
                                abortController?.signal
                            );
                            if (sequenceGeneration !== readerSequenceGeneration) return;
                            if (!page) {
                                nextPageUrl = null;
                                loadingStopped = true;
                                break;
                            }
                            if (page.totalPages && !totalPages) {
                                totalPages = page.totalPages;
                                updatePageCounter(currentPageNumber);
                            }
                            if (page.pageNumber) {
                                knownPageUrls.set(page.pageNumber, page.pageUrl);
                            }

                            const { imageNode, frame } = preparePageImage(page, i);
                            readerPageImages.push(imageNode);
                            readerImages.insertBefore(frame, bottomSentinel);
                            updateBottomReaderStatus();
                            startDeferredImagesAround(
                                clickPaging ? activeImageIndex : findImageAtViewportCenter()
                            );

                            nextPageUrl =
                                page.nextUrl &&
                                page.nextUrl !== pageUrl &&
                                !seenPages.has(page.nextUrl)
                                    ? page.nextUrl
                                    : null;

                            if (!nextPageUrl) {
                                loadingStopped = true;
                            }
                        }
                    } catch (error) {
                        if (sequenceGeneration === readerSequenceGeneration) {
                            loadingStopped = true;
                            console.warn(
                                '[EH Twitter Style] Image preload stopped',
                                error
                            );
                        }
                    }
                })().finally(() => {
                    if (sequenceGeneration !== readerSequenceGeneration) return;
                    activeBatchPromise = null;
                    activeNextAbortController = null;

                    if (
                        !readerInitializing &&
                        !clickPaging &&
                        nextPageUrl &&
                        !loadingStopped &&
                        readerLayoutHeight() > 0 &&
                        autoFillBatches < 5 &&
                        (
                            bottomSentinel.getBoundingClientRect().top < readerLayoutHeight() ||
                            (
                                scrollDuringBatch &&
                                bottomSentinel.getBoundingClientRect().top < readerLayoutHeight() + 100
                            )
                        )
                    ) {
                        autoFillBatches++;
                        const schedule =
                            window.requestAnimationFrame ||
                            ((callback) => window.setTimeout(callback, 0));
                        schedule(() => loadNextBatch());
                    }

                    scrollDuringBatch = false;
                });

                return activeBatchPromise;
            };

            loadPreviousBatch = () => {
                if (
                    activePreviousBatchPromise ||
                    previousLoadingStopped ||
                    !previousPageUrl ||
                    typeof window.fetch !== 'function' ||
                    typeof window.DOMParser !== 'function'
                ) {
                    return activePreviousBatchPromise || Promise.resolve();
                }

                const batchLimit = pageLinkPreloadCount;
                const sequenceGeneration = readerSequenceGeneration;
                const abortController = typeof window.AbortController === 'function'
                    ? new window.AbortController()
                    : null;
                activePreviousAbortController = abortController;
                scrollDuringPreviousBatch = false;
                const loadedPageNumbers = readerPageImages
                    .map((image) => pageInfo.get(image)?.pageNumber)
                    .filter(Number.isFinite);
                const previousMetadataEnd = loadedPageNumbers.length
                    ? Math.min(...loadedPageNumbers) - 1
                    : currentPageNumber - 1;
                const previousMetadataStart = Math.max(
                    1,
                    previousMetadataEnd - batchLimit + 1
                );
                const firstKnownPage = readerPageImages
                    .map((image) => pageInfo.get(image))
                    .filter((info) => Number.isFinite(info?.pageNumber))
                    .sort((a, b) => a.pageNumber - b.pageNumber)[0];
                if (firstKnownPage?.previousUrl) {
                    knownPageUrls.set(firstKnownPage.pageNumber - 1, firstKnownPage.previousUrl);
                }
                prefetchGalleryPageInfoRange(
                    previousMetadataStart,
                    previousMetadataEnd,
                    abortController?.signal
                ).catch(() => {});

                activePreviousBatchPromise = (async () => {
                    const anchorImage = clickPaging
                        ? readerPageImages[activeImageIndex]
                        : readerPageImages[findImageAtViewportCenter()];
                    let insertedCount = 0;

                    try {
                        for (let i = 0; i < batchLimit && previousPageUrl; i++) {
                            const pageUrl = previousPageUrl;

                            if (seenPages.has(pageUrl)) {
                                previousPageUrl = null;
                                previousLoadingStopped = true;
                                break;
                            }

                            seenPages.add(pageUrl);

                            const page = await fetchGalleryPageInfo(
                                pageUrl,
                                previousMetadataEnd - i,
                                abortController?.signal
                            );
                            if (sequenceGeneration !== readerSequenceGeneration) return;
                            if (!page) {
                                previousPageUrl = null;
                                previousLoadingStopped = true;
                                break;
                            }
                            if (page.totalPages && !totalPages) {
                                totalPages = page.totalPages;
                                updatePageCounter(currentPageNumber);
                            }
                            if (page.pageNumber) {
                                knownPageUrls.set(page.pageNumber, page.pageUrl);
                            }
                            const { imageNode, frame } = preparePageImage(page, i);
                            const insertionAnchor = !clickPaging && scrollDuringPreviousBatch
                                ? readerPageImages[findImageAtViewportCenter()]
                                : anchorImage;
                            const anchorTop = insertionAnchor?.getBoundingClientRect?.().top;
                            const insertionPoint =
                                pageFrames.get(readerPageImages[0]) || bottomSentinel;
                            readerImages.insertBefore(frame, insertionPoint);
                            readerPageImages.unshift(imageNode);
                            activeImageIndex++;
                            insertedCount++;
                            updateBottomReaderStatus();

                            if (
                                !clickPaging &&
                                !isNativeReaderZoomed() &&
                                insertionAnchor &&
                                !readerInitializing
                            ) {
                                const anchorAfterTop = insertionAnchor.getBoundingClientRect().top;
                                const scrollRoot = document.scrollingElement ||
                                    document.documentElement;
                                const scrollDelta = anchorAfterTop - anchorTop;
                                if (
                                    Number.isFinite(scrollDelta) &&
                                    Math.abs(scrollDelta) > 1 &&
                                    scrollRoot
                                ) {
                                    recordReaderScrollRewrite();
                                    scrollRoot.scrollTop += scrollDelta;
                                    suppressReaderScrollUntil = performance.now() + 250;
                                }
                            }

                            startDeferredImagesAround(
                                clickPaging ? activeImageIndex : findImageAtViewportCenter()
                            );

                            previousPageUrl =
                                page.previousUrl &&
                                page.previousUrl !== pageUrl &&
                                !seenPages.has(page.previousUrl)
                                    ? page.previousUrl
                                    : null;

                            if (!previousPageUrl) {
                                previousLoadingStopped = true;
                            }
                        }
                    } catch (error) {
                        if (sequenceGeneration === readerSequenceGeneration) {
                            previousLoadingStopped = true;
                            console.warn(
                                '[EH Twitter Style] Previous image preload stopped',
                                error
                            );
                        }
                    }

                    if (!insertedCount) return;

                    if (clickPaging) {
                        showActiveImage(activeImageIndex);
                    }
                })().finally(() => {
                    if (sequenceGeneration !== readerSequenceGeneration) return;
                    activePreviousBatchPromise = null;
                    activePreviousAbortController = null;

                    if (
                        !readerInitializing &&
                        !clickPaging &&
                        previousPageUrl &&
                        !previousLoadingStopped &&
                        readerLayoutHeight() > 0 &&
                        autoFillPreviousBatches < 5 &&
                        scrollDuringPreviousBatch &&
                        topSentinel.getBoundingClientRect().bottom > -100
                    ) {
                        autoFillPreviousBatches++;
                        const schedule =
                            window.requestAnimationFrame ||
                            ((callback) => window.setTimeout(callback, 0));
                        schedule(() => loadPreviousBatch());
                    }

                    scrollDuringPreviousBatch = false;
                });

                return activePreviousBatchPromise;
            };

            let pageSeekPromise = null;
            let pageSeekTargetNumber = null;
            const replaceReaderSequenceWithPage = async (page) => {
                readerSequenceGeneration++;
                activeNextAbortController?.abort();
                activePreviousAbortController?.abort();
                activeNextAbortController = null;
                activePreviousAbortController = null;
                activeBatchPromise = null;
                activePreviousBatchPromise = null;

                readerPageImages.forEach((image) => {
                    pageObserver?.unobserve(image);
                    imageMemoryObserver?.unobserve(image);
                    activeReaderImageQueueLoads.delete(image);
                    const listenerIndex = imageListeners.findIndex((item) => item.image === image);
                    if (listenerIndex >= 0) {
                        const listeners = imageListeners[listenerIndex];
                        image.removeEventListener('load', listeners.onImageLoad);
                        image.removeEventListener('error', listeners.onImageError);
                        listeners.cancelAutoRetry?.();
                        image.removeEventListener('dragstart', listeners.onImageDragStart);
                        image.removeEventListener('click', listeners.onImageClick);
                        listeners.retryButton.removeEventListener('click', listeners.onRetryClick);
                        imageListeners.splice(listenerIndex, 1);
                    }

                    pageFrames.get(image)?.remove();
                    image.removeAttribute('srcset');
                    image.removeAttribute('src');
                    delete image.dataset.ehtwMemorySource;
                    delete image.dataset.ehtwMemorySourceSet;
                    delete image.dataset.ehtwMemoryUnloaded;
                    delete image.dataset.ehtwSeekDeferredSource;
                    delete image.dataset.ehtwSeekDeferredSourceSet;
                    delete image.dataset.ehtwPreloadPaused;
                });
                readerPageImages.splice(0, readerPageImages.length);

                seenPages.clear();
                seenPages.add(page.pageUrl);
                knownPageUrls.set(page.pageNumber, page.pageUrl);
                previousPageUrl = page.previousUrl && page.previousUrl !== page.pageUrl
                    ? page.previousUrl
                    : null;
                nextPageUrl = page.nextUrl && page.nextUrl !== page.pageUrl
                    ? page.nextUrl
                    : null;
                previousLoadingStopped = !previousPageUrl;
                loadingStopped = !nextPageUrl;
                autoFillBatches = 0;
                autoFillPreviousBatches = 0;
                scrollDuringBatch = false;
                scrollDuringPreviousBatch = false;
                targetedSeekImagePageNumber = page.pageNumber;

                const { imageNode, frame } = preparePageImage(page, 0);
                readerPageImages.push(imageNode);
                readerImages.insertBefore(frame, bottomSentinel);
                updateBottomReaderStatus();
                activeImageIndex = 0;
                currentPageNumber = page.pageNumber || currentPageNumber;
                if (page.totalPages) totalPages = page.totalPages;
                updatePageCounter(currentPageNumber);

                if (clickPaging) {
                    showActiveImage(0, true);
                } else {
                    startDeferredImagesAround(0);
                    startDeferredImageResource(imageNode);
                    restoreImageResource(imageNode);
                    scrollImageToViewportCenter(imageNode, true);
                    updatePageCounter(currentPageNumber);
                    endPageTransition();
                }

                targetedSeekImagePageNumber = null;
                startDeferredImagesAround(0);
                const schedule = window.requestAnimationFrame ||
                    ((callback) => window.setTimeout(callback, 0));
                schedule(() => {
                    if (nextPageUrl) loadNextBatch();
                    if (previousPageUrl) loadPreviousBatch();
                });
            };

            navigateToPageNumber = (requestedPageNumber) => {
                if (!Number.isFinite(requestedPageNumber)) {
                    return Promise.resolve(false);
                }

                const maxPageNumber = Math.max(
                    1,
                    totalPages || requestedPageNumber
                );
                pageSeekTargetNumber = Math.max(
                    1,
                    Math.min(maxPageNumber, Math.round(requestedPageNumber))
                );
                targetedSeekImagePageNumber = pageSeekTargetNumber;

                const loadedTargetIndex = readerPageImages.findIndex((image) =>
                    pageInfo.get(image)?.pageNumber === pageSeekTargetNumber
                );
                if (loadedTargetIndex >= 0) {
                    if (!pageSeekPromise) targetedSeekImagePageNumber = null;
                    const targetImage = readerPageImages[loadedTargetIndex];
                    if (targetImage.getAttribute('data-ehtw-load-failed') === 'true') {
                        const listener = imageListeners.find((item) => item.image === targetImage);
                        listener?.resetAutoRetryAttempts?.();
                        listener?.retryManually?.();
                    }
                    if (clickPaging) {
                        showActiveImage(loadedTargetIndex, true);
                    } else {
                        startDeferredImagesAround(loadedTargetIndex);
                        startDeferredImageResource(targetImage);
                        restoreImageResource(targetImage);
                        scrollImageToViewportCenter(targetImage, true);
                        updatePageCounter(pageInfo.get(targetImage)?.pageNumber);
                        endPageTransition();
                        updateBottomReaderStatus();
                    }
                    return pageSeekPromise || Promise.resolve(true);
                }

                if (pageSeekPromise) {
                    pageSeekStatus.textContent = `正在定位第 ${pageSeekTargetNumber} 页…`;
                    beginPageTransition(pageSeekTargetNumber);
                    return pageSeekPromise;
                }

                readerPageTools.classList.add('ehtw-reader-seeking');
                pageSeekStatus.textContent = `正在定位第 ${pageSeekTargetNumber} 页…`;
                beginPageTransition(pageSeekTargetNumber);
                pageSeekPromise = (async () => {
                    let foundIndex = -1;
                    let iterations = 0;

                    while (iterations++ < Math.max(1, totalPages || 10000)) {
                        const target = pageSeekTargetNumber;
                        foundIndex = readerPageImages.findIndex((image) =>
                            pageInfo.get(image)?.pageNumber === target
                        );
                        if (foundIndex >= 0) break;

                        const knownPageNumbers = readerPageImages
                            .map((image) => pageInfo.get(image)?.pageNumber)
                            .filter(Number.isFinite);
                        if (!knownPageNumbers.length) break;

                        const firstKnownPage = Math.min(...knownPageNumbers);
                        const lastKnownPage = Math.max(...knownPageNumbers);
                        const countBeforeLoad = readerPageImages.length;

                        if (
                            galleryIndexUrl &&
                            Math.abs(target - currentPageNumber) > pageLinkPreloadCount
                        ) {
                            pageSeekStatus.textContent = `正在查找第 ${target} 页…`;
                            const directPageUrl = await findGalleryPageUrl(target);
                            if (target !== pageSeekTargetNumber) continue;
                            if (directPageUrl) {
                                pageSeekStatus.textContent = `正在获取第 ${target} 页…`;
                                const directPage = await fetchGalleryPageInfo(directPageUrl, target);
                                if (target !== pageSeekTargetNumber) continue;
                                if (directPage) {
                                    await replaceReaderSequenceWithPage(directPage);
                                    return true;
                                }
                            }
                        }

                        if (
                            target > lastKnownPage &&
                            nextPageUrl &&
                            !loadingStopped
                        ) {
                            pageSeekStatus.textContent = `正在读取第 ${lastKnownPage + 1} 页…`;
                            await loadNextBatch();
                        } else if (
                            target < firstKnownPage &&
                            previousPageUrl &&
                            !previousLoadingStopped
                        ) {
                            pageSeekStatus.textContent = `正在读取第 ${firstKnownPage - 1} 页…`;
                            await loadPreviousBatch();
                        } else {
                            break;
                        }

                        if (readerPageImages.length === countBeforeLoad) break;
                    }

                    foundIndex = readerPageImages.findIndex((image) =>
                        pageInfo.get(image)?.pageNumber === pageSeekTargetNumber
                    );
                    if (foundIndex < 0) return false;

                    if (clickPaging) {
                        showActiveImage(foundIndex);
                    } else {
                        const targetImage = readerPageImages[foundIndex];
                        startDeferredImagesAround(foundIndex);
                        startDeferredImageResource(targetImage);
                        restoreImageResource(targetImage);
                        scrollImageToViewportCenter(targetImage, true);
                        updatePageCounter(pageInfo.get(targetImage)?.pageNumber);
                        endPageTransition();
                        updateBottomReaderStatus();
                    }
                    return true;
                })().then((found) => {
                    if (!found) {
                        pageSeekStatus.textContent = '无法加载目标页';
                        return false;
                    }
                    pageSeekStatus.textContent = '';
                    return true;
                }).catch((error) => {
                    console.warn('[EH Twitter Style] Page seek failed', error);
                    pageSeekStatus.textContent = '无法加载目标页';
                    return false;
                }).finally(() => {
                    pageSeekPromise = null;
                    pageSeekTargetNumber = null;
                    targetedSeekImagePageNumber = null;
                    readerPageTools.classList.remove('ehtw-reader-seeking');
                    endPageTransition();
                    pageSlider.value = String(Math.max(1, currentPageNumber || 1));
                    updateBottomReaderStatus();
                });

                return pageSeekPromise;
            };

            let wheelPagePromise = null;
            const advanceClickPageByWheel = (direction) => {
                if (!clickPaging || wheelPagePromise) return wheelPagePromise;

                wheelPagePromise = (async () => {
                    if (direction > 0) {
                        if (activeImageIndex + 1 < readerPageImages.length) {
                            showActiveImage(activeImageIndex + 1, true);
                            return;
                        }

                        const currentInfo = pageInfo.get(
                            readerPageImages[activeImageIndex]
                        );
                        if (!currentInfo?.nextUrl || !nextPageUrl) return;

                        targetedSeekImagePageNumber = (currentInfo.pageNumber || currentPageNumber) + 1;
                        beginPageTransition(targetedSeekImagePageNumber);
                        const countBeforeLoad = readerPageImages.length;
                        await loadNextBatch();
                        if (
                            readerPageImages.length > countBeforeLoad &&
                            activeImageIndex + 1 < readerPageImages.length
                        ) {
                            showActiveImage(activeImageIndex + 1, true);
                        } else {
                            endPageTransition();
                        }
                        return;
                    }

                    if (activeImageIndex > 0) {
                        showActiveImage(activeImageIndex - 1, true);
                        return;
                    }

                    const currentInfo = pageInfo.get(readerPageImages[activeImageIndex]);
                    if (!currentInfo?.previousUrl || !previousPageUrl) return;

                    targetedSeekImagePageNumber = (currentInfo.pageNumber || currentPageNumber) - 1;
                    beginPageTransition(targetedSeekImagePageNumber);
                    const countBeforeLoad = readerPageImages.length;
                    await loadPreviousBatch();
                    if (
                        readerPageImages.length > countBeforeLoad &&
                        activeImageIndex > 0
                    ) {
                        showActiveImage(activeImageIndex - 1, true);
                    } else {
                        endPageTransition();
                    }
                })().finally(() => {
                    wheelPagePromise = null;
                    targetedSeekImagePageNumber = null;
                    endPageTransition();
                });

                return wheelPagePromise;
            };

            wheelPagingHandler = (event) => {
                if (!clickPaging || event.ctrlKey || event.metaKey) return;

                const target = event.target?.nodeType === 3
                    ? event.target.parentElement
                    : event.target;
                if (target?.closest?.('.ehtw-reader-controls, .ehtw-reader-page-tools')) {
                    return;
                }

                let deltaY = event.deltaY;
                if (event.deltaMode === 1) deltaY *= 16;
                else if (event.deltaMode === 2) deltaY *= readerLayoutHeight() || 800;
                if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 12) return;

                if (zoomPercent > 100) {
                    const canScrollDown = readerImages.scrollTop +
                        readerImages.clientHeight < readerImages.scrollHeight - 1;
                    const canScrollUp = readerImages.scrollTop > 0;
                    if ((deltaY > 0 && canScrollDown) || (deltaY < 0 && canScrollUp)) {
                        return;
                    }
                }

                event.preventDefault();
                if (wheelUnlockTimer) window.clearTimeout?.(wheelUnlockTimer);
                wheelUnlockTimer = window.setTimeout?.(() => {
                    wheelGestureLocked = false;
                    wheelUnlockTimer = null;
                }, 220) || null;

                if (wheelGestureLocked) return;
                wheelGestureLocked = true;
                advanceClickPageByWheel(deltaY > 0 ? 1 : -1);
            };
            addSpaPageEventListener(window, 'wheel', wheelPagingHandler, { passive: false });

            keyPagingHandler = (event) => {
                if (
                    !clickPaging ||
                    event.defaultPrevented ||
                    event.ctrlKey || event.metaKey || event.altKey
                ) {
                    return;
                }
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;

                event.stopImmediatePropagation();
                event.preventDefault();
                advanceClickPageByWheel(event.key === 'ArrowRight' ? 1 : -1);
            };
            addSpaPageEventListener(window, 'keydown', keyPagingHandler, true);

            if (nextPageUrl || previousPageUrl) {
                if (
                    nextPageUrl &&
                    typeof window.IntersectionObserver === 'function'
                ) {
                    observer = new window.IntersectionObserver(
                        (entries) => {
                            if (
                                !readerInitializing &&
                                entries.some(entry => entry.isIntersecting)
                            ) {
                                loadNextBatch();
                            }
                        },
                        { rootMargin: '1200px 0px' }
                    );

                    observer.observe(bottomSentinel);
                }

                if (
                    previousPageUrl &&
                    typeof window.IntersectionObserver === 'function'
                ) {
                    previousObserver = new window.IntersectionObserver(
                        (entries) => {
                            if (
                                !readerInitializing &&
                                entries.some(entry => entry.isIntersecting)
                            ) {
                                loadPreviousBatch();
                            }
                        },
                        { rootMargin: '1200px 0px' }
                    );

                    previousObserver.observe(topSentinel);
                }

                if (typeof window.addEventListener === 'function') {
                    scrollFallback = () => {
                        const currentScrollY = window.scrollY;
                        const scrollDelta = currentScrollY - lastReaderScrollY;
                        lastReaderScrollY = currentScrollY;

                        if (readerInitializing) return;
                        if (performance.now() < suppressReaderScrollUntil) return;

                        if (!clickPaging) {
                            const visibleIndex = findImageAtViewportCenter();
                            releaseReaderImagesOutsideWindow(visibleIndex);
                            startDeferredImagesAround(visibleIndex);
                            const visibleInfo = pageInfo.get(
                                readerPageImages[visibleIndex]
                            );

                            if (visibleInfo?.pageNumber) {
                                updatePageCounter(visibleInfo.pageNumber);
                            }
                            updateBottomReaderStatus();
                            const linkWindowEdge = Math.max(1, preloadCount);
                            if (
                                visibleIndex >= readerPageImages.length - linkWindowEdge - 1 &&
                                nextPageUrl &&
                                !loadingStopped
                            ) {
                                loadNextBatch();
                            }
                            if (
                                visibleIndex <= linkWindowEdge &&
                                previousPageUrl &&
                                !previousLoadingStopped
                            ) {
                                loadPreviousBatch();
                            }
                        }

                        if (clickPaging) return;

                        if (nextPageUrl && scrollDelta > 0) {
                            autoFillBatches = 0;

                            if (activeBatchPromise) {
                                scrollDuringBatch = true;
                            } else if (
                                bottomSentinel.getBoundingClientRect().top <
                                readerLayoutHeight() + 1200
                            ) {
                                loadNextBatch();
                            }
                        }

                        if (previousPageUrl && scrollDelta < 0) {
                            autoFillPreviousBatches = 0;

                            if (activePreviousBatchPromise) {
                                scrollDuringPreviousBatch = true;
                            } else if (
                                topSentinel.getBoundingClientRect().bottom >
                                -readerLayoutHeight() - 1200
                            ) {
                                loadPreviousBatch();
                            }
                        }
                    };

                    addSpaPageEventListener(
                        window,
                        'scroll',
                        scrollFallback,
                        { passive: true }
                    );
                }

                if (!clickPaging && !isMobileReaderViewport()) {
                    scrollImageToViewportCenter(readerImage);
                }
                readerRoot.setAttribute('data-ehtw-reader-ready', 'true');
                readerInitializing = false;
                lastReaderScrollY = window.scrollY;
                updatePageCounter(initialPagePosition.page);

                if (nextPageUrl) loadNextBatch();
                if (previousPageUrl) loadPreviousBatch();
            }

            publishSpaPageCleanup(() => {
                observer?.disconnect();
                previousObserver?.disconnect();
                pageObserver?.disconnect();
                imageMemoryObserver?.disconnect();
                if (wheelUnlockTimer) window.clearTimeout?.(wheelUnlockTimer);
                if (historyTimer) window.clearTimeout?.(historyTimer);
                clearReaderChromeFadeTimer();
                stopReaderChromeRestoreWatchdog();
                readerRoot?.classList.remove('ehtw-reader-chrome-moving');
                imageListeners.forEach(({ image, retryButton, onImageError, onImageDragStart, onImageClick, onRetryClick, clearImageLoadWatchdog, cancelAutoRetry }) => {
                    clearImageLoadWatchdog?.();
                    cancelAutoRetry?.();
                    image.removeEventListener('error', onImageError);
                    image.removeEventListener('dragstart', onImageDragStart);
                    image.removeEventListener('click', onImageClick);
                    retryButton.removeEventListener('click', onRetryClick);
                    image.removeAttribute('src');
                });
                readerRoot?.remove();
                readerStyle?.remove();
                document.documentElement.classList.remove(
                    'ehtw-reader',
                    'ehtw-reader-click',
                    'ehtw-reader-zoomed',
                    'ehtw-reader-settings-hidden',
                    'ehtw-reader-page-pending'
                );
                try {
                    delete window[RUN_KEY];
                } catch (_) {
                    window[RUN_KEY] = false;
                }
            });
        } catch (error) {
            observer?.disconnect();
            previousObserver?.disconnect();
            pageObserver?.disconnect();
            imageMemoryObserver?.disconnect();
            if (resizeHandler) {
                window.removeEventListener?.('resize', resizeHandler);
                resizeHandler = null;
            }
            if (pageSliderReleaseHandler) {
                window.removeEventListener?.('pointerup', pageSliderReleaseHandler);
                window.removeEventListener?.('touchend', pageSliderReleaseHandler);
            }
            if (pageSliderCancelHandler) {
                window.removeEventListener?.('pointercancel', pageSliderCancelHandler);
                window.removeEventListener?.('touchcancel', pageSliderCancelHandler);
            }
            if (wheelPagingHandler) {
                window.removeEventListener?.('wheel', wheelPagingHandler);
                wheelPagingHandler = null;
            }
            if (keyPagingHandler) {
                window.removeEventListener?.('keydown', keyPagingHandler, true);
                keyPagingHandler = null;
            }
            if (wheelUnlockTimer) {
                window.clearTimeout?.(wheelUnlockTimer);
                wheelUnlockTimer = null;
            }
            document.documentElement.classList.remove('ehtw-reader-page-pending');

            if (scrollFallback) {
                window.removeEventListener?.('scroll', scrollFallback);
            }

            imageListeners.forEach(({
                image,
                retryButton,
                onImageError,
                onImageDragStart,
                onImageClick,
                onRetryClick,
                clearImageLoadWatchdog,
                cancelAutoRetry
            }) => {
                clearImageLoadWatchdog?.();
                cancelAutoRetry?.();
                image.removeEventListener('error', onImageError);
                image.removeEventListener('dragstart', onImageDragStart);
                image.removeEventListener('click', onImageClick);
                retryButton.removeEventListener('click', onRetryClick);
            });

            if (originalParent) {
                if (originalNext?.parentNode === originalParent) {
                    originalParent.insertBefore(readerImage, originalNext);
                } else {
                    originalParent.appendChild(readerImage);
                }
            }

            if (originalClass === null) {
                readerImage.removeAttribute('class');
            } else {
                readerImage.setAttribute('class', originalClass);
            }
            if (originalImageSrc === null) readerImage.removeAttribute('src');
            else readerImage.setAttribute('src', originalImageSrc);
            if (originalImageSrcset === null) readerImage.removeAttribute('srcset');
            else readerImage.setAttribute('srcset', originalImageSrcset);
            if (originalImageDataSrc === null) readerImage.removeAttribute('data-src');
            else readerImage.setAttribute('data-src', originalImageDataSrc);

            readerRoot?.remove();
            readerStyle?.remove();

            if (readerViewportCreated) {
                readerViewportMeta?.remove();
            } else if (readerViewportMeta) {
                if (originalViewportContent === null) {
                    readerViewportMeta.removeAttribute('content');
                } else {
                    readerViewportMeta.setAttribute(
                        'content',
                        originalViewportContent
                    );
                }
            }

            document.documentElement.classList.remove(
                'ehtw-reader',
                'ehtw-reader-click',
                'ehtw-reader-boot'
            );

            try {
                delete window[RUN_KEY];
            } catch (_) {
                window[RUN_KEY] = false;
            }

            console.warn('[EH Twitter Style] Reader setup failed', error);
            releasePageBoot();
        }

        return;
    }
    const isDetail = /^\/g\/\d+\/[0-9a-f]+\/?$/i.test(path);
    const isBountyPage = /^\/bounty\.php\/?$/i.test(path);
    const isMyUploadsPage = isUploadSiteOrigin(location.origin);
    let table = document.querySelector(
        'table.itg.gltc, table.itg.gltm, table.itg.glte, div.itg.gld'
    );
    const isList = !!table;
    const followingFeedMode = path.replace(/\/+$/, '') === '/watched'
        ? new URLSearchParams(location.search).get('ehtw_following')
        : null;
    const isFollowingAuthorsPage = followingFeedMode === 'authors';
    const isFollowingUploadersPage = followingFeedMode === 'uploaders';
    const isFollowingFeedPage = isFollowingAuthorsPage || isFollowingUploadersPage;

    // 其它列表显示模式只应用主题与三栏布局。
    const isOtherList =
        !isList &&
        !isDetail &&
        !!document.querySelector('#searchbox form') &&
        !!document.querySelector(
            'table.itg, .itg, .searchnav'
        );

    // 其余带原站导航的页面用通用布局；登录页只换主题，不建三栏。
    const isGeneric =
        !isList &&
        !isDetail &&
        !isOtherList &&
        !!document.querySelector('#nb');

    const MY_HOME_PATH_PATTERN = /^\/(?:home\.php|mytags\/?|uconfig\.php|stats\.php|hentaiathome\.php|bitcoin\.php|hathperks\.php|exchange\.php|logs\.php)$/i;
    const isMyHomePage = MY_HOME_PATH_PATTERN.test(path);
    const isMyTagsPage = /^\/mytags\/?$/i.test(path);

    const isLogin =
        !isGeneric &&
        !!document.querySelector('form[name="ipb_login_form"]');

    if (!isList && !isDetail && !isOtherList && !isGeneric && !isLogin) {
        releasePageBoot();
        return;
    }

    // ============================================================
    // 0.5.0：事务状态全部放在 try 外层
    //
    // catch 必须能够直接访问 rollback 及其依赖的状态。
    // 不依赖严格模式下 try 块内部的函数声明。
    // ============================================================

    let styleElement = null;
    let shell = null;
    let committed = false;
    let rollbackStarted = false;
    let listInfiniteObserver = null;
    let listInfiniteScrollFallback = null;
    let startListInfiniteContinuation = null;
    let startGalleryStripContinuation = null;
    let startFollowingAuthorTimeline = null;
    let startFollowingAuthorContinuation = null;
    let registerAdditionalStatsTweets = null;

    const moves = [];
    const modifications = [];
    const mediaListeners = [];
    const domListeners = [];
    const createdNodes = [];
    let skipTransactionTracking = false;

    let rollback = null;

    // 保存节点初始位置。
    // nextSibling 是原始 DOM 中的后继节点，不是复制节点。
    function rememberMove(node) {
        if (!node) return;

        moves.push({
            node,
            parent: node.parentNode,
            next: node.nextSibling
        });
    }

    function registerCreatedNode(node) {
        if (node) createdNodes.push(node);
        return node;
    }

    function registerMediaListener(mediaQuery, callback) {
        if (!mediaQuery || !callback) return;

        mediaQuery.addEventListener('change', callback);

        mediaListeners.push({
            mediaQuery,
            callback
        });
    }

    // ============================================================
    // 0.5.0：回滚函数在 try 之前定义
    // ============================================================

        rollback = function () {
            if (rollbackStarted) return;

            rollbackStarted = true;
            committed = false;

            try {
                listInfiniteObserver?.disconnect();
                listInfiniteObserver = null;
                if (listInfiniteScrollFallback) {
                    window.removeEventListener('scroll', listInfiniteScrollFallback);
                    listInfiniteScrollFallback = null;
                }
            } catch (_) {}

            // 先停止响应式监听，避免回滚期间再次搬移节点。
            for (let i = mediaListeners.length - 1; i >= 0; i--) {
                const item = mediaListeners[i];

                try {
                    item.mediaQuery.removeEventListener(
                        'change',
                        item.callback
                    );
                } catch (error) {
                    console.warn(
                        '[EH Twitter Style] 监听器清理失败',
                        error
                    );
                }
            }

            for (let i = domListeners.length - 1; i >= 0; i--) {
                const item = domListeners[i];
                try {
                    item.target.removeEventListener(
                        item.type,
                        item.listener,
                        item.options
                    );
                    item.cleanup?.();
                } catch (_) {}
            }

            // 必须先恢复原节点，再移除任何新建容器。
            // 包括导航原文字、#f_search、分类控件和分页。
            for (let i = moves.length - 1; i >= 0; i--) {
                const record = moves[i];

                try {
                    const { node, parent, next } = record;

                    if (!node || !parent) continue;

                    if (next && next.parentNode === parent) {
                        parent.insertBefore(node, next);
                    } else {
                        parent.appendChild(node);
                    }
                } catch (error) {
                    console.warn(
                        '[EH Twitter Style] 节点恢复失败',
                        error
                    );
                }
            }

            // 恢复原站节点的 class、事件属性及内联样式。
            for (let i = modifications.length - 1; i >= 0; i--) {
                const item = modifications[i];

                try {
                    if (item.type === 'attribute') {
                        if (item.existed) {
                            item.element.setAttribute(
                                item.name,
                                item.oldValue
                            );
                        } else {
                            item.element.removeAttribute(item.name);
                        }
                    } else if (item.type === 'style') {
                        if (item.oldValue) {
                            item.element.style.setProperty(
                                item.property,
                                item.oldValue,
                                item.oldPriority
                            );
                        } else {
                            item.element.style.removeProperty(
                                item.property
                            );
                        }
                    }
                } catch (error) {
                    console.warn(
                        '[EH Twitter Style] 属性恢复失败',
                        error
                    );
                }
            }

            // 即使某个新节点嵌入了原站 DOM，也必须将其移除。
            for (let i = createdNodes.length - 1; i >= 0; i--) {
                try {
                    createdNodes[i]?.remove();
                } catch (error) {
                    console.warn(
                        '[EH Twitter Style] 新建节点清理失败',
                        error
                    );
                }
            }

            try {
                shell?.remove();
            } catch (_) {}

            try {
                styleElement?.remove();
            } catch (_) {}

            try {
                document.documentElement.classList.remove(
                    'ehtw-enabled',
                    'ehtw-exhentai',
                    'ehtw-list',
                    'ehtw-detail',
                    'ehtw-myhome',
                    'ehtw-mytags',
                    'ehtw-myuploads',
                    'ehtw-bounty',
                    'ehtw-other',
                    'ehtw-generic',
                    'ehtw-login'
                );
            } catch (_) {}

            try {
                delete window[RUN_KEY];
            } catch (_) {
                window[RUN_KEY] = false;
            }

            console.info(
                '[EH Twitter Style] Rollback completed'
            );
        };

    try {
        window[RUN_KEY] = true;

        // ============================================================
        // 1. 基础工具
        // ============================================================

        function qs(selector, root = document) {
            try {
                return root?.querySelector(selector) || null;
            } catch (_) {
                return null;
            }
        }

        function qsa(selector, root = document) {
            try {
                return Array.from(
                    root?.querySelectorAll(selector) || []
                );
            } catch (_) {
                return [];
            }
        }

        function create(tag, className, text) {
            const el = document.createElement(tag);

            if (className) {
                el.className = className;
            }

            if (text !== undefined && text !== null) {
                el.textContent = String(text);
            }

            return el;
        }

        function textOf(node, fallback = '') {
            const value = node?.textContent?.trim();
            return value || fallback;
        }

        function append(parent, child) {
            if (parent && child) {
                parent.appendChild(child);
            }

            return child;
        }

        function setAttributeSafe(element, name, value) {
            if (!element) return;

        if (!skipTransactionTracking) {
            modifications.push({
                type: 'attribute',
                element,
                name,
                existed: element.hasAttribute(name),
                oldValue: element.getAttribute(name)
            });
        }

            element.setAttribute(name, String(value));
        }

        function addClassSafe(element, className) {
            if (!element || !className) return;

            setAttributeSafe(
                element,
                'class',
                [
                    element.getAttribute('class') || '',
                    className
                ].filter(Boolean).join(' ')
            );
        }

        function setStyleSafe(element, property, value) {
            if (!element) return;

        if (!skipTransactionTracking) {
            modifications.push({
                type: 'style',
                element,
                property,
                oldValue:
                    element.style.getPropertyValue(property),
                oldPriority:
                    element.style.getPropertyPriority(property)
            });
        }

            element.style.setProperty(property, value);
        }

        // 搬移真实 DOM 节点，保留 ID、事件和全部子节点。
        function move(node, target) {
            if (!node || !target || node === target) {
                return null;
            }

            if (node.contains(target)) {
                return null;
            }

            if (!skipTransactionTracking) rememberMove(node);
            target.appendChild(node);

            return node;
        }

        function extractBackgroundImage(element) {
            if (!element) return '';

            const inline = element.style.backgroundImage;

            if (inline && inline !== 'none') {
                return inline;
            }

            try {
                const computed =
                    getComputedStyle(element).backgroundImage;

                return computed !== 'none' ? computed : '';
            } catch (_) {
                return '';
            }
        }

        // 兼容原生 src 和 data-src 懒加载。
        function prepareImage(img) {
            if (!img) return;

            const src = img.getAttribute('src') || '';
            const dataSrc = img.getAttribute('data-src') || '';

            const placeholder =
                !src ||
                src === '#' ||
                src.startsWith(
                    'data:image/gif;base64,R0lGOD'
                );

            if (dataSrc && placeholder) {
                setAttributeSafe(img, 'src', dataSrc);
            }

            setAttributeSafe(img, 'loading', 'lazy');
            setAttributeSafe(img, 'decoding', 'async');
        }

        function makeAvatar(categoryName, categoryClass) {
            const avatar = create('div', 'ehtw-avatar');

            const validClass = /^ct(?:[1-9]|a)$/.test(
                categoryClass || ''
            ) ? categoryClass : 'ct1';

            avatar.classList.add(validClass);

            const letter = Array.from(categoryName || '?')[0] || '?';

            append(
                avatar,
                create(
                    'span',
                    'ehtw-avatar-letter',
                    letter.toUpperCase()
                )
            );

            // 颜色延后读取，避免原站样式尚未计算完成。
            const source = document.querySelector(
                '.' + validClass + ':not(.ehtw-avatar)'
            );

            if (source) {
                const color = getComputedStyle(source).borderColor;

                if (color && color !== 'transparent') {
                    avatar.style.setProperty(
                        '--ehtw-avatar-solid',
                        color
                    );
                }
            }

            return avatar;
        }

        function makeSectionTitle(text) {
            return create(
                'h2',
                'ehtw-section-title',
                text
            );
        }

        function makeEmptyHint(text) {
            return create('div', 'ehtw-empty', text);
        }

        function makeIcon(kind) {
            const paths = {
                home: [
                    'M3 10.5 12 3l9 7.5',
                    'M5 9.5V21h5v-7h4v7h5V9.5'
                ],
                eye: [
                    'M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z',
                    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'
                ],
                following: [
                    'M16 21v-2c0-2.5-1.8-4-4.5-4',
                    'M8 21v-2c0-3.5 2.2-5.5 5.5-5.5',
                    'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
                    'M17 8a3 3 0 1 1-2.5 4.7'
                ],
                flame: [
                    'M12 22c-4.5 0-8-3.3-8-7.5 0-3.4 2-5.4 4-7.7.1 2.4 1.2 3.2 2 3.7C10 6.2 12.6 3.4 14 2c-.1 4 2.1 5.8 3.7 7.8C19.1 11.5 20 13 20 15c0 4-3.5 7-8 7Z',
                    'M12 22c-2.2 0-4-1.6-4-3.7 0-1.8 1.1-3 2.5-4.6.1 1.3.8 1.8 1.4 2.2.5-1.5 1.5-2.4 2-3.2.2 1.8 2.1 3.3 2.1 5.5 0 2.2-1.7 3.8-4 3.8Z'
                ],
                download: [
                    'M12 3v12',
                    'm7 10 5 5 5-5',
                    'M4 18v3h16v-3'
                ],
                bookmark: [
                    'M6 3h12v18l-6-4-6 4V3Z'
                ],
                user: [
                    'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z',
                    'M3.5 21v-2c0-3.5 3.2-5.5 8.5-5.5s8.5 2 8.5 5.5v2'
                ],
                settings: [
                    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
                    'M19.4 13.5a7.8 7.8 0 0 0 0-3l1.7-1.3-1.7-3-2 .7a7.8 7.8 0 0 0-2.6-1.5L14.5 3h-5l-.4 2.4a7.8 7.8 0 0 0-2.6 1.5l-2-.7-1.7 3 1.7 1.3a7.8 7.8 0 0 0 0 3l-1.7 1.3 1.7 3 2-.7a7.8 7.8 0 0 0 2.6 1.5l.4 2.4h5l.4-2.4a7.8 7.8 0 0 0 2.6-1.5l2 .7 1.7-3-1.8-1.3Z'
                ],
                tag: [
                    'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z',
                    'M7.5 7.5h.01'
                ],
                login: [
                    'M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5',
                    'm10 17 5-5-5-5',
                    'M15 12H3'
                ],
                logout: [
                    'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5',
                    'm14 17-5-5 5-5',
                    'M9 12h12'
                ],
                upload: [
                    'M12 16V3',
                    'm7 8 5-5 5 5',
                    'M4 17v4h16v-4'
                ],
                list: [
                    'M8 6h13',
                    'M8 12h13',
                    'M8 18h13',
                    'M3 6h1',
                    'M3 12h1',
                    'M3 18h1'
                ],
                gift: [
                    'M3 10h18v11H3V10Z',
                    'M2 7h20v3H2V7Z',
                    'M12 7v14',
                    'M12 7C5 7 5 2 8 2c2 0 4 3 4 5Z',
                    'M12 7c7 0 7-5 4-5-2 0-4 3-4 5Z'
                ],
                news: [
                    'M4 3h16v18H4V3Z',
                    'M8 7h8',
                    'M8 11h8',
                    'M8 15h4',
                    'M15 15h2v3h-2z'
                ],
                chat: [
                    'M4 4h16v12H9l-5 4V4Z',
                    'M8 9h8',
                    'M8 12h5'
                ],
                book: [
                    'M12 6C9 3.5 5.5 3 2 4v15c3.5-1 7-.5 10 2',
                    'M12 6c3-2.5 6.5-3 10-2v15c-3.5-1-7-.5-10 2V6Z'
                ],
                globe: [
                    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
                    'M2 12h20',
                    'M12 2c-3 3-4.5 6.3-4.5 10S9 19 12 22',
                    'M12 2c3 3 4.5 6.3 4.5 10S15 19 12 22'
                ],
                more: [
                    'M5 10.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
                    'M12 10.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
                    'M19 10.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z'
                ],
                moreCircle: [
                    'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z',
                    'M7.5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
                    'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
                    'M16.5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z'
                ],
                search: [
                    'M10.8 3.3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z',
                    'm16.5 16.5 5 5'
                ],
                filter: [
                    'M3 6h18',
                    'M6 12h12',
                    'M9 18h6'
                ],
                reply: [
                    'M21 11.5c0 4.7-4 8.5-9 8.5-1.3 0-2.7-.3-3.8-.8L3 21l1.7-4.8A8.3 8.3 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z'
                ],
                repost: [
                    'M4 9V6a3 3 0 0 1 3-3h10l3 3',
                    'm16 3 4 3-4 3',
                    'M20 15v3a3 3 0 0 1-3 3H7l-3-3',
                    'm8 21-4-3 4-3'
                ],
                heart: [
                    'M12 21 3.8 12.8a5.6 5.6 0 0 1 7.9-7.9l.3.4.3-.4a5.6 5.6 0 0 1 7.9 7.9L12 21Z'
                ],
                views: [
                    'M4 21V13',
                    'M9 21V9',
                    'M14 21V14',
                    'M19 21V4'
                ],
                share: [
                    'M12 16V3',
                    'm7 8 5-5 5 5',
                    'M4 14v7h16v-7'
                ],
                back: [
                    'M20 12H4',
                    'm11 5-7 7 7 7'
                ]
            };

            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');

            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'currentColor');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            svg.setAttribute('class', 'ehtw-svg-icon');
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');

            const active = kind.endsWith('-filled');
            const baseKind = active ? kind.slice(0, -7) : kind;

            if (active && baseKind === 'home') {
                const path = document.createElementNS(ns, 'path');

                path.setAttribute(
                    'd',
                    'M12 2.2 1.8 10.7l1.4 1.7L5 10.9V21h5.3v-7h3.4v7H19V10.9l1.8 1.5 1.4-1.7L12 2.2Z'
                );
                path.setAttribute('fill', 'currentColor');
                svg.appendChild(path);

                return svg;
            }

            for (const d of paths[baseKind] || paths.more) {
                const path = document.createElementNS(ns, 'path');

                path.setAttribute('d', d);

                if (baseKind === 'more' || baseKind === 'moreCircle') {
                    // 三个点为实心；moreCircle 的外圈保持描边。
                    if (baseKind === 'moreCircle' && d === paths.moreCircle[0]) {
                        path.setAttribute('fill', 'none');
                        path.setAttribute('stroke', 'currentColor');
                        path.setAttribute('stroke-width', active ? '2.6' : '1.8');
                    } else {
                        path.setAttribute('fill', 'currentColor');
                        path.setAttribute('stroke', 'none');
                    }
                } else {
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', 'currentColor');
                    path.setAttribute(
                        'stroke-width',
                        active ? '2.6' : '1.8'
                    );
                }

                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');

                svg.appendChild(path);
            }

            return svg;
        }

        function makeAction(label, kind) {
            const item = create('div', 'ehtw-action');

            append(item, makeIcon(kind));

            if (label) {
                append(
                    item,
                    create(
                        'span',
                        'ehtw-action-label',
                        label
                    )
                );
            }

            return item;
        }

        // ============================================================
        // 2. CSS 主题
        // ============================================================

        const CSS = `
/* ============================================================
   EH Twitter Style 0.5.0
   ============================================================ */

html.ehtw-enabled {
    --ehtw-bg: #ffffff;
    --ehtw-text: #0f1419;
    --ehtw-muted: #536471;
    --ehtw-border: #eff3f4;
    --ehtw-accent: #1d9bf0;
    --ehtw-hover: rgba(15, 20, 25, 0.035);
    --ehtw-nav-hover: rgba(15, 20, 25, 0.09);
    --ehtw-card: #f7f9f9;
    --ehtw-input: #eff3f4;
    --ehtw-glass: rgba(255, 255, 255, 0.87);
    --ehtw-media: #f0f2f3;
    --ehtw-shadow: rgba(0, 0, 0, 0.08);

    color-scheme: light;
    background: var(--ehtw-bg) !important;
}

@media (prefers-color-scheme: dark) {
    html.ehtw-enabled {
        --ehtw-bg: #000000;
        --ehtw-text: #e7e9ea;
        --ehtw-muted: #71767b;
        --ehtw-border: #2f3336;
        --ehtw-accent: #1d9bf0;
        --ehtw-hover: rgba(231, 233, 234, 0.045);
        --ehtw-nav-hover: rgba(231, 233, 234, 0.11);
        --ehtw-card: #16181c;
        --ehtw-input: #202327;
        --ehtw-glass: rgba(0, 0, 0, 0.86);
        --ehtw-media: #16181c;
        --ehtw-shadow: rgba(255, 255, 255, 0.05);

        color-scheme: dark;
    }
}

html.ehtw-enabled,
html.ehtw-enabled body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
    font-family:
        -apple-system,
        "Segoe UI",
        Roboto,
        "Helvetica Neue",
        sans-serif !important;
    font-size: 15px;
}

html.ehtw-enabled {
    overflow-x: clip !important;
}

html.ehtw-enabled body {
    overflow-x: clip !important;
}

html.ehtw-enabled * {
    box-sizing: border-box;
}

html.ehtw-enabled div.ido {
    min-width: 0 !important;
    max-width: 100% !important;
    width: auto !important;
}

html.ehtw-enabled #toppane {
    min-width: 0 !important;
    max-width: 100% !important;
    width: auto !important;
}

html.ehtw-enabled #cdiv {
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-enabled .gm {
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-enabled #gmid,
html.ehtw-enabled #gd2,
html.ehtw-enabled #gd3,
html.ehtw-enabled #gd4,
html.ehtw-enabled #gd5,
html.ehtw-enabled #gdt {
    min-width: 0 !important;
    max-width: 100% !important;
}

/* 只处理 body 下已经搬空的原站 .gm 空壳。 */

html.ehtw-detail body > .gm {
    display: block !important;
    position: static !important;
    float: none !important;

    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;

    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    border: 0 !important;
    border-width: 0 !important;
    border-style: none !important;
    border-color: transparent !important;

    background: transparent !important;
    background-image: none !important;

    box-shadow: none !important;
    outline: none !important;

    overflow: hidden !important;
    visibility: hidden !important;
}

html.ehtw-enabled a {
    color: inherit;
}

html.ehtw-enabled a:hover {
    color: var(--ehtw-accent);
}

html.ehtw-enabled input,
html.ehtw-enabled select,
html.ehtw-enabled textarea,
html.ehtw-enabled button {
    font-family: inherit;
}

html.ehtw-enabled ins[data-width][data-height],
html.ehtw-enabled .ehtw-hidden-ad {
    display: none !important;
}

/* ============================================================
   三栏布局
   ============================================================ */

#ehtw-shell {
    width: min(100%, 1225px);
    max-width: 100%;
    min-width: 0;
    min-height: 100vh;

    margin: 0 auto;

    display: grid;
    grid-template-columns: 275px minmax(0, 600px) 350px;
    align-items: start;

    background: var(--ehtw-bg);
}

#ehtw-left {
    width: 275px;
    min-width: 0;
    max-width: 100%;

    min-height: 0;
    max-height: 100vh;

    position: sticky;
    top: 0;
    align-self: start;

    padding: 16px 12px 24px 8px;

    overflow-y: auto;
    overflow-x: hidden;

    scrollbar-width: none;
    -ms-overflow-style: none;

    overscroll-behavior-y: contain;
}

#ehtw-left::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

#ehtw-center {
    min-width: 0;
    max-width: 100%;
    min-height: 100vh;

    border-left: 1px solid var(--ehtw-border);
    border-right: 1px solid var(--ehtw-border);
}

#ehtw-right {
    width: 350px;
    min-width: 0;
    max-width: 100%;

    padding: 8px 24px 32px 24px !important;

    position: sticky;
    top: 0;
    align-self: start;

    max-height: 100vh;

    overflow-y: auto;
    overflow-x: hidden;

    scrollbar-width: thin;
}

/* ============================================================
   左侧导航
   ============================================================ */

#ehtw-brand {
    display: flex;
    align-items: center;
    gap: 12px;

    height: 64px;
    padding: 0 14px;
    margin-bottom: 8px;

    font-size: 24px;
    font-weight: 800;
    letter-spacing: -1px;
}

.ehtw-brand-symbol {
    width: 42px;
    height: 42px;

    display: grid;
    place-items: center;

    border-radius: 50%;

    background: var(--ehtw-text);
    color: var(--ehtw-bg);

    font-weight: 900;
    font-size: 26px;
}

#ehtw-left #nb {
    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;

    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;

    padding: 0 !important;
    margin: 0 !important;

    border: 0 !important;
    background: transparent !important;

    display: flex !important;
    flex-direction: column !important;
    flex-wrap: nowrap !important;
    align-items: flex-start;

    gap: 2px;

    white-space: normal !important;
    overflow: visible !important;
}

#ehtw-left #nb > div {
    display: block !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;

    margin: 0 !important;
    padding: 0 !important;

    float: none !important;

    background: transparent !important;
    border: none !important;

    white-space: normal !important;
    overflow-wrap: anywhere;
}

#ehtw-left #nb a {
    position: relative;

    width: fit-content;
    max-width: 100%;
    min-height: 49px;

    display: flex !important;
    align-items: center;

    border-radius: 9999px;

    padding: 11px 17px !important;
    margin: 0 !important;

    text-decoration: none !important;
    font-size: 19px !important;
    font-weight: 500;
    line-height: 1.35;

    color: var(--ehtw-text) !important;
    background: transparent !important;
    border: none !important;

    white-space: normal !important;
    overflow-wrap: anywhere;

    transition: background 0.15s ease;
}

#ehtw-left #nb a:hover {
    background: var(--ehtw-nav-hover) !important;
    color: var(--ehtw-text) !important;
}

.ehtw-nav-hint {
    margin-top: 18px;
    padding: 12px 18px;

    color: var(--ehtw-muted);
    font-size: 12px;
}

/* ============================================================
   中栏标题
   ============================================================ */

#ehtw-header {
    position: sticky;
    top: 0;
    z-index: 100;

    min-height: 58px;
    min-width: 0;

    display: flex;
    align-items: center;

    padding: 8px 16px;

    background: var(--ehtw-glass);

    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);

    border-bottom: 1px solid var(--ehtw-border);

    text-align: left !important;
}

#ehtw-header > div {
    min-width: 0;
    width: 100%;
    text-align: left !important;
}

#ehtw-header-title {
    display: block;

    width: 100%;
    min-width: 0;
    max-width: 100%;

    margin: 0;

    font-size: 20px !important;
    line-height: 1.3;
    font-weight: 800 !important;

    color: var(--ehtw-text);

    text-align: left !important;

    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

#ehtw-header-subtitle {
    margin-top: 3px;

    font-size: 12px;
    color: var(--ehtw-muted);

    text-align: left !important;
}

.ehtw-timeline {
    min-width: 0;
    max-width: 100%;
    width: 100%;
}

.ehtw-toplist-filter-pending {
    visibility: hidden !important;
}

/* ============================================================
   搜索框
   ============================================================ */

#ehtw-search-card {
    margin-bottom: 16px;
    min-width: 0;
    max-width: 100%;
}

.ehtw-search-toplists {
    display: grid;
    gap: 12px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--ehtw-border);
}

.ehtw-search-toplists:empty {
    display: none !important;
}

.ehtw-search-toplist-section {
    min-width: 0;
}

.ehtw-search-toplist-heading {
    display: block;
    margin-bottom: 4px;
    color: var(--ehtw-accent) !important;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none !important;
}

.ehtw-search-toplist-status {
    color: var(--ehtw-muted);
    font-size: 11px;
}

.ehtw-search-toplist-status:empty {
    display: none;
}

.ehtw-search-toplist-list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.ehtw-search-toplist-item {
    display: grid;
    grid-template-columns: 18px 44px minmax(0, 1fr);
    gap: 6px;
    align-items: center;
    min-height: 62px;
    padding: 4px 0;
}

.ehtw-search-toplist-more > summary {
    padding: 4px 0 2px 24px;
    color: var(--ehtw-muted);
    font-size: 11px;
    cursor: pointer;
    list-style-position: inside;
}

.ehtw-search-toplist-more {
    display: flex;
    flex-direction: column;
}

.ehtw-search-toplist-more > .ehtw-search-toplist-extra {
    order: 1;
}

.ehtw-search-toplist-more > summary {
    order: 2;
}

.ehtw-search-toplist-extra {
    margin-top: 2px !important;
}

.ehtw-search-toplist-rank {
    color: var(--ehtw-muted);
    font-size: 11px;
    text-align: right;
}

.ehtw-search-toplist-cover {
    display: block;
    width: 44px;
    height: 58px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--ehtw-surface);
}

.ehtw-search-toplist-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.ehtw-search-toplist-title {
    min-width: 0;
    color: var(--ehtw-text) !important;
    font-size: 11px;
    line-height: 1.3;
    text-decoration: none !important;
}

.ehtw-search-toplist-title:hover {
    color: var(--ehtw-accent) !important;
}

.ehtw-search-toplist-heading:hover {
    text-decoration: underline !important;
}

#ehtw-search-card #searchbox,
#ehtw-search-card #searchbox.idi,
#ehtw-mobile-search #searchbox,
#ehtw-mobile-search #searchbox.idi {
    position: static !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    display: block !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    float: none !important;
    overflow: visible !important;

    text-align: left !important;
}

/* 分类筛选使用原始节点，允许自动换行。 */

#ehtw-search-card table.itc,
#ehtw-mobile-search table.itc {
    display: flex !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    flex-direction: column;
    flex-wrap: wrap !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    text-align: left !important;
}

#ehtw-search-card table.itc > tbody,
#ehtw-mobile-search table.itc > tbody {
    display: flex !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    flex-direction: row !important;
    flex-wrap: wrap !important;

    gap: 4px;

    background: transparent !important;
}

#ehtw-search-card table.itc tr,
#ehtw-mobile-search table.itc tr {
    display: flex !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    flex-wrap: wrap !important;
    align-items: center;

    gap: 4px;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
}

#ehtw-search-card table.itc td,
#ehtw-mobile-search table.itc td {
    display: flex !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    align-items: center;

    margin: 0 !important;
    padding: 2px !important;

    background: transparent !important;
    border: none !important;

    white-space: normal !important;
}

#ehtw-search-card table.itc .cs,
#ehtw-search-card table.itc .cn,
#ehtw-mobile-search table.itc .cs,
#ehtw-mobile-search table.itc .cn {
    position: static !important;
    float: none !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 5px 8px !important;

    border-radius: 9999px;

    white-space: normal !important;
    overflow-wrap: anywhere;

    cursor: pointer;
}

#ehtw-search-card form,
#ehtw-mobile-search form {
    width: 100%;
    min-width: 0;
    max-width: 100%;

    display: flex;
    flex-wrap: wrap;
    align-items: center;

    gap: 6px;

    margin: 0;
    padding: 0;

    border: none !important;
    border-radius: 0;

    background: transparent !important;
    color: var(--ehtw-text);

    text-align: left !important;
}

/* 搜索输入胶囊。 */

#ehtw-search-card #f_search,
#ehtw-mobile-search #f_search {
    display: block !important;

    flex: 1 1 100%;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: 44px !important;
    min-height: 44px !important;

    padding: 0 16px !important;
    margin: 0 0 8px !important;

    border: 1px solid transparent !important;
    border-radius: 9999px !important;

    outline: none !important;
    box-shadow: none !important;

    background: var(--ehtw-input) !important;
    color: var(--ehtw-text) !important;

    font-size: 14px !important;
    line-height: normal !important;
    text-align: left !important;

    transition:
        border-color 0.15s ease,
        background-color 0.15s ease;
}

#ehtw-search-card #f_search::placeholder,
#ehtw-mobile-search #f_search::placeholder {
    color: var(--ehtw-muted) !important;
    opacity: 1;
}

#ehtw-search-card #f_search:focus,
#ehtw-mobile-search #f_search:focus {
    border: 1px solid var(--ehtw-accent) !important;

    background: var(--ehtw-bg) !important;

    outline: none !important;
    box-shadow: none !important;
}

#ehtw-search-card input:not(#f_search),
#ehtw-search-card select,
#ehtw-search-card button,
#ehtw-mobile-search input:not(#f_search),
#ehtw-mobile-search select,
#ehtw-mobile-search button {
    max-width: 100%;
    min-width: 0;

    color: var(--ehtw-text);
    background: var(--ehtw-bg);

    border: 1px solid var(--ehtw-border);
    border-radius: 12px;

    padding: 5px 8px;
    font-size: 12px;
}

#ehtw-search-card input[type="checkbox"],
#ehtw-search-card input[type="radio"],
#ehtw-mobile-search input[type="checkbox"],
#ehtw-mobile-search input[type="radio"] {
    width: auto;
    padding: 0;
}

#ehtw-search-card label,
#ehtw-mobile-search label {
    color: var(--ehtw-muted);
    font-size: 12px;
}

/* ============================================================
   右栏卡片
   ============================================================ */

.ehtw-side-card {
    overflow: hidden;

    width: 100%;
    min-width: 0;
    max-width: 100%;

    margin-bottom: 16px;
    padding: 14px 0;

    border-radius: 16px;

    background: var(--ehtw-card);
    color: var(--ehtw-text);

    text-align: left !important;
}

.ehtw-side-card * {
    text-align: left;
}

.ehtw-side-title {
    margin: 0 16px 12px;

    font-size: 20px;
    font-weight: 800;
    line-height: 1.3;

    text-align: left !important;
}

.ehtw-trend {
    display: block;
    padding: 8px 16px;

    text-decoration: none !important;
    color: var(--ehtw-text) !important;

    text-align: left !important;
    transition: background 0.15s ease;
}

.ehtw-trend:hover {
    background: var(--ehtw-nav-hover);
    color: var(--ehtw-text) !important;
}

.ehtw-trend-category {
    display: block;

    font-size: 11px;
    line-height: 1.25;

    color: var(--ehtw-muted);
}

.ehtw-trend-name {
    display: block;

    font-size: 15px;
    font-weight: 700;
    line-height: 1.3;

    overflow-wrap: anywhere;
    padding: 2px 0;
}

.ehtw-trend-count {
    font-size: 11px;
    line-height: 1.25;
    color: var(--ehtw-muted);
}

/* ============================================================
   列表分页
   ============================================================ */

.ehtw-pagination {
    width: 100%;
    min-width: 0;
    max-width: 100%;

    border-bottom: 1px solid var(--ehtw-border);
    border-top: 1px solid var(--ehtw-border);

    padding: 10px 12px;
}

html.ehtw-list .ehtw-list-pagination-hidden {
    display: none !important;
}

html.ehtw-list .ehtw-list-infinite-status {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 56px;
    padding: 12px 16px;
    color: var(--ehtw-muted);
    font-size: 13px;
    text-align: center;
}

html.ehtw-list .ehtw-list-infinite-status button {
    padding: 8px 14px;
    border: 1px solid var(--ehtw-border);
    border-radius: 999px;
    background: var(--ehtw-bg);
    color: var(--ehtw-text);
    cursor: pointer;
}

.ehtw-pagination .searchnav {
    position: static !important;
    float: none !important;

    display: flex !important;
    flex-wrap: wrap;

    justify-content: center;
    align-items: center;

    gap: 5px;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 36px;

    padding: 0 !important;
    margin: 0 !important;

    border: none !important;
    background: transparent !important;

    overflow: visible !important;
}

.ehtw-pagination .searchnav > div {
    position: static !important;
    float: none !important;

    width: auto !important;
    min-width: 0;
    max-width: 100%;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;

    line-height: normal !important;
}

.ehtw-pagination .searchnav a,
.ehtw-pagination .searchnav span[id],
.ehtw-pagination .searchnav select {
    display: inline-flex;

    align-items: center;
    justify-content: center;

    min-height: 34px;
    padding: 6px 10px;

    border-radius: 9999px;
    border: 1px solid var(--ehtw-border);

    color: var(--ehtw-text) !important;
    background: var(--ehtw-bg) !important;

    font-size: 12px;
    text-decoration: none !important;
}

.ehtw-pagination .searchnav a:hover,
.ehtw-pagination .searchnav select:hover {
    background: var(--ehtw-nav-hover) !important;
}

.ehtw-pagination .searchnav select {
    cursor: pointer;
    max-width: 160px;
}

.ehtw-pagination .searchnav .jumpbox {
    position: relative;
}

.ehtw-pagination .searchnav span[id] {
    opacity: 0.45;
}

/* ============================================================
   推文列表
   ============================================================ */

.ehtw-tweet {
    position: relative;

    display: flex;
    gap: 12px;

    width: 100%;
    min-width: 0;
    max-width: 100%;

    padding: 14px 16px 16px;

    border-bottom: 1px solid var(--ehtw-border);

    background: var(--ehtw-bg);
    color: var(--ehtw-text);

    transition: background 0.12s ease;
}

.ehtw-tweet:hover {
    background: var(--ehtw-hover);
}

.ehtw-avatar {
    flex: 0 0 48px;

    width: 48px;
    height: 48px;

    border-radius: 50% !important;

    display: flex;
    align-items: center;
    justify-content: center;

    color: white !important;

    font-size: 22px;
    font-weight: 800;
    line-height: 1;

    overflow: hidden;
    user-select: none;

    border: none !important;
    box-shadow: none !important;
    outline: none !important;

    text-align: center !important;
}

/* 不覆盖原站 ct1～cta 的背景颜色。 */

.ehtw-avatar-letter {
    display: inline-block;

    color: white !important;
    font: inherit;
    line-height: 1;

    text-align: center !important;
}

.ehtw-tweet-content {
    min-width: 0;
    max-width: 100%;
    flex: 1;
}

.ehtw-tweet-author {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;

    gap: 5px;
    min-height: 23px;
    margin-bottom: 5px;

    line-height: 1.4;
}

.ehtw-author-name {
    min-width: 0;
    max-width: 100%;

    font-size: 15px;
    font-weight: 800;

    color: var(--ehtw-text);
    overflow-wrap: anywhere;
}

.ehtw-author-name a {
    color: var(--ehtw-text) !important;
    font-weight: 800;
    text-decoration: none !important;
}

.ehtw-author-name a:hover {
    text-decoration: underline !important;
}

.ehtw-handle,
.ehtw-time,
.ehtw-dot {
    font-size: 14px;
    color: var(--ehtw-muted) !important;
}

.ehtw-time [onclick],
.ehtw-time a {
    color: var(--ehtw-muted) !important;
    cursor: pointer;
}

.ehtw-tweet-title {
    margin: 3px 0 10px;

    font-size: 15px;
    line-height: 1.5;

    overflow-wrap: anywhere;
    white-space: normal;
}

.ehtw-tweet-title a {
    display: block;

    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

.ehtw-tweet-title a:hover {
    color: var(--ehtw-accent) !important;
}

.ehtw-tweet-title .glink {
    font-size: 15px !important;
    line-height: 1.5 !important;

    color: inherit !important;
    font-weight: 400 !important;

    text-align: left !important;
    white-space: normal !important;
}

.ehtw-tweet-title a > div:not(.glink):not(.gl4t):not(.gl4e):not(.glname) {
    display: none !important;
}

.ehtw-tweet-title a > .gl4e.glname {
    display: block !important;
    position: static !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
}

.ehtw-tweet-title a > .gl4e.glname > .glink {
    display: block !important;
    position: static !important;
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    white-space: normal !important;
}

.ehtw-tweet-title a > .gl4e.glname > div:not(.glink) {
    display: none !important;
}

/* 标签 */

.ehtw-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;

    gap: 5px 9px;

    width: 100%;
    min-width: 0;

    margin: 8px 0 12px;
}

.ehtw-hashtag {
    display: inline-flex;
    align-items: center;

    max-width: 100%;

    border: none !important;
    background: transparent !important;

    color: var(--ehtw-accent) !important;

    font-size: 13px !important;
    font-weight: 500;
    line-height: 1.45;

    overflow-wrap: anywhere;
    cursor: pointer;
}

.ehtw-hashtag::before {
    content: "#";
    color: var(--ehtw-accent);
}

.ehtw-hashtag:hover {
    text-decoration: underline;
}

.ehtw-hashtag a {
    color: var(--ehtw-accent) !important;
    text-decoration: none !important;
}

.ehtw-hashtag a:hover {
    text-decoration: underline !important;
}

/* 大图媒体 */

.ehtw-media {
    width: 100%;
    max-width: 100%;
    min-width: 0;

    margin-top: 10px;
    overflow: hidden;

    border: 1px solid var(--ehtw-border);
    border-radius: 16px;

    background: var(--ehtw-media);
}

.ehtw-media-link {
    display: block;
    width: 100%;
    text-decoration: none;
}

.ehtw-media img {
    display: block !important;

    width: 100% !important;
    max-width: 100% !important;
    max-height: 510px !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 auto !important;
    padding: 0 !important;

    border: none !important;
    border-radius: 0 !important;

    object-fit: cover;
    object-position: center;

    background: var(--ehtw-media);
}

/* 底部操作栏 */

.ehtw-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;

    gap: 8px;
    margin-top: 12px;

    color: var(--ehtw-muted);
    font-size: 13px;
}

.ehtw-action {
    display: inline-flex;
    align-items: center;

    gap: 7px;
    min-width: 0;

    color: var(--ehtw-muted);
    font-size: 13px;
}

.ehtw-action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 25px;
    height: 25px;

    border-radius: 50%;
    font-size: 18px;

    color: var(--ehtw-muted);
}

.ehtw-action:hover .ehtw-action-icon {
    background: rgba(29, 155, 240, 0.10);
    color: var(--ehtw-accent);
}

.ehtw-action a {
    color: var(--ehtw-muted) !important;
}

.ehtw-action .ir {
    display: inline-block !important;
    flex: none;

    position: relative !important;
    float: none !important;

    margin: 0 !important;
    padding: 0 !important;

    transform: none !important;

    /* 保留原始 background-position。 */
}

.ehtw-action .gldown {
    display: inline-flex !important;

    position: static !important;
    float: none !important;

    width: auto !important;
    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
}

.ehtw-action .gldown img {
    max-width: 30px;
    max-height: 30px;
    cursor: pointer;
}

.ehtw-action .cn {
    display: inline-flex !important;

    width: auto !important;
    min-width: 0 !important;
    height: auto !important;
    max-width: 100%;

    padding: 4px 9px !important;
    margin: 0 !important;

    border-radius: 9999px;

    font-size: 11px !important;
    line-height: 1.3 !important;

    cursor: pointer;
}

html.ehtw-list .glthumb {
    display: none !important;
}

/* ============================================================
   详情页
   ============================================================ */

.ehtw-detail-main {
    min-width: 0;
    max-width: 100%;
    width: 100%;
}

.ehtw-detail-post {
    min-width: 0;
    max-width: 100%;

    padding: 16px;
    border-bottom: 1px solid var(--ehtw-border);
}

.ehtw-detail-author {
    display: flex;
    align-items: center;

    gap: 12px;
    margin-bottom: 14px;
}

.ehtw-detail-author-meta {
    flex: 1 1 auto;
    min-width: 0;

    display: flex;
    flex-direction: column;
    gap: 3px;
}

.ehtw-detail-author-meta a {
    color: var(--ehtw-text) !important;
    font-weight: 800;
    text-decoration: none !important;
}

.ehtw-detail-author-meta a:hover {
    text-decoration: underline !important;
}

.ehtw-detail-follow-actions {
    display: flex;
    flex-wrap: wrap;
    flex: 0 1 auto;
    justify-content: flex-end;
    align-content: center;
    align-items: center;
    max-width: 52%;
    margin: 0 0 0 auto;
    gap: 6px;
}

.ehtw-detail-follow-status {
    flex-basis: 100%;
    min-height: 0;
    color: var(--ehtw-muted);
    font-size: 12px;
    text-align: right;
}

.ehtw-detail-follow-status:empty {
    display: none;
}

.ehtw-detail-follow-status.is-error {
    color: #e57373;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button {
    display: inline-flex !important;
    flex: 0 0 auto;
    align-items: center !important;
    justify-content: center !important;
    min-width: 0 !important;
    min-height: 32px !important;
    margin: 0 !important;
    padding: 5px 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: #1d9bf0 !important;
    font: inherit;
    font-size: 13px !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    white-space: nowrap;
    cursor: pointer !important;
    transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button::before {
    content: '+';
    display: inline-block;
    margin-right: 5px;
    font-size: 15px;
    font-weight: 500;
    line-height: 1;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button[aria-pressed="true"]::before {
    content: '✓';
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button:hover {
    border-color: rgba(29, 155, 240, .65) !important;
    background: rgba(29, 155, 240, .10) !important;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button[aria-pressed="true"] {
    border-color: #1d9bf0 !important;
    background: #1d9bf0 !important;
    color: #fff !important;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button[aria-pressed="true"]:hover {
    border-color: rgba(244, 33, 46, .65) !important;
    background: rgba(244, 33, 46, .10) !important;
    color: #f4212e !important;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button:disabled {
    opacity: .65;
    cursor: wait !important;
}

html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button:focus-visible {
    outline: 2px solid #1d9bf0 !important;
    outline-offset: 2px;
}

@media (max-width: 699px) {
    html.ehtw-detail .ehtw-detail-author {
        align-items: flex-start;
    }

    html.ehtw-detail .ehtw-detail-follow-actions {
        max-width: 56%;
        gap: 5px;
    }

    html.ehtw-detail .ehtw-detail-follow-actions > .ehtw-detail-follow-button {
        min-height: 30px !important;
        padding: 4px 9px !important;
        font-size: 12px !important;
    }
}

.ehtw-detail-post #gd2 {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 0 12px !important;
    padding: 0 !important;

    text-align: left !important;

    background: transparent !important;
    border: none !important;
}

.ehtw-detail-post #gn {
    display: block !important;

    width: 100% !important;
    height: auto !important;

    margin: 0 0 8px !important;
    padding: 0 !important;

    color: var(--ehtw-text) !important;
    background: transparent !important;

    font-size: 19px !important;
    font-weight: 700 !important;
    line-height: 1.5 !important;

    text-align: left !important;
    overflow-wrap: anywhere;
}

.ehtw-detail-post #gj {
    display: block !important;

    width: 100% !important;
    height: auto !important;

    margin: 0 0 14px !important;
    padding: 0 !important;

    color: var(--ehtw-muted) !important;
    background: transparent !important;

    font-size: 14px !important;
    font-weight: 400 !important;
    line-height: 1.5 !important;

    text-align: left !important;
    overflow-wrap: anywhere;
}

.ehtw-detail-cover {
    width: 100%;
    max-width: 100%;
    min-width: 0;

    margin: 12px 0 16px;

    border-radius: 16px;
    overflow: hidden;

    border: 1px solid var(--ehtw-border);
    background: var(--ehtw-media);
}

.ehtw-detail-cover #gleft {
    display: block !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    float: none !important;
    position: static !important;

    background: transparent !important;
    border: none !important;
}

.ehtw-detail-cover #gd1 {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 320px;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;
}

.ehtw-detail-cover #gd1 > div {
    display: block !important;

    position: relative !important;
    float: none !important;

    width: 100% !important;
    max-width: 100% !important;

    height: min(72vw, 510px) !important;
    min-height: 320px;

    margin: 0 auto !important;
    padding: 0 !important;

    border: 0 !important;

    background-repeat: no-repeat !important;
    background-position: center center !important;
    background-size: contain !important;
}

/* 详情元信息 */

.ehtw-detail-meta {
    margin-top: 14px;

    border-top: 1px solid var(--ehtw-border);
    border-bottom: 1px solid var(--ehtw-border);

    padding: 12px 0;
}

.ehtw-detail-meta #gmid {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;
}

.ehtw-detail-meta #gd3 {
    position: static !important;
    float: none !important;

    display: flex !important;
    flex-direction: column;
    gap: 12px;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;
}

.ehtw-detail-meta #gdc,
.ehtw-detail-meta #gdn,
.ehtw-detail-meta #gdd,
.ehtw-detail-meta #gdr,
.ehtw-detail-meta #gdf {
    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background-color: transparent !important;

    color: var(--ehtw-text) !important;
}

.ehtw-detail-meta #gdc .cs {
    display: inline-flex !important;

    position: static !important;
    float: none !important;

    width: auto !important;
    height: auto !important;

    padding: 5px 12px !important;

    border-radius: 9999px;
    cursor: pointer;
}

.ehtw-detail-meta #gdd table {
    display: table;

    width: 100%;
    max-width: 100%;

    border-collapse: collapse;
    background: transparent !important;
}

.ehtw-detail-meta #gdd tr {
    border-bottom: 1px solid var(--ehtw-border);
}

.ehtw-detail-meta #gdd td {
    padding: 8px 5px !important;

    border: none !important;
    background: transparent !important;

    color: var(--ehtw-text) !important;
    font-size: 13px;

    overflow-wrap: anywhere;
}

.ehtw-detail-meta #gdd .gdt1 {
    width: 35%;
    color: var(--ehtw-muted) !important;
}

.ehtw-detail-meta #gdr {
    overflow: visible !important;
}

.ehtw-detail-meta #gdr table {
    max-width: 100%;
}

.ehtw-detail-meta #gdr .ir,
.ehtw-detail-meta #gdr #rating_image {
    background-position: revert-layer;
}

.ehtw-detail-meta #gdf {
    display: block !important;
    cursor: pointer;
}

.ehtw-detail-meta #gdf a {
    color: var(--ehtw-accent) !important;
}

/* 命名空间标签 */

.ehtw-detail-tags {
    margin-top: 16px;
    padding-bottom: 4px;

    min-width: 0;
    max-width: 100%;
}

.ehtw-detail-tags #gd4,
.ehtw-detail-tags #taglist {
    position: static !important;
    float: none !important;

    display: block !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    overflow: visible !important;
}

.ehtw-detail-tags #taglist table {
    width: 100%;
    max-width: 100%;

    border-collapse: separate;
    border-spacing: 0 9px;

    background: transparent !important;
}

.ehtw-detail-tags #taglist tr {
    background: transparent !important;
}

.ehtw-detail-tags #taglist td {
    height: auto !important;

    padding: 5px 8px !important;

    background: transparent !important;
    border: none !important;

    vertical-align: top;
    color: var(--ehtw-text) !important;
}

.ehtw-detail-tags #taglist td.tc {
    width: 115px;
    min-width: 0;

    padding-top: 8px !important;

    font-size: 12px;
    font-weight: 700;

    color: var(--ehtw-muted) !important;

    text-align: right;
    overflow-wrap: anywhere;
}

.ehtw-detail-tags #taglist td:not(.tc) {
    line-height: 1.8;
}

.ehtw-detail-tags #taglist .gt {
    display: inline-flex !important;

    position: static !important;
    float: none !important;

    max-width: 100%;
    width: auto !important;
    height: auto !important;

    min-height: 24px;

    margin: 2px 4px 2px 0 !important;
    padding: 3px 9px !important;

    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;

    background: transparent !important;
    color: var(--ehtw-accent) !important;

    font-size: 12px !important;
    line-height: 1.5 !important;

    white-space: normal !important;
    overflow-wrap: anywhere;
}

.ehtw-detail-tags #taglist .gt::before {
    content: "#";
    color: var(--ehtw-accent);
}

.ehtw-detail-tags #taglist .gt a {
    color: var(--ehtw-accent) !important;
    text-decoration: none !important;
}

.ehtw-detail-tags #taglist .gt:hover {
    background: rgba(29, 155, 240, 0.10) !important;
}

/* 详情操作链接 */

.ehtw-operation-card {
    padding-bottom: 10px;
    text-align: left !important;
}

.ehtw-operation-card #gd5 {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 12px 10px !important;

    border: none !important;
    background: transparent !important;

    color: var(--ehtw-text) !important;

    text-align: left !important;
    overflow-wrap: anywhere;
}

.ehtw-operation-card #gd5 a {
    color: var(--ehtw-accent) !important;
}

#ehtw-mobile-operations {
    display: none;
    min-width: 0;
    max-width: 100%;
}

#ehtw-mobile-operations .ehtw-operation-card {
    margin: 12px;

    width: calc(100% - 24px);
    max-width: calc(100% - 24px);

    text-align: left !important;
}

/* ============================================================
   画廊缩略图网格
   ============================================================ */

.ehtw-gallery-grid-section {
    width: 100%;
    min-width: 0;
    max-width: 100%;

    padding: 12px 12px 18px;

    border-bottom: 1px solid var(--ehtw-border);
}

.ehtw-gallery-grid-section #gdt {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    overflow: visible !important;
    text-align: center;
}

.ehtw-gallery-grid-section #gdt a {
    display: inline-block;
    max-width: 100%;

    margin: 3px;
    vertical-align: top;
}

.ehtw-gallery-grid-section #gdt img {
    max-width: 100%;
    border-radius: 9px;
}

/* ============================================================
   0.5.0：画廊上下分页
   上分页 table.ptt
   下分页 table.ptb
   两者应用完全相同的胶囊样式。
   ============================================================ */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination {
    width: 100%;
    min-width: 0;
    max-width: 100%;

    padding: 12px 10px;

    border-bottom: 1px solid var(--ehtw-border);
    background: var(--ehtw-bg) !important;

    text-align: left !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination .gtb {
    display: flex !important;
    flex-direction: column;
    align-items: flex-start;

    gap: 8px;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;

    color: var(--ehtw-text) !important;
    text-align: left !important;

    overflow: visible !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination .gtb p.gpc {
    position: static !important;
    float: none !important;

    display: block !important;

    width: auto !important;
    max-width: 100% !important;
    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    background-image: none !important;

    border: none !important;
    box-shadow: none !important;

    color: var(--ehtw-muted) !important;

    font-size: 12px !important;
    line-height: 1.5 !important;
    font-weight: 400 !important;

    text-align: left !important;
    overflow-wrap: anywhere;
}

/* ptt 和 ptb：表格容器。 */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination .gtb table.ptt,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination .gtb table.ptb {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    background-image: none !important;

    border: none !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;

    overflow: visible !important;
}

/* tbody */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt > tbody,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb > tbody {
    display: flex !important;
    flex-wrap: wrap !important;

    align-items: center;
    justify-content: flex-start;

    gap: 6px;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    background: transparent !important;
}

/* tr */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr {
    display: flex !important;
    align-items: center;
    flex-wrap: wrap !important;

    gap: 6px;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;
}

/* 普通 td */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;

    position: static !important;
    float: none !important;

    width: auto !important;
    min-width: 32px !important;
    max-width: 100% !important;

    height: 32px !important;
    min-height: 32px !important;
    max-height: none !important;

    margin: 0 !important;
    padding: 0 !important;

    border: 0 !important;
    border-width: 0 !important;
    border-style: none !important;

    border-radius: 9999px !important;

    background: transparent !important;
    background-image: none !important;

    box-shadow: none !important;
    outline: none !important;

    color: var(--ehtw-text) !important;

    font-size: 12px !important;
    line-height: 1.4 !important;

    text-align: center !important;
    vertical-align: middle !important;

    overflow: hidden !important;
}

/* 普通页链接 */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td a,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td a {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;

    position: static !important;

    width: 100% !important;
    min-width: 32px !important;
    max-width: 100% !important;

    height: 32px !important;
    min-height: 32px !important;

    padding: 0 11px !important;
    margin: 0 !important;

    border: none !important;
    border-radius: 9999px !important;

    background: transparent !important;
    background-image: none !important;

    box-shadow: none !important;

    color: var(--ehtw-text) !important;

    font-size: 12px !important;
    font-weight: 500 !important;
    line-height: 32px !important;

    text-align: center !important;
    text-decoration: none !important;

    white-space: nowrap;
}

/* 悬停 */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td a:hover,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td a:hover {
    background: var(--ehtw-nav-hover) !important;
    color: var(--ehtw-accent) !important;
}

/* 当前页：ptds */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td.ptds,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td.ptds {
    background: var(--ehtw-accent) !important;
    color: #ffffff !important;
    font-weight: 800 !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td.ptds a,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td.ptds a {
    background: var(--ehtw-accent) !important;
    color: #ffffff !important;
    font-weight: 800 !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td.ptds a:hover,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td.ptds a:hover {
    background: var(--ehtw-accent) !important;
    color: #ffffff !important;
}

/* 禁用项：ptdd */

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td.ptdd,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td.ptdd {
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-weight: 400 !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td.ptdd a,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td.ptdd a {
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-weight: 400 !important;
}

/* ============================================================
   页脚
   ============================================================ */

#ehtw-left .ehtw-footer {
    width: 100%;
    min-width: 0;
    max-width: 100%;

    margin-top: 22px;
    padding: 12px 16px;

    border-top: 1px solid var(--ehtw-border);

    color: var(--ehtw-muted);
    font-size: 11px;
    line-height: 1.6;

    text-align: left;
    overflow-wrap: anywhere;
}

#ehtw-left .ehtw-footer .dp {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;

    color: var(--ehtw-muted) !important;
    font-size: 11px !important;
    line-height: 1.6 !important;

    text-align: left !important;

    white-space: normal !important;
    overflow-wrap: anywhere;
}

#ehtw-left .ehtw-footer .dp a {
    display: inline !important;

    width: auto !important;
    min-height: 0 !important;
    max-width: 100%;

    padding: 0 !important;
    margin: 0 4px 0 0 !important;

    border: none !important;
    border-radius: 0 !important;

    background: transparent !important;
    color: var(--ehtw-muted) !important;

    font-size: 11px !important;
    font-weight: 400 !important;
    line-height: inherit !important;

    text-decoration: none !important;
    white-space: normal !important;
}

#ehtw-left .ehtw-footer .dp a:hover {
    color: var(--ehtw-accent) !important;
    text-decoration: underline !important;
}

/* ============================================================
   评论与回复
   ============================================================ */

.ehtw-comments-section {
    min-width: 0;
    max-width: 100%;
    width: 100%;

    padding-top: 12px;
}

.ehtw-comments-section > .ehtw-section-title {
    padding: 0 16px 12px;
    text-align: left !important;
}

.ehtw-comments-section #cdiv {
    position: static !important;
    float: none !important;

    display: block !important;

    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    border: none !important;
    background: transparent !important;
}

.ehtw-comments-section #cdiv .c1 {
    position: relative !important;
    float: none !important;

    display: block !important;

    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;

    height: auto !important;
    min-height: 70px;

    margin: 0 !important;
    padding: 16px 16px 16px 76px !important;

    border: none !important;
    border-bottom: 1px solid var(--ehtw-border) !important;

    border-radius: 0 !important;

    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;

    overflow-wrap: anywhere;
    transition: background 0.15s ease;
}

.ehtw-comments-section #cdiv .c1:hover {
    background: var(--ehtw-hover) !important;
}

.ehtw-comments-section #cdiv .c1::before {
    content: "↩";

    position: absolute;
    left: 16px;
    top: 16px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;

    border-radius: 50%;

    background: var(--ehtw-input);
    color: var(--ehtw-muted);

    font-size: 23px;
}

.ehtw-comments-section #cdiv .c1 .c2 {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    align-items: baseline !important;

    gap: 4px 12px;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 0 9px !important;
    padding: 0 !important;

    background: transparent !important;
    background-image: none !important;

    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;

    color: var(--ehtw-text) !important;
    text-align: left !important;

    overflow: visible !important;
}

.ehtw-comments-section #cdiv .c1 .c3,
.ehtw-comments-section #cdiv .c1 .c4 {
    display: inline-flex !important;
    align-items: baseline !important;
    flex-wrap: wrap !important;

    gap: 4px;

    position: static !important;
    float: none !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    background-image: none !important;

    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;

    font-size: 13px !important;
    line-height: 1.5 !important;

    color: var(--ehtw-muted) !important;
    text-align: left !important;

    white-space: normal !important;
    overflow-wrap: anywhere;
}

.ehtw-comments-section #cdiv .c1 .c3 a {
    color: var(--ehtw-text) !important;

    font-size: 14px !important;
    font-weight: 800 !important;

    background: transparent !important;
    border: none !important;

    text-decoration: none !important;
}

.ehtw-comments-section #cdiv .c1 .c3 a:hover {
    color: var(--ehtw-accent) !important;
    text-decoration: underline !important;
}

.ehtw-comments-section #cdiv .c1 .c4,
.ehtw-comments-section #cdiv .c1 .c4 * {
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

.ehtw-comments-section #cdiv .c1 .c2 > .c {
    position: static !important;
    float: none !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    background-image: none !important;

    border: none !important;
    box-shadow: none !important;

    color: var(--ehtw-muted) !important;
}

.ehtw-comments-section #cdiv .c1 .c6 {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;

    background: transparent !important;
    background-image: none !important;

    color: var(--ehtw-text) !important;

    font-size: 14px;
    line-height: 1.65;

    text-align: left !important;
    overflow-wrap: anywhere;
}

/* 评论投票控件保持原始 DOM 和事件。 */

.ehtw-comments-section #cdiv .c1 .c7 {
    max-width: 100% !important;
    min-width: 0 !important;

    background-color: transparent !important;

    color: var(--ehtw-muted) !important;
    text-align: left !important;
}

.ehtw-comments-section #cdiv .c1 a {
    color: var(--ehtw-accent) !important;
}

.ehtw-comments-section #cdiv .c1 .c3 a {
    color: var(--ehtw-text) !important;
}

.ehtw-comments-section #cdiv .c1,
.ehtw-comments-section #cdiv .c1 div,
.ehtw-comments-section #cdiv .c1 p {
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
}

.ehtw-comments-section #postnewcomment {
    display: block !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;

    height: auto !important;

    margin: 0 !important;
    padding: 16px !important;

    border: none !important;
    border-top: 1px solid var(--ehtw-border) !important;

    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
}

.ehtw-comments-section textarea {
    max-width: 100%;
    min-width: 0;

    color: var(--ehtw-text) !important;
    background: var(--ehtw-card) !important;

    border: 1px solid var(--ehtw-border) !important;
    border-radius: 12px;

    padding: 12px;
}

.ehtw-comments-section input,
.ehtw-comments-section button {
    max-width: 100%;
}

/* ============================================================
   其它列表显示模式
   ============================================================ */

.ehtw-other-content {
    padding: 12px;

    min-width: 0;
    max-width: 100%;
    width: 100%;
}

.ehtw-other-content .itg,
.ehtw-other-content table {
    max-width: 100%;
}

.ehtw-other-content img {
    max-width: 100%;
}

.ehtw-other-content .searchnav {
    max-width: 100%;
}

html.ehtw-other #ehtw-center {
    overflow-x: auto;
}

html.ehtw-other #ehtw-center a {
    color: var(--ehtw-accent);
}

/* Thumbnail (.itg.gld) */

html.ehtw-other .ehtw-other-content .itg.gld {
    display: grid !important;

    grid-template-columns:
        repeat(auto-fill, minmax(180px, 1fr)) !important;

    gap: 12px !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    align-items: stretch !important;
    justify-content: stretch !important;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t {
    display: block !important;

    position: relative !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 10px !important;

    border: 1px solid var(--ehtw-border) !important;
    border-radius: 12px !important;

    background: transparent !important;
    background-image: none !important;

    color: var(--ehtw-text) !important;

    overflow: hidden !important;
    overflow-wrap: anywhere;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t:nth-child(odd),
html.ehtw-other .ehtw-other-content .itg.gld .gl1t:nth-child(even) {
    background: transparent !important;
    background-image: none !important;

    border-color: var(--ehtw-border) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t > div {
    min-width: 0 !important;
    max-width: 100% !important;

    box-sizing: border-box;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t img {
    max-width: 100% !important;
    height: auto;

    object-fit: contain;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t a {
    max-width: 100%;

    color: var(--ehtw-text) !important;
    overflow-wrap: anywhere;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl1t a:hover {
    color: var(--ehtw-accent) !important;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl3t,
html.ehtw-other .ehtw-other-content .itg.gld .gl4t,
html.ehtw-other .ehtw-other-content .itg.gld .gl5t,
html.ehtw-other .ehtw-other-content .itg.gld .gl6t,
html.ehtw-other .ehtw-other-content .itg.gld .glthumb {
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    margin-left: auto !important;
    margin-right: auto !important;

    background-color: transparent !important;
    color: var(--ehtw-text) !important;
}

/* ============================================================
   0.5.0：修复 .gl5t 绝对定位残留
   ============================================================ */

/* 整个 .gl5t 由原站固定 46px 改成自动高度。 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl1t .gl5t {
    display: flex !important;
    flex-direction: column !important;

    align-items: stretch !important;
    justify-content: flex-start !important;

    gap: 4px !important;

    position: static !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;

    margin: 0 !important;
    padding: 0 !important;

    overflow: visible !important;
}

/* 第一层两个分组取消 110px / 80px 宽度限制。 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl1t .gl5t > div {
    display: flex !important;
    flex-direction: row !important;

    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: wrap !important;

    gap: 4px !important;

    position: static !important;
    float: none !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;

    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;

    margin: 0 !important;
    padding: 0 !important;

    background: transparent !important;
    border: none !important;

    overflow: visible !important;
}

/*
 * 核心修复：
 * 原站的 nth-child 规则把孙元素绝对定位。
 * 必须同时重置 position、top、left、right、bottom、
 * width、height，否则元素仍可能跑到 .gl1t 顶部。
 *
 * 后面的 .ir 和 .gldown 规则再恢复各自固定尺寸。
 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl1t .gl5t > div > div {
    position: static !important;
    float: none !important;

    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;

    margin: 0 !important;
    padding: 0 !important;

    transform: none !important;

    background-color: transparent !important;
}

/* 分类胶囊不拉伸，保留原站类别颜色。 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t .cs {
    display: inline-flex !important;

    align-items: center !important;
    justify-content: center !important;

    position: static !important;
    float: none !important;

    top: auto !important;
    left: auto !important;

    flex: 0 0 auto !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    margin: 0 !important;
    padding: 3px 8px !important;

    border-radius: 9999px !important;

    font-size: 11px !important;
    line-height: 1.4 !important;

    white-space: nowrap !important;
    cursor: pointer;
}

/* 星级：严格保留 80 × 16px 与背景精灵图。 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t .ir {
    display: block !important;

    position: static !important;
    float: none !important;

    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;

    flex: 0 0 80px !important;
    flex-shrink: 0 !important;
    flex-grow: 0 !important;

    width: 80px !important;
    min-width: 80px !important;
    max-width: 80px !important;

    height: 16px !important;
    min-height: 16px !important;
    max-height: 16px !important;

    margin: 0 !important;
    padding: 0 !important;

    transform: none !important;
    scale: none !important;

    overflow: visible !important;

    /* 不设置 background-image 和 background-position。 */
}

/* 发布时间 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t [id^="posted_"] {
    position: static !important;

    top: auto !important;
    left: auto !important;

    flex: 0 1 auto !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    color: var(--ehtw-muted) !important;

    font-size: 12px !important;
    line-height: 1.4 !important;

    white-space: normal !important;
    overflow-wrap: anywhere;
}

/* 页数 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t > div:nth-child(2) > div:not(.ir):not(.gldown) {
    position: static !important;

    top: auto !important;
    left: auto !important;

    flex: 0 1 auto !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    height: auto !important;

    color: var(--ehtw-muted) !important;

    font-size: 12px !important;
    line-height: 1.4 !important;

    white-space: normal !important;
}

/* 种子下载图标：15 × 15px。 */

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t .gldown {
    display: inline-flex !important;

    position: static !important;
    float: none !important;

    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;

    flex: 0 0 15px !important;
    flex-shrink: 0 !important;
    flex-grow: 0 !important;

    width: 15px !important;
    min-width: 15px !important;
    max-width: 15px !important;

    height: 15px !important;
    min-height: 15px !important;
    max-height: 15px !important;

    margin: 0 !important;
    padding: 0 !important;

    align-items: center;
    justify-content: center;

    background: transparent !important;

    overflow: visible !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl5t .gldown img {
    display: block !important;

    width: 15px !important;
    max-width: 15px !important;

    height: 15px !important;
    max-height: 15px !important;

    object-fit: contain;
}

/* ============================================================
   Minimal / Minimal+ / Extended 通用表格
   ============================================================ */

html.ehtw-other .ehtw-other-content table.itg:not(.gld) {
    display: table !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    table-layout: fixed !important;
    border-collapse: collapse !important;

    margin: 0 !important;

    background: transparent !important;
    background-image: none !important;

    color: var(--ehtw-text) !important;

    border: 1px solid var(--ehtw-border) !important;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) > tbody {
    display: table-row-group !important;
    width: 100% !important;

    background: transparent !important;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) tr {
    display: table-row !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;

    background: transparent !important;
    background-image: none !important;

    color: var(--ehtw-text) !important;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) tr:nth-child(odd),
html.ehtw-other .ehtw-other-content table.itg:not(.gld) tr:nth-child(even) {
    background: transparent !important;
    background-image: none !important;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) th,
html.ehtw-other .ehtw-other-content table.itg:not(.gld) td {
    min-width: 0 !important;
    max-width: 100% !important;

    padding: 8px 6px !important;

    border-color: var(--ehtw-border) !important;

    background: transparent !important;
    background-image: none !important;

    color: var(--ehtw-text) !important;

    white-space: normal !important;
    overflow-wrap: anywhere !important;
    word-break: break-word;
}

/*
 * 0.5.0：
 * 排除 .cn 与 .cs，避免分类颜色被通用主题覆盖。
 */

html.ehtw-other .ehtw-other-content table.itg:not(.gld) td div:not(.cn):not(.cs),
html.ehtw-other .ehtw-other-content table.itg:not(.gld) th div:not(.cn):not(.cs) {
    min-width: 0 !important;
    max-width: 100% !important;

    background-color: transparent !important;
    color: var(--ehtw-text) !important;

    overflow-wrap: anywhere;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) a {
    color: var(--ehtw-text) !important;
    overflow-wrap: anywhere;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) a:hover {
    color: var(--ehtw-accent) !important;
}

html.ehtw-other .ehtw-other-content table.itg:not(.gld) img {
    max-width: 100% !important;
    height: auto;
}

html.ehtw-other .ehtw-other-content .ir {
    background-color: transparent;
}

html.ehtw-other .ehtw-other-content .cn,
html.ehtw-other .ehtw-other-content .cs {
    cursor: pointer;
}

/*
 * 0.5.0：分类标签保持原站浅色文字。
 * 不覆盖分类背景，只修复被表格规则改变的文字。
 */

html.ehtw-other #ehtw-center .ehtw-other-content .cn,
html.ehtw-other #ehtw-center .ehtw-other-content .cs,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg .cn,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg .cs {
    color: #f1f1f1 !important;
}

/* ============================================================
   Minimal / Minimal+ 自适应列宽
   ============================================================ */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm {
    display: table !important;

    table-layout: auto !important;

    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;

    border-collapse: collapse !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm > tbody {
    display: table-row-group !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm tr {
    display: table-row !important;

    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm td,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm th {
    min-width: 0 !important;

    box-sizing: border-box;

    overflow: hidden !important;
    text-overflow: ellipsis;
}

/* 分类列 */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl1m {
    width: 1% !important;
    max-width: none !important;

    white-space: nowrap !important;
}

/* 时间列 */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl2m {
    width: 1% !important;
    max-width: none !important;

    white-space: nowrap !important;
}

/* 标题列 */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl3m {
    width: 100% !important;
    max-width: 0 !important;
    min-width: 0 !important;

    white-space: nowrap !important;

    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl3m a,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl3m .glink,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl3m > div {
    display: block;

    min-width: 0 !important;
    max-width: 100% !important;

    white-space: nowrap !important;

    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

/* 评分列 */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl4m {
    width: 1% !important;
    max-width: none !important;

    white-space: nowrap !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl4m .ir {
    width: 80px !important;
    min-width: 80px !important;
    max-width: 80px !important;

    height: 16px !important;
    min-height: 16px !important;

    flex-shrink: 0 !important;
    transform: none !important;
}

/* 上传者列 */

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl5m {
    width: 1% !important;
    min-width: 0 !important;
    max-width: 100px !important;

    white-space: nowrap !important;

    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl5m a,
html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl5m div {
    display: block;

    min-width: 0 !important;
    max-width: 100px !important;

    white-space: nowrap !important;

    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

/* ============================================================
   通用样式
   ============================================================ */

.ehtw-section-title {
    margin: 0 0 12px;

    font-size: 19px;
    font-weight: 800;
    line-height: 1.35;

    color: var(--ehtw-text);

    text-align: left !important;
}

.ehtw-gallery-grid-section > .ehtw-section-title,
.ehtw-detail-tags > .ehtw-section-title,
.ehtw-comments-section > .ehtw-section-title {
    width: 100%;
    text-align: left !important;
}

.ehtw-empty {
    padding: 16px;

    font-size: 13px;
    color: var(--ehtw-muted);
}

.ehtw-muted {
    color: var(--ehtw-muted);
}

.ehtw-native-hidden {
    display: none !important;
}

/* ============================================================
   小于 1000px：两栏
   ============================================================ */

@media (max-width: 999px) {
    #ehtw-shell {
        width: min(100%, 875px);
        max-width: 100%;

        grid-template-columns: 275px minmax(0, 600px);
    }

    #ehtw-right {
        display: none !important;
    }

    #ehtw-center {
        border-right: 1px solid var(--ehtw-border);
    }

    #ehtw-left {
        width: 275px;
    }

    #ehtw-mobile-search {
        display: block !important;
    }

    #ehtw-mobile-operations {
        display: block !important;
    }
}

@media (min-width: 1000px) {
    #ehtw-mobile-search,
    #ehtw-mobile-operations {
        display: none !important;
    }
}

@media (min-width: 700px) {
    html.ehtw-exhentai #ehtw-left #nb > .ehtw-more-entry {
        display: none !important;
    }
}

/* ============================================================
   小于 700px：单栏 + 底部 Tab 导航
   ============================================================ */

@media (max-width: 699px) {
    html.ehtw-enabled .ehtw-search-toplists {
        display: none !important;
    }

    html.ehtw-enabled body {
        padding-bottom: 72px !important;
    }

    #ehtw-shell {
        display: block;

        width: 100%;
        max-width: 100%;
        min-width: 0;

        min-height: 100vh;
    }

    #ehtw-left {
        position: fixed !important;

        top: auto !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;

        z-index: 1000;

        width: 100% !important;
        max-width: 100vw !important;
        min-width: 0 !important;

        height: 64px !important;
        min-height: 64px !important;
        max-height: 64px !important;

        padding:
            4px
            6px
            max(4px, env(safe-area-inset-bottom)) !important;

        border-top: 1px solid var(--ehtw-border);

        background: var(--ehtw-glass);

        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);

        overflow-x: auto !important;
        overflow-y: hidden !important;

        overscroll-behavior-x: contain;
        overscroll-behavior-y: auto;

        -webkit-overflow-scrolling: touch;

        scrollbar-width: none;
        box-sizing: border-box;
    }

    #ehtw-left::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
    }

    #ehtw-brand,
    .ehtw-nav-hint {
        display: none;
    }

    #ehtw-left #nb {
        display: flex !important;

        flex-direction: row !important;
        flex-wrap: nowrap !important;

        justify-content: flex-start;
        align-items: center;

        gap: 2px;

        width: max-content !important;
        min-width: 100% !important;
        max-width: none !important;

        height: 100% !important;
        min-height: 0 !important;
        max-height: none !important;

        overflow: visible !important;
        white-space: nowrap !important;
    }

    #ehtw-left #nb > div {
        display: block !important;

        width: auto !important;
        min-width: max-content !important;
        max-width: none !important;

        flex: 0 0 auto !important;

        height: auto !important;

        white-space: nowrap !important;
    }

    #ehtw-left #nb a {
        display: flex !important;

        align-items: center;
        justify-content: center;

        width: auto !important;
        min-width: max-content !important;
        max-width: none !important;

        min-height: 45px;
        height: 45px;

        padding: 8px 10px !important;

        font-size: 12px !important;
        font-weight: 600;

        white-space: nowrap !important;

        text-align: center;
        flex-shrink: 0;
    }

    #ehtw-center {
        width: 100%;
        max-width: 100%;
        min-width: 0;

        min-height: 100vh;

        border-left: none;
        border-right: none;
    }

    #ehtw-header {
        min-height: 54px;
        padding: 8px 14px;
    }

    #ehtw-header-title {
        font-size: 20px !important;
    }

    .ehtw-tweet {
        gap: 10px;
        padding: 12px 12px 14px;
    }

    .ehtw-avatar {
        width: 42px;
        height: 42px;

        flex-basis: 42px;
        font-size: 19px;
    }

    .ehtw-tweet-title {
        font-size: 14px;
    }

    .ehtw-media img {
        max-height: 430px !important;
    }

    .ehtw-actions {
        gap: 5px;
        font-size: 12px;
    }

    .ehtw-action {
        gap: 3px;
    }

    .ehtw-action-icon {
        width: 23px;
        height: 23px;
    }

    .ehtw-pagination {
        padding: 9px 5px;
    }

    .ehtw-pagination .searchnav {
        gap: 4px;
    }

    .ehtw-pagination .searchnav a,
    .ehtw-pagination .searchnav span[id],
    .ehtw-pagination .searchnav select {
        padding: 5px 7px;

        font-size: 11px;
        min-height: 30px;
    }

    .ehtw-detail-post {
        padding: 12px;
    }

    .ehtw-detail-post #gn {
        font-size: 18px !important;
    }

    .ehtw-detail-cover #gd1 > div {
        height: 420px !important;
        min-height: 260px;
    }

    .ehtw-detail-tags #taglist td.tc {
        width: 85px;
        font-size: 11px;
    }

    .ehtw-detail-tags #taglist td {
        padding: 4px !important;
    }

    .ehtw-comments-section #cdiv .c1 {
        padding-left: 62px !important;
    }

    .ehtw-comments-section #cdiv .c1::before {
        left: 12px;
        width: 38px;
        height: 38px;
    }

    .ehtw-comments-section #cdiv .c1 .c2 {
        gap: 3px 8px;
    }

    .ehtw-comments-section #cdiv .c1 .c3,
    .ehtw-comments-section #cdiv .c1 .c4 {
        max-width: 100% !important;
        white-space: normal !important;
    }

    #ehtw-mobile-search {
        padding: 12px;

        border-bottom: 1px solid var(--ehtw-border);
    }

    #ehtw-mobile-search #searchbox {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;

        height: auto !important;

        position: static !important;

        margin: 0 !important;
        padding: 0 !important;

        background: transparent !important;
        border: none !important;
    }

    #ehtw-mobile-search form {
        display: flex;
        flex-wrap: wrap;

        gap: 6px;

        width: 100%;
        min-width: 0;
        max-width: 100%;

        padding: 0;

        border-radius: 0;
        background: transparent !important;
    }

    #ehtw-mobile-operations {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        padding: 0;
    }

    html.ehtw-other .ehtw-other-content .itg.gld {
        grid-template-columns:
            repeat(auto-fill, minmax(min(180px, 100%), 1fr)) !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-pagination {
        padding: 10px 8px;
    }

    /* 上下分页均保留 32px 胶囊高度。 */

    html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td,
    html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td {
        min-width: 30px !important;
        height: 32px !important;
        min-height: 32px !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr td a,
    html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptb tr td a {
        min-width: 30px !important;
        height: 32px !important;

        padding: 0 8px !important;
    }
}

/* ============================================================
   移动端 Minimal / Minimal+ 隐藏时间和上传者列
   ============================================================ */

@media (max-width: 699px) {
    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl2m,
    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl5m {
        display: none !important;

        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;

        padding: 0 !important;
        border: none !important;
    }

    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm tr > th:nth-child(2),
    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm tr > th:nth-child(5) {
        display: none !important;
    }

    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.gltm .gl3m {
        width: 100% !important;
        max-width: 0 !important;
    }
}

/* ============================================================
   固定宽度兼容
   ============================================================ */

html.ehtw-enabled #ehtw-shell,
html.ehtw-enabled #ehtw-shell > *,
html.ehtw-enabled .ehtw-timeline,
html.ehtw-enabled .ehtw-tweet-content,
html.ehtw-enabled .ehtw-detail-post {
    min-width: 0;
}

html.ehtw-enabled #ehtw-center .ido,
html.ehtw-enabled #ehtw-right .ido,
html.ehtw-enabled #ehtw-mobile-search .ido {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-enabled #ehtw-search-card .idi,
html.ehtw-enabled #ehtw-mobile-search .idi {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-enabled #ehtw-center img,
html.ehtw-enabled #ehtw-right img {
    max-width: 100%;
}

html.ehtw-enabled #ehtw-center pre {
    max-width: 100%;
    overflow-x: auto;
}

html.ehtw-enabled #ehtw-center textarea,
html.ehtw-enabled #ehtw-center input,
html.ehtw-enabled #ehtw-center select {
    max-width: 100%;
}

html.ehtw-enabled #ehtw-center select {
    -webkit-appearance: none !important;
    appearance: none !important;
    border-radius: 12px !important;
}

@media (max-width: 699px) {
    html.ehtw-enabled #ehtw-shell,
    html.ehtw-enabled #ehtw-center,
    html.ehtw-enabled .ehtw-timeline {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
    }

    html.ehtw-enabled #ehtw-center .gm,
    html.ehtw-enabled #ehtw-center .ido,
    html.ehtw-enabled #ehtw-center #cdiv {
        min-width: 0 !important;
        max-width: 100% !important;
    }
}

/* ============================================================
   移动端页脚
   ============================================================ */

#ehtw-mobile-footer {
    display: none;
}

@media (max-width: 699px) {
    #ehtw-mobile-footer {
        display: block;

        width: 100%;
        min-width: 0;
        max-width: 100%;

        margin-top: 12px;
        padding: 12px 16px 22px;

        border-top: 1px solid var(--ehtw-border);

        color: var(--ehtw-muted);

        font-size: 11px;
        text-align: left !important;
    }

    #ehtw-mobile-footer .ehtw-footer {
        width: 100%;
        min-width: 0;
        max-width: 100%;

        padding: 0;
        margin: 0;

        border: none;
    }

    #ehtw-mobile-footer .dp {
        display: block !important;

        position: static !important;
        float: none !important;

        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;

        height: auto !important;

        margin: 0 !important;
        padding: 0 !important;

        background: transparent !important;
        border: none !important;

        color: var(--ehtw-muted) !important;

        font-size: 11px !important;
        line-height: 1.6 !important;

        text-align: left !important;

        white-space: normal !important;
        overflow-wrap: anywhere;
    }

    #ehtw-mobile-footer .dp a {
        display: inline !important;

        color: var(--ehtw-muted) !important;
        background: transparent !important;

        font-size: 11px !important;
        text-decoration: none !important;
    }

    #ehtw-mobile-footer .dp a:hover {
        color: var(--ehtw-accent) !important;
        text-decoration: underline !important;
    }
}

/* 系统减少动画偏好 */

@media (prefers-reduced-motion: reduce) {
    #ehtw-shell *,
    #ehtw-shell *::before,
    #ehtw-shell *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
    }
}
/* 1. Thumbnail：恢复评分精灵图的固定尺寸。 */
html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld .gl1t .gl5t > div > div.ir {
    position: static !important;
    width: 80px !important;
    min-width: 80px !important;
    max-width: 80px !important;
    height: 16px !important;
    min-height: 16px !important;
    max-height: 16px !important;
    flex: 0 0 80px !important;
    flex-shrink: 0 !important;
    padding: 0 !important;
    transform: none !important;
    overflow: visible !important;
}

/* 2. Extended：恢复两列响应式布局。 */
html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    table-layout: auto !important;
    border-collapse: separate !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte > tbody {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte tr {
    display: grid !important;
    grid-template-columns: 150px minmax(0, 1fr) !important;
    gap: 12px !important;
    align-items: start !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 12px 0 !important;
    border: 0 !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl1e {
    display: block !important;
    width: 150px !important;
    min-width: 0 !important;
    max-width: 150px !important;
    height: auto !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl1e > div {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl1e img {
    display: block;
    max-width: 100% !important;
    height: auto !important;
    object-fit: contain;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl2e {
    display: block !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl2e > div {
    display: block !important;
    position: static !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    background: transparent !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e {
    display: flex !important;
    position: static !important;
    float: none !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 6px !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 0 8px !important;
    padding: 0 !important;
    background: transparent !important;
    overflow: visible !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e > div {
    position: static !important;
    float: none !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    transform: none !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e > .cn {
    display: inline-flex !important;
    align-items: center !important;
    flex: 0 0 auto !important;
    width: auto !important;
    padding: 3px 8px !important;
    border-radius: 9999px !important;
    color: #f1f1f1 !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e > .ir {
    display: block !important;
    flex: 0 0 80px !important;
    width: 80px !important;
    min-width: 80px !important;
    max-width: 80px !important;
    height: 16px !important;
    min-height: 16px !important;
    max-height: 16px !important;
    overflow: visible !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e > .gldown {
    display: inline-flex !important;
    flex: 0 0 15px !important;
    align-items: center !important;
    justify-content: center !important;
    width: 15px !important;
    min-width: 15px !important;
    max-width: 15px !important;
    height: 15px !important;
    min-height: 15px !important;
    max-height: 15px !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl3e > .gldown img {
    width: 15px !important;
    max-width: 15px !important;
    height: 15px !important;
    max-height: 15px !important;
}

html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte .gl4e {
    display: block !important;
    position: static !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow-wrap: anywhere;
    background: transparent !important;
}

@media (max-width: 699px) {
    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte tr {
        grid-template-columns: 100px minmax(0, 1fr) !important;
    }

    html.ehtw-other #ehtw-center .ehtw-other-content table.itg.glte td.gl1e {
        width: 100px !important;
        max-width: 100px !important;
    }
}
/* ============================================================
   Twitter/X 视觉规格覆盖层 0.7.0
   不覆盖非推文列表四种显示模式的原有布局。
   ============================================================ */

html.ehtw-enabled,
html.ehtw-enabled body {
    font-family:
        TwitterChirp,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        Helvetica,
        Arial,
        sans-serif !important;
}

html.ehtw-enabled {
    --ehtw-card: var(--ehtw-bg);
}

html.ehtw-enabled .ehtw-side-card {
    background: transparent !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    box-shadow: none !important;
}

.ehtw-svg-icon {
    display: block;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    fill: currentColor;
    color: inherit;
}

/* ============================================================
   左栏
   ============================================================ */

#ehtw-brand {
    display: none !important;
}

#ehtw-left .ehtw-brand-link {
    width: auto;
    min-width: 52px;
    max-width: 100%;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    margin: 0 0 8px 8px;
    padding: 0 14px;
    color: var(--ehtw-text) !important;
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    text-decoration: none;
}

#ehtw-left .ehtw-brand-link:hover {
    background: var(--ehtw-nav-hover);
}

#ehtw-left .ehtw-nav-hint {
    display: none !important;
}

#ehtw-left #nb .ehtw-nav-entry {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
}

#ehtw-left #nb .ehtw-nav-link,
#ehtw-left #nb .ehtw-more-button {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 20px !important;
    min-height: 50px !important;
    padding: 12px !important;
    border-radius: 9999px !important;
    color: var(--ehtw-text) !important;
    font-size: 20px !important;
    font-weight: 400 !important;
    white-space: nowrap !important;
    text-decoration: none !important;
    background: transparent !important;
    border: none !important;
    cursor: pointer;
}

#ehtw-left #nb .ehtw-nav-link .ehtw-svg-icon,
#ehtw-left #nb .ehtw-more-button .ehtw-svg-icon {
    width: 26px !important;
    height: 26px !important;
}

#ehtw-left #nb .ehtw-nav-current .ehtw-nav-link {
    font-weight: 700 !important;
}

#ehtw-left #nb .ehtw-nav-link:hover,
#ehtw-left #nb .ehtw-more-button:hover {
    background: var(--ehtw-nav-hover) !important;
}

#ehtw-left #nb .ehtw-nav-extra {
    display: none !important;
}

.ehtw-mobile-account-entry {
    display: none !important;
}

html.ehtw-enabled #ehtw-left #nb > .ehtw-mobile-account-entry {
    display: none !important;
}

#ehtw-left #nb.ehtw-nav-open .ehtw-nav-extra {
    display: block !important;
}

#ehtw-left #nb .ehtw-more-entry {
    display: block;
    width: 100%;
}

#ehtw-left #nb .ehtw-more-button {
    font-family: inherit;
}

#ehtw-left .ehtw-post-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 90%;
    height: 52px;
    margin: 18px auto 0;
    padding: 0 16px;
    border-radius: 9999px;
    background: var(--ehtw-text) !important;
    color: var(--ehtw-bg) !important;
    font-size: 17px;
    font-weight: 700;
    text-decoration: none;
}

#ehtw-left .ehtw-post-button:hover {
    opacity: 0.88;
    color: var(--ehtw-bg) !important;
}

/* ============================================================
   顶部 Tab
   ============================================================ */

#ehtw-header.ehtw-tabs-header {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    height: 53px;
    min-height: 53px;
    padding: 0 !important;
}

#ehtw-header .ehtw-top-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    height: 53px;
    min-width: 0;
    color: var(--ehtw-muted) !important;
    text-decoration: none !important;
    font-size: 15px;
    font-weight: 500;
}

@media (hover: hover) and (pointer: fine) {
    #ehtw-header .ehtw-top-tab:hover {
        background: var(--ehtw-nav-hover);
    }
}

#ehtw-header .ehtw-top-tab.ehtw-tab-active {
    color: var(--ehtw-text) !important;
    font-weight: 700;
}

#ehtw-header .ehtw-top-tab.ehtw-tab-active .ehtw-top-tab-label::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 4px;
    border-radius: 9999px;
    background: var(--ehtw-accent);
}

#ehtw-header .ehtw-top-tab-label {
    position: relative;
    display: flex;
    align-items: center;
    height: 100%;
    white-space: nowrap;
}

@media (hover: none), (pointer: coarse) {
    html.ehtw-enabled #ehtw-header .ehtw-top-tab:is(:hover, :focus, :active):not(.ehtw-tab-active),
    html.ehtw-enabled.ehtw-touch-ui #ehtw-header .ehtw-top-tab:is(:hover, :focus, :active):not(.ehtw-tab-active) {
        background: transparent !important;
        color: var(--ehtw-muted) !important;
    }
}

html.ehtw-enabled.ehtw-touch-ui #ehtw-header .ehtw-top-tab:is(:hover, :focus, :active):not(.ehtw-tab-active) {
    background: transparent !important;
    color: var(--ehtw-muted) !important;
}

/* 触屏下激活的 tab 也不要残留 hover/focus 背景（返回后手指位置恰好落在 For you 上） */
html.ehtw-enabled.ehtw-touch-ui #ehtw-header .ehtw-top-tab.ehtw-tab-active:is(:hover, :focus, :active) {
    background: transparent !important;
}

#ehtw-header .ehtw-back-link {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--ehtw-text) !important;
    margin-right: 24px;
}

#ehtw-header .ehtw-back-link:hover {
    background: var(--ehtw-nav-hover);
}

#ehtw-header .ehtw-back-link svg {
    width: 20px;
    height: 20px;
}

#ehtw-header .ehtw-detail-header-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: var(--ehtw-text);
}

/* 上分页改为低调工具栏。 */

.ehtw-pagination.ehtw-top-toolbar {
    min-height: 40px;
    padding: 4px 12px;
    border-top: none;
    border-bottom: 1px solid var(--ehtw-border);
}

.ehtw-pagination.ehtw-top-toolbar .searchnav {
    min-height: 32px;
    justify-content: flex-start;
    color: var(--ehtw-muted) !important;
    font-size: 13px;
}

.ehtw-pagination.ehtw-top-toolbar .searchnav a,
.ehtw-pagination.ehtw-top-toolbar .searchnav select,
.ehtw-pagination.ehtw-top-toolbar .searchnav span[id] {
    min-height: 28px;
    padding: 2px 6px;
    background: transparent !important;
    border: none !important;
    border-radius: 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px;
}

/* ============================================================
   搜索与 Filters
   ============================================================ */

#ehtw-search-card {
    position: sticky;
    top: 0;
    z-index: 110;
    padding-top: 2px;
    background: var(--ehtw-bg);
}

.ehtw-search-input-wrap {
    display: block;
    position: relative;
    width: 100%;
    min-width: 0;
    flex: 1 1 100%;
}

.ehtw-search-input-wrap .ehtw-search-icon {
    position: absolute;
    top: 50%;
    left: 16px;
    z-index: 1;
    width: 20px;
    height: 20px;
    color: var(--ehtw-muted);
    transform: translateY(-50%);
    pointer-events: none;
}

#ehtw-search-card #f_search,
#ehtw-mobile-search #f_search {
    height: 42px !important;
    min-height: 42px !important;
    margin: 0 !important;
    padding-left: 44px !important;
}

#ehtw-search-card #searchbox.ehtw-filters-collapsed form > :not(.ehtw-search-input-wrap),
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed form > :not(.ehtw-search-input-wrap) {
    display: none !important;
}

#ehtw-search-card #searchbox.ehtw-filters-collapsed .ehtw-search-input-wrap,
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed .ehtw-search-input-wrap {
    display: block !important;
}

#ehtw-search-card #searchbox.ehtw-filters-collapsed.ehtw-filters-open form > *,
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed.ehtw-filters-open form > * {
    display: revert !important;
}

#ehtw-search-card #searchbox.ehtw-filters-open .ehtw-search-input-wrap,
#ehtw-mobile-search #searchbox.ehtw-filters-open .ehtw-search-input-wrap {
    display: block !important;
}

.ehtw-filters-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    margin-top: 6px;
    padding: 0 4px;
    border: none;
    background: transparent;
    color: var(--ehtw-accent);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
}

.ehtw-filters-toggle svg {
    width: 16px;
    height: 16px;
}

#ehtw-search-card table.itc .cs,
#ehtw-search-card table.itc .cn,
#ehtw-mobile-search table.itc .cs,
#ehtw-mobile-search table.itc .cn {
    height: 28px !important;
    min-height: 28px !important;
    padding: 4px 8px !important;
    font-size: 13px !important;
    border-radius: 8px !important;
}

/* ============================================================
   Trending
   ============================================================ */

.ehtw-trending-card .ehtw-side-title {
    font-size: 20px;
    font-weight: 800;
    padding-top: 4px;
}

.ehtw-trending-card .ehtw-trend {
    padding: 12px 16px;
}

.ehtw-trending-card .ehtw-trend-category,
.ehtw-trending-card .ehtw-trend-count {
    font-size: 13px;
    color: var(--ehtw-muted);
}

.ehtw-trending-card .ehtw-trend-name {
    font-size: 15px;
    font-weight: 700;
    margin: 2px 0;
}

.ehtw-trending-card .ehtw-trend-extra {
    display: none;
}

.ehtw-trending-card.ehtw-trending-expanded .ehtw-trend-extra {
    display: block;
}

.ehtw-trending-more {
    display: block;
    width: 100%;
    min-height: 48px;
    padding: 12px 16px;
    text-align: left;
    border: none;
    border-top: 1px solid var(--ehtw-border);
    background: transparent;
    color: var(--ehtw-accent);
    font-size: 15px;
    cursor: pointer;
}

.ehtw-trending-more:hover {
    background: var(--ehtw-nav-hover);
}

/* 页脚转移到右栏。 */

#ehtw-right .ehtw-footer,
#ehtw-mobile-footer .ehtw-footer {
    margin: 12px 0 24px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--ehtw-muted);
    font-size: 13px;
    line-height: 1.6;
}

#ehtw-right .ehtw-footer .dp,
#ehtw-mobile-footer .ehtw-footer .dp {
    position: static !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    white-space: normal !important;
}

#ehtw-right .ehtw-footer .dp a,
#ehtw-mobile-footer .ehtw-footer .dp a {
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

/* ============================================================
   Twitter 推文
   ============================================================ */

html.ehtw-list .ehtw-tweet {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr) !important;
    gap: 12px !important;
    padding: 12px 16px !important;
    border: none !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    border-radius: 0 !important;
    background: transparent !important;
}

html.ehtw-list .ehtw-tweet:hover {
    background: var(--ehtw-hover) !important;
}

html.ehtw-list .ehtw-avatar,
html.ehtw-detail .ehtw-avatar {
    width: 40px !important;
    height: 40px !important;
    min-width: 40px !important;
    min-height: 40px !important;
    max-width: 40px !important;
    max-height: 40px !important;
    flex: 0 0 40px !important;
    border-radius: 50% !important;
    background-color: var(--ehtw-avatar-solid, #536471) !important;
    background-image: none !important;
    border: none !important;
    font-size: 15px !important;
    font-weight: 700 !important;
}

html.ehtw-list .ehtw-tweet-author {
    display: flex !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
    gap: 4px !important;
    height: 20px;
    min-height: 20px;
    margin: 0 0 2px !important;
    line-height: 20px;
    overflow: hidden;
}

html.ehtw-list .ehtw-author-name {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 15px;
    font-weight: 700;
}

html.ehtw-list .ehtw-handle {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 15px;
}

html.ehtw-list .ehtw-dot,
html.ehtw-list .ehtw-time {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 15px;
    color: var(--ehtw-muted) !important;
}

html.ehtw-list .ehtw-tweet-author .cn {
    display: inline !important;
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-tweet-more {
    flex: 0 0 18px;
    width: 18px;
    height: 18px;
    margin-left: auto;
    color: var(--ehtw-muted);
}

.ehtw-tweet-more svg {
    width: 18px;
    height: 18px;
}

html.ehtw-list .ehtw-tweet-title {
    margin: 0 !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-tweet-title .glink {
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-tags {
    display: block !important;
    width: 100%;
    margin: 0 !important;
    padding: 0 !important;
    line-height: 20px;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag {
    display: inline !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag::before {
    content: none !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag a {
    font-size: 15px !important;
    font-weight: 400 !important;
}

html.ehtw-list .ehtw-media {
    width: 100%;
    max-width: 100%;
    margin-top: 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    overflow: hidden;
}

html.ehtw-list .ehtw-media img {
    max-height: 510px !important;
}

/* ============================================================
   Twitter 操作栏
   ============================================================ */

.ehtw-twitter-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: 425px;
    margin-top: 12px;
    gap: 4px;
}

.ehtw-twitter-action {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    height: 34px;
    padding: 0;
    color: var(--ehtw-muted) !important;
    text-decoration: none !important;
    font-size: 13px;
    cursor: pointer;
}

.ehtw-twitter-action-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 50%;
    color: inherit;
    transition: background 0.15s ease;
}

.ehtw-twitter-action-icon .ehtw-svg-icon {
    width: 18.75px;
    height: 18.75px;
}

.ehtw-twitter-action .ehtw-action-number {
    color: var(--ehtw-muted);
    font-size: 13px;
    white-space: nowrap;
}

.ehtw-twitter-action:hover,
.ehtw-twitter-action-reply:hover,
.ehtw-twitter-action-views:hover,
.ehtw-twitter-action-share:hover {
    color: var(--ehtw-accent) !important;
}

.ehtw-twitter-action-reply:hover .ehtw-twitter-action-icon,
.ehtw-twitter-action-views:hover .ehtw-twitter-action-icon,
.ehtw-twitter-action-share:hover .ehtw-twitter-action-icon {
    background: rgba(29, 155, 240, 0.1);
}

.ehtw-twitter-action-repost:hover {
    color: #00ba7c !important;
}

.ehtw-twitter-action-repost:hover .ehtw-twitter-action-icon {
    background: rgba(0, 186, 124, 0.1);
}

.ehtw-twitter-action-heart:hover {
    color: #f91880 !important;
}

.ehtw-twitter-action-heart:hover .ehtw-twitter-action-icon {
    background: rgba(249, 24, 128, 0.1);
}

.ehtw-twitter-action-heart .ir,
.ehtw-twitter-action-views > div:not(.ehtw-twitter-action-icon) {
    display: none !important;
}

.ehtw-twitter-action-repost .ehtw-repost-native {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    cursor: pointer;
}

.ehtw-twitter-action-repost .ehtw-repost-native img {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    opacity: 0 !important;
    cursor: pointer;
}

/* ============================================================
   详情页
   ============================================================ */

html.ehtw-detail .ehtw-detail-post {
    padding: 12px 16px 16px;
}

html.ehtw-detail .ehtw-detail-author {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    margin-bottom: 14px;
}

html.ehtw-detail .ehtw-detail-author-meta {
    gap: 0;
    min-width: 0;
}

html.ehtw-detail .ehtw-detail-author-meta .ehtw-author-name {
    font-size: 15px;
    font-weight: 700;
    line-height: 20px;
}

html.ehtw-detail .ehtw-detail-author-meta .ehtw-handle {
    font-size: 15px;
    line-height: 20px;
}

.ehtw-detail-more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    margin-left: auto;
    color: var(--ehtw-muted);
    border-radius: 50%;
}

.ehtw-detail-more svg {
    width: 20px;
    height: 20px;
}

.ehtw-detail-post #gn {
    margin: 0 0 4px !important;
    font-size: 17px !important;
    font-weight: 400 !important;
    line-height: 24px !important;
}

.ehtw-detail-post #gj {
    margin: 0 0 10px !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    color: var(--ehtw-muted) !important;
    line-height: 20px !important;
}

/* 标签使用 inline hashtag，不再显示命名空间列。 */

html.ehtw-detail .ehtw-detail-tags {
    display: block !important;
    margin: 8px 0 12px !important;
    padding: 0 !important;
    line-height: 20px !important;
}

html.ehtw-detail .ehtw-detail-tags #gd4,
html.ehtw-detail .ehtw-detail-tags #taglist,
html.ehtw-detail .ehtw-detail-tags #taglist table,
html.ehtw-detail .ehtw-detail-tags #taglist tbody,
html.ehtw-detail .ehtw-detail-tags #taglist tr,
html.ehtw-detail .ehtw-detail-tags #taglist td {
    display: inline !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    vertical-align: baseline !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .tc {
    display: none !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt {
    display: inline !important;
    width: auto !important;
    height: auto !important;
    margin: 0 7px 0 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt::before {
    content: none !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt a {
    display: inline !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-detail .ehtw-detail-cover {
    margin: 12px 0 16px;
    width: 100%;
    border-radius: 16px;
    border: 1px solid var(--ehtw-border);
}

html.ehtw-detail .ehtw-detail-timestamp {
    padding: 12px 0;
    color: var(--ehtw-muted);
    font-size: 15px;
    line-height: 20px;
    border-bottom: 1px solid var(--ehtw-border);
}

html.ehtw-detail .ehtw-detail-stats {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 12px 0;
    border-bottom: 1px solid var(--ehtw-border);
}

html.ehtw-detail .ehtw-detail-stat {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-size: 15px;
}

html.ehtw-detail .ehtw-detail-stat strong {
    color: var(--ehtw-text);
    font-weight: 700;
}

html.ehtw-detail .ehtw-detail-stat span {
    color: var(--ehtw-muted);
}

html.ehtw-detail .ehtw-detail-native-meta {
    display: none !important;
}

html.ehtw-detail .ehtw-detail-meta {
    padding: 0 !important;
    margin-top: 10px;
    border-top: none !important;
    border-bottom: none !important;
}

html.ehtw-detail .ehtw-detail-actions {
    display: flex;
    justify-content: space-around;
    align-items: center;
    min-height: 50px;
    padding: 8px 0;
    border-top: 1px solid var(--ehtw-border);
    border-bottom: 1px solid var(--ehtw-border);
}

html.ehtw-detail .ehtw-detail-rating-action,
html.ehtw-detail .ehtw-detail-favorite-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    color: var(--ehtw-muted);
}

html.ehtw-detail .ehtw-detail-rating-action > svg,
html.ehtw-detail .ehtw-detail-favorite-action > svg {
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
}

html.ehtw-detail .ehtw-detail-rating-action #gdr,
html.ehtw-detail .ehtw-detail-favorite-action #gdf {
    display: block !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    background: transparent !important;
    cursor: pointer;
}

html.ehtw-detail .ehtw-about-card #gdd {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 0 12px 12px !important;
    background: transparent !important;
    font-size: 13px;
}

html.ehtw-detail .ehtw-operation-card #gd5 {
    padding: 0 16px 14px !important;
    font-size: 15px !important;
    line-height: 1.7 !important;
}

html.ehtw-detail .ehtw-gallery-grid-section #gdt {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px !important;
    width: 100% !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-gallery-grid-section #gdt a {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden;
    border-radius: 4px;
}

html.ehtw-detail .ehtw-gallery-grid-section #gdt img {
    display: block;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    border-radius: 4px;
}

/* ============================================================
   回复
   ============================================================ */

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr);
    column-gap: 12px;
    padding: 12px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: transparent !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet::before {
    content: none !important;
}

.ehtw-comment-avatar {
    display: flex;
    grid-column: 1;
    grid-row: 1 / span 3;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #536471;
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
}

.ehtw-comment-heading {
    grid-column: 2;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
    height: 20px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 15px;
}

.ehtw-comment-author {
    display: inline-block;
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 700;
}

.ehtw-comment-author a {
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
}

.ehtw-comment-handle {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ehtw-muted);
    font-size: 15px;
}

.ehtw-comment-time {
    flex: 0 0 auto;
    color: var(--ehtw-muted);
    font-size: 15px;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 {
    grid-column: 2;
    grid-row: 2;
    display: flex !important;
    align-items: center;
    justify-content: flex-end;
    margin: 0 !important;
    min-height: 0;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c3 {
    display: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c4 {
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c6 {
    grid-column: 2;
    grid-row: 3;
    font-size: 15px;
    line-height: 20px;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c7 {
    grid-column: 2;
    grid-row: 4;
}

/* ============================================================
   手机底栏
   ============================================================ */

@media (max-width: 699px) {
    #ehtw-left {
        overflow-x: hidden !important;
        overflow-y: hidden !important;
    }

    #ehtw-left #nb {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        align-items: center;
        justify-content: space-around;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: 100% !important;
    }

    #ehtw-left #nb .ehtw-nav-entry {
        width: auto !important;
        min-width: 0 !important;
        flex: 1 1 0;
    }

    #ehtw-left #nb .ehtw-nav-link {
        display: flex !important;
        align-items: center;
        justify-content: center !important;
        width: 100% !important;
        min-height: 48px !important;
        padding: 8px 4px !important;
        gap: 0 !important;
    }

    #ehtw-left #nb .ehtw-nav-label {
        display: none !important;
    }

    #ehtw-left #nb .ehtw-nav-link .ehtw-svg-icon {
        width: 26px !important;
        height: 26px !important;
    }

    #ehtw-left #nb .ehtw-nav-mobile-extra,
    #ehtw-left #nb .ehtw-nav-extra {
        display: none !important;
    }

    #ehtw-left #nb .ehtw-more-entry {
        display: flex !important;
        flex: 1 1 0;
        align-items: center;
        justify-content: center;
        width: auto !important;
    }

    #ehtw-left #nb .ehtw-more-button {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 48px !important;
        padding: 8px 4px !important;
    }

    #ehtw-left #nb .ehtw-more-button .ehtw-svg-icon {
        width: 26px !important;
        height: 26px !important;
    }

    #ehtw-left .ehtw-brand-link,
    #ehtw-left .ehtw-post-button {
        display: none !important;
    }

    #ehtw-left:has(#nb.ehtw-nav-open) {
        height: auto !important;
        min-height: 64px !important;
        max-height: min(75vh, 560px) !important;
        overflow-y: auto !important;
    }

    #ehtw-left #nb.ehtw-nav-open {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        align-content: flex-start !important;
        min-height: 0 !important;
        height: auto !important;
        padding-top: 8px !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra,
    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-extra {
        display: block !important;
        flex: 0 0 100%;
        width: 100% !important;
        order: -1;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra .ehtw-nav-link {
        justify-content: flex-start !important;
        gap: 16px !important;
        padding: 8px 16px !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra .ehtw-nav-label {
        display: inline !important;
        font-size: 16px;
    }

    html.ehtw-list .ehtw-tweet {
        grid-template-columns: 40px minmax(0, 1fr) !important;
        gap: 8px !important;
        padding: 12px !important;
    }

    html.ehtw-list .ehtw-tweet-author .ehtw-handle {
        max-width: 72px;
    }

    html.ehtw-list .ehtw-tweet-author .cn {
        max-width: 72px !important;
    }
}
/* ============================================================
   0.8.0 搜索框可见性修复
   ============================================================ */

/* 原站搜索输入框的父级是 form 的第二层 div。 */
#ehtw-search-card #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form > div:has(> .ehtw-search-input-wrap),
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form > div:has(> .ehtw-search-input-wrap) {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
}

/* 折叠时只隐藏 Search、Clear 等非搜索输入控件。 */
#ehtw-search-card #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form input[type="submit"],
#ehtw-search-card #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form input[type="button"],
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form input[type="submit"],
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) form input[type="button"] {
    display: none !important;
}

/* 展开时恢复操作按钮；保留 form 提交行为。 */
#ehtw-search-card #searchbox.ehtw-filters-open form input[type="submit"],
#ehtw-search-card #searchbox.ehtw-filters-open form input[type="button"],
#ehtw-mobile-search #searchbox.ehtw-filters-open form input[type="submit"],
#ehtw-mobile-search #searchbox.ehtw-filters-open form input[type="button"] {
    display: inline-block !important;
}

#ehtw-search-card #searchbox,
#ehtw-mobile-search #searchbox {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    width: 100% !important;
    min-width: 0 !important;
}

#ehtw-search-card #searchbox form,
#ehtw-mobile-search #searchbox form {
    order: 0;
    width: 100% !important;
    min-width: 0 !important;
}

#ehtw-search-card #searchbox .ehtw-filters-toggle,
#ehtw-mobile-search #searchbox .ehtw-filters-toggle {
    order: 1;
    align-self: flex-start;
    display: inline-flex !important;
    margin-top: 6px !important;
    margin-bottom: 4px !important;
}

#ehtw-search-card .ehtw-search-input-wrap,
#ehtw-mobile-search .ehtw-search-input-wrap {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

#ehtw-search-card .ehtw-search-input-wrap #f_search,
#ehtw-mobile-search .ehtw-search-input-wrap #f_search {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 42px !important;
    padding-left: 44px !important;
}

#ehtw-mobile-search {
    width: 100%;
    min-width: 0;
    max-width: 100%;
}

/* ============================================================
   0.8.0 左栏导航左对齐
   ============================================================ */

#ehtw-left #nb {
    text-align: left !important;
    align-items: flex-start !important;
}

#ehtw-left #nb .ehtw-nav-entry,
#ehtw-left #nb .ehtw-more-entry {
    text-align: left !important;
}

#ehtw-left #nb .ehtw-nav-link,
#ehtw-left #nb .ehtw-more-button {
    display: flex !important;
    width: fit-content !important;
    max-width: 100% !important;
    justify-content: flex-start !important;
    text-align: left !important;
    margin-left: 8px !important;
    padding: 12px !important;
}

#ehtw-left .ehtw-post-button {
    width: 90% !important;
    margin: 18px 0 0 8px !important;
    text-align: center !important;
}

/* ============================================================
   0.8.0 列表标签
   ============================================================ */

html.ehtw-list .ehtw-tags .ehtw-hashtag-overflow {
    display: none !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag {
    display: inline !important;
    width: auto !important;
    max-width: 100%;
    margin-right: 6px !important;
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 0 !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag::before {
    content: none !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag a {
    display: inline !important;
    color: var(--ehtw-accent) !important;
    font-weight: 400 !important;
    text-decoration: none !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag a:hover {
    text-decoration: underline !important;
}

/* ============================================================
   0.8.0 详情标签：覆盖 gt / gtl / gtw
   ============================================================ */

html.ehtw-detail .ehtw-detail-tags,
html.ehtw-detail .ehtw-detail-meta {
    display: block !important;
    clear: both !important;
    float: none !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
}

html.ehtw-detail .ehtw-detail-tags {
    position: static !important;
    margin: 8px 0 12px !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
}

html.ehtw-detail .ehtw-detail-tags #gd4,
html.ehtw-detail .ehtw-detail-tags #taglist {
    display: block !important;
    position: static !important;
    float: none !important;
    clear: both !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    overflow: visible !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist table,
html.ehtw-detail .ehtw-detail-tags #taglist tbody,
html.ehtw-detail .ehtw-detail-tags #taglist tr,
html.ehtw-detail .ehtw-detail-tags #taglist td:not(.tc) {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    vertical-align: baseline !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist td.tc {
    display: none !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 7px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    white-space: normal !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt::before,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl::before,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw::before {
    content: none !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt a,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl a,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw a {
    display: inline !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    background: transparent !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt a:hover,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl a:hover,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw a:hover {
    text-decoration: underline !important;
}

/* ============================================================
   0.8.0 详情标题原站红线与背景
   ============================================================ */

html.ehtw-detail .ehtw-detail-post #gd2,
html.ehtw-detail .ehtw-detail-post #gn,
html.ehtw-detail .ehtw-detail-post #gj,
html.ehtw-detail .ehtw-detail-meta #gmid,
html.ehtw-detail .ehtw-detail-meta #gd3,
html.ehtw-detail .ehtw-detail-meta #gdn,
html.ehtw-detail .ehtw-detail-meta #gdc,
html.ehtw-detail .ehtw-detail-meta #gdd,
html.ehtw-detail .ehtw-detail-meta #gdr,
html.ehtw-detail .ehtw-detail-meta #gdf {
    border: none !important;
    border-top: 0 !important;
    border-bottom: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
}

html.ehtw-detail .ehtw-detail-post #gd2,
html.ehtw-detail .ehtw-detail-post #gn,
html.ehtw-detail .ehtw-detail-post #gj {
    text-align: left !important;
}

html.ehtw-detail .ehtw-detail-post #gn {
    font-size: 17px !important;
    line-height: 24px !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-detail .ehtw-detail-post #gj {
    font-size: 15px !important;
    color: var(--ehtw-muted) !important;
}

/* ============================================================
   0.8.0 推文和评论头部间距
   ============================================================ */

html.ehtw-list .ehtw-tweet-author {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 4px !important;
}

html.ehtw-list .ehtw-tweet-author .ehtw-handle {
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 140px !important;
}

html.ehtw-list .ehtw-tweet-author .ehtw-tweet-more {
    margin-left: auto !important;
    flex: 0 0 18px;
}

html.ehtw-detail .ehtw-comment-heading {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 4px !important;
}

html.ehtw-detail .ehtw-comment-heading .ehtw-comment-handle {
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
}

/* ============================================================
   0.8.0 About 卡片与 Gallery actions
   ============================================================ */

html.ehtw-detail .ehtw-about-card,
html.ehtw-detail .ehtw-about-card * {
    text-align: left !important;
}

html.ehtw-detail .ehtw-about-card #gdd {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 16px 14px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 14px !important;
}

html.ehtw-detail .ehtw-about-card #gdd table {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border-collapse: collapse !important;
    background: transparent !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-about-card #gdd tr,
html.ehtw-detail .ehtw-about-card #gdd td {
    background: transparent !important;
    border-color: var(--ehtw-border) !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-about-card #gdd td {
    width: auto !important;
    height: auto !important;
    padding: 7px 4px !important;
    font-size: 14px !important;
    line-height: 20px !important;
    vertical-align: top !important;
}

html.ehtw-detail .ehtw-about-card #gdd .gdt1,
html.ehtw-detail .ehtw-about-card #gdd td:first-child {
    width: 90px !important;
    min-width: 90px !important;
    max-width: 90px !important;
    color: var(--ehtw-muted) !important;
    font-size: 14px !important;
    font-weight: 400 !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 {
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 16px 12px !important;
    text-align: left !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: 1.5 !important;
    font-weight: 400 !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 > div,
html.ehtw-detail .ehtw-operation-card #gd5 > p {
    display: block !important;
    position: static !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 8px 0 !important;
    border: 0 !important;
    background: transparent !important;
    background-image: none !important;
    text-align: left !important;
    font-size: 15px !important;
    font-weight: 400 !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 a {
    display: inline !important;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 1.5 !important;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 a:hover {
    color: var(--ehtw-text) !important;
    text-decoration: underline !important;
}

/* ============================================================
   0.8.0 评论视觉排版
   ============================================================ */

html.ehtw-detail .ehtw-comments-section > .ehtw-section-title {
    display: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet {
    position: relative !important;
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-rows: 20px auto auto;
    column-gap: 12px;
    row-gap: 4px;
    padding: 12px 16px !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-heading {
    grid-column: 2 !important;
    grid-row: 1 !important;
    padding-right: 90px !important;
    min-width: 0 !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-author {
    font-size: 15px !important;
    font-weight: 700 !important;
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-author a {
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-author a:hover {
    color: var(--ehtw-text) !important;
    text-decoration: underline !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 {
    position: absolute !important;
    top: 12px !important;
    right: 16px !important;
    left: auto !important;
    display: flex !important;
    width: auto !important;
    max-width: min(45%, 180px) !important;
    height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    align-items: center !important;
    justify-content: flex-end !important;
    background: transparent !important;
    border: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 .c3 {
    display: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 .c4 {
    display: inline !important;
    width: auto !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    text-align: right !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c6 {
    grid-column: 2 !important;
    grid-row: 2 !important;
    width: 100% !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    text-indent: 0 !important;
    text-align: left !important;
    font-size: 15px !important;
    line-height: 20px !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c7 {
    grid-column: 2 !important;
    grid-row: 3 !important;
    margin: 0 !important;
    text-indent: 0 !important;
}

/* 评论提交入口：保留原始 a、onclick 和 #formdiv。 */
html.ehtw-detail .ehtw-comments-section #postnewcomment {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    width: 100% !important;
    padding: 12px 16px !important;
    background: transparent !important;
    border-top: 1px solid var(--ehtw-border) !important;
    text-align: right !important;
}

html.ehtw-detail .ehtw-comments-section #postnewcomment a,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick] {
    display: inline-flex !important;
    position: relative !important;
    align-items: center !important;
    justify-content: center !important;
    width: auto !important;
    min-width: 150px !important;
    height: 36px !important;
    min-height: 36px !important;
    padding: 0 16px !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 9999px !important;
    background: var(--ehtw-accent) !important;
    color: transparent !important;
    font-size: 0 !important;
    line-height: 36px !important;
    text-decoration: none !important;
    cursor: pointer;
    overflow: hidden !important;
}

html.ehtw-detail .ehtw-comments-section #postnewcomment a::after,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick]::after {
    content: "Post your reply";
    display: block;
    position: absolute;
    inset: 0;
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
    line-height: 36px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
}

html.ehtw-detail .ehtw-comments-section #postnewcomment a:hover,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick]:hover {
    filter: brightness(0.92);
}

/* ============================================================
   移动端保留图标型底栏
   ============================================================ */

@media (max-width: 699px) {
    #ehtw-left #nb .ehtw-nav-link,
    #ehtw-left #nb .ehtw-more-button {
        width: 100% !important;
        margin-left: 0 !important;
        justify-content: center !important;
        text-align: center !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra .ehtw-nav-link {
        width: 100% !important;
        margin-left: 0 !important;
        justify-content: flex-start !important;
        text-align: left !important;
    }

    .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-heading {
        padding-right: 68px !important;
    }

    html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 {
        right: 12px !important;
        max-width: 110px !important;
    }
}
/* ============================================================
   0.9.0 详情标签换行和左对齐
   ============================================================ */

html.ehtw-detail #ehtw-center .ehtw-detail-tags,
html.ehtw-detail #ehtw-center .ehtw-detail-tags * {
    white-space: normal !important;
    max-width: 100% !important;
    overflow-wrap: anywhere !important;
    text-align: left !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags {
    display: block !important;
    position: static !important;
    clear: both !important;
    float: none !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    margin: 8px 0 12px !important;
    padding: 0 !important;
    overflow: visible !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #gd4,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist {
    display: block !important;
    position: static !important;
    float: none !important;
    clear: both !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    overflow: visible !important;
    text-align: left !important;
    white-space: normal !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist table,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist tbody,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist tr,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist td:not(.tc) {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    text-align: left !important;
    white-space: normal !important;
    vertical-align: baseline !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gt,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtl,
html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtw {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    height: auto !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    white-space: normal !important;
    overflow-wrap: anywhere !important;
    text-align: left !important;
}

/* ============================================================
   0.9.0 时间行与新标签输入框
   ============================================================ */

html.ehtw-detail #ehtw-center .ehtw-detail-meta {
    display: block !important;
    position: static !important;
    clear: both !important;
    float: none !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    text-align: left !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-timestamp {
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 12px 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 15px !important;
    line-height: 20px !important;
    text-align: left !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #newtagfield {
    display: inline-block !important;
    position: static !important;
    float: none !important;
    width: min(100%, 280px) !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 36px !important;
    min-height: 36px !important;
    margin: 8px 6px 4px 0 !important;
    padding: 0 14px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    outline: none !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 14px !important;
    line-height: 34px !important;
    text-align: left !important;
    vertical-align: middle !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #newtagfield:focus {
    border-color: var(--ehtw-accent) !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #newtagbutton {
    display: inline-flex !important;
    position: static !important;
    float: none !important;
    align-items: center !important;
    justify-content: center !important;
    width: auto !important;
    min-width: 72px !important;
    max-width: 100% !important;
    height: 36px !important;
    min-height: 36px !important;
    margin: 8px 0 4px !important;
    padding: 0 14px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 14px !important;
    line-height: 34px !important;
    text-align: center !important;
    vertical-align: middle !important;
    cursor: pointer;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags #newtagbutton:hover {
    background: var(--ehtw-nav-hover) !important;
}

/* ============================================================
   0.9.0 评论头部与正文顺序
   ============================================================ */

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr) !important;
    grid-template-rows: auto auto auto !important;
    column-gap: 12px !important;
    row-gap: 4px !important;
    position: relative !important;
    padding: 12px 16px !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .ehtw-comment-heading {
    grid-column: 2 !important;
    grid-row: 1 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 4px !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 20px !important;
    padding: 0 115px 0 0 !important;
    margin: 0 !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 {
    grid-column: 2 !important;
    grid-row: 1 !important;
    position: static !important;
    float: none !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    gap: 4px !important;
    justify-self: end !important;
    align-self: start !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 115px !important;
    height: auto !important;
    min-height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    z-index: 1;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 .c3 {
    display: none !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 .c4 {
    display: inline-flex !important;
    position: static !important;
    float: none !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    flex: 0 0 auto !important;
    align-items: center !important;
    justify-content: flex-end !important;
    margin: 0 0 0 auto !important;
    padding: 0 !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    line-height: 20px !important;
    font-weight: 400 !important;
    text-align: right !important;
    background: transparent !important;
    border: none !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c2 > .c {
    display: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c6 {
    grid-column: 2 !important;
    grid-row: 2 !important;
    position: static !important;
    float: none !important;
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    text-indent: 0 !important;
    text-align: left !important;
    font-size: 15px !important;
    line-height: 20px !important;
    clear: both !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c7 {
    grid-column: 2 !important;
    grid-row: 3 !important;
    position: static !important;
    float: none !important;
    margin: 0 !important;
    padding: 0 !important;
}

/* ============================================================
   0.9.0 隐藏 Post New Comment 两侧的文本方括号
   ============================================================ */

html.ehtw-detail .ehtw-comments-section #postnewcomment {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    width: 100% !important;
    font-size: 0 !important;
    line-height: 0 !important;
    color: transparent !important;
    text-align: right !important;
}

html.ehtw-detail .ehtw-comments-section #postnewcomment a,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick] {
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 36px !important;
    color: #ffffff !important;
    background: var(--ehtw-accent) !important;
    height: 36px !important;
    min-height: 36px !important;
    border-radius: 9999px !important;
    text-align: center !important;
    white-space: nowrap !important;
}

/* 保持原始链接文字不可见，由伪元素提供按钮文案。 */
html.ehtw-detail .ehtw-comments-section #postnewcomment a,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick] {
    font-size: 0 !important;
}

html.ehtw-detail .ehtw-comments-section #postnewcomment a::after,
html.ehtw-detail .ehtw-comments-section #postnewcomment [onclick]::after {
    content: "Post your reply";
    color: #ffffff !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 36px !important;
    pointer-events: none;
}

/* 1.0.0 收尾：标签不在单词中间断行，列表标签最多 6 个，评论标注不被裁切。 */
.ehtw-detail-tags,
.ehtw-detail-tags * {
    overflow-wrap: break-word !important;
}

html.ehtw-list .ehtw-tags .ehtw-hashtag:nth-child(n+7) {
    display: none !important;
}

html.ehtw-list .ehtw-media {
    margin-top: 12px !important;
}

#cdiv .c2 .c4 {
    flex: none !important;
    min-width: max-content !important;
    overflow: visible !important;
    padding: 0 0 0 8px !important;
    text-indent: 0 !important;
}
/* ============================================================
   1.1.0 X 实测尺寸：1440px 视口下三栏 267 / 600 / 380
   ============================================================ */

html.ehtw-enabled {
    -webkit-font-smoothing: antialiased;
}

html.ehtw-enabled body {
    -webkit-font-smoothing: antialiased;
}

html.ehtw-enabled #ehtw-shell {
    width: 1247px !important;
    max-width: 100% !important;
    grid-template-columns:
        267px minmax(0, 600px) 380px !important;
}

html.ehtw-enabled #ehtw-left {
    width: 267px !important;
    min-width: 0 !important;
    max-width: 267px !important;
    padding: 0 !important;
    margin: 0 !important;
}

html.ehtw-enabled #ehtw-center {
    width: 600px !important;
    min-width: 0 !important;
    max-width: 100% !important;
    border-left: 1px solid var(--ehtw-border) !important;
    border-right: 1px solid var(--ehtw-border) !important;
}

html.ehtw-enabled #ehtw-right {
    width: 380px !important;
    min-width: 0 !important;
    max-width: 380px !important;
    padding: 0 0 32px 30px !important;
    margin: 0 !important;
}

/* ============================================================
   左栏：Logo、58px 导航行、Post、账号
   ============================================================ */

html.ehtw-enabled #ehtw-left {
    display: flex !important;
    flex-direction: column !important;
    align-items: flex-start !important;
    min-height: 0 !important;
    max-height: 100vh !important;
}

#ehtw-left .ehtw-brand-link {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex: 0 0 52px !important;
    width: 52px !important;
    height: 52px !important;
    min-height: 52px !important;
    max-height: 52px !important;
    margin: 2px 0 4px !important;
    padding: 0 14px !important;
    border-radius: 9999px !important;
    width: auto !important;
    min-width: 52px !important;
    max-width: 100% !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    white-space: nowrap !important;
}

#ehtw-left #nb {
    flex: 0 0 auto !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    gap: 0 !important;
    align-items: flex-start !important;
    text-align: left !important;
}

#ehtw-left #nb .ehtw-nav-entry,
#ehtw-left #nb .ehtw-more-entry {
    display: block !important;
    flex: 0 0 auto !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 58px !important;
    min-height: 58px !important;
    max-height: 58px !important;
    margin: 0 !important;
    padding: 4px 0 !important;
    text-align: left !important;
    background: transparent !important;
}

#ehtw-left #nb .ehtw-nav-link,
#ehtw-left #nb .ehtw-more-button {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 20px !important;
    width: fit-content !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 50px !important;
    min-height: 50px !important;
    max-height: 50px !important;
    margin: 0 !important;
    padding: 12px !important;
    border: none !important;
    border-radius: 9999px !important;
    text-align: left !important;
    line-height: 24px !important;
    font-size: 20px !important;
    font-weight: 400 !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
}

#ehtw-left #nb .ehtw-nav-link .ehtw-svg-icon,
#ehtw-left #nb .ehtw-more-button .ehtw-svg-icon {
    width: 26px !important;
    height: 26px !important;
    min-width: 26px !important;
    min-height: 26px !important;
    flex: 0 0 26px !important;
}

#ehtw-left #nb .ehtw-nav-label {
    display: inline !important;
    font-size: 20px !important;
    line-height: 24px !important;
    font-weight: inherit !important;
    white-space: nowrap !important;
}

#ehtw-left #nb .ehtw-nav-current .ehtw-nav-link {
    font-weight: 700 !important;
}

#ehtw-left #nb .ehtw-nav-extra {
    display: none !important;
}

#ehtw-left #nb.ehtw-nav-open .ehtw-nav-extra {
    display: block !important;
}

#ehtw-left .ehtw-post-button {
    flex: 0 0 52px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 233px !important;
    min-width: 233px !important;
    max-width: 233px !important;
    height: 52px !important;
    min-height: 52px !important;
    max-height: 52px !important;
    margin: 20px 0 0 !important;
    padding: 0 32px !important;
    border: none !important;
    border-radius: 9999px !important;
    background: #0f1419 !important;
    color: #ffffff !important;
    font-size: 17px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
    text-align: center !important;
    text-decoration: none !important;
}

#ehtw-left .ehtw-account-card {
    position: relative;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    flex: 0 0 65px;
    width: 259px;
    min-width: 0;
    max-width: 259px;
    height: 65px;
    min-height: 65px;
    max-height: 65px;
    margin: auto 0 12px;
    padding: 12px;
    border-radius: 9999px;
    background: transparent;
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
    cursor: pointer;
}

#ehtw-left .ehtw-account-card:hover {
    background: var(--ehtw-nav-hover);
    color: var(--ehtw-text) !important;
}

.ehtw-account-avatar,
.ehtw-composer-avatar,
.ehtw-who-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 40px;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: 50%;
    background: #536471;
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
}

.ehtw-account-text {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    overflow: hidden;
}

.ehtw-account-name,
.ehtw-account-handle {
    display: block;
    min-width: 0;
    max-width: 100%;
    font-size: 15px;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-account-name {
    color: var(--ehtw-text);
    font-weight: 700;
}

.ehtw-account-handle {
    color: var(--ehtw-muted);
    font-weight: 400;
}

.ehtw-account-menu {
    position: absolute;
    z-index: 1200;
    left: 0;
    bottom: calc(100% + 8px);
    width: 259px;
    max-width: calc(100vw - 24px);
    padding: 8px;
    border: 1px solid var(--ehtw-border);
    border-radius: 14px;
    background: var(--ehtw-card);
    box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
}

.ehtw-account-menu[hidden] {
    display: none !important;
}

.ehtw-account-menu-action {
    display: block;
    padding: 12px 14px;
    border-radius: 10px;
    color: var(--ehtw-text) !important;
    font-size: 15px;
    font-weight: 700;
    text-decoration: none !important;
}

.ehtw-account-menu-action:hover,
.ehtw-account-menu-action:focus-visible {
    background: var(--ehtw-nav-hover);
    outline: none;
}

.ehtw-account-more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--ehtw-text);
}

.ehtw-account-more svg {
    width: 20px;
    height: 20px;
}

/* ============================================================
   中栏 Tab 与发帖框
   ============================================================ */

#ehtw-header.ehtw-tabs-header {
    height: 53px !important;
    min-height: 53px !important;
    max-height: 53px !important;
}

#ehtw-header .ehtw-top-tab {
    height: 53px !important;
    font-size: 15px !important;
    font-weight: 500 !important;
    color: #71767b !important;
}

#ehtw-header .ehtw-top-tab.ehtw-tab-active {
    color: var(--ehtw-text) !important;
    font-weight: 700 !important;
}

#ehtw-header .ehtw-top-tab.ehtw-tab-active .ehtw-top-tab-label::after {
    height: 4px !important;
    border-radius: 9999px !important;
}

html.ehtw-list .ehtw-composer {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 8px;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ehtw-border);
    background: transparent;
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

html.ehtw-list .ehtw-composer:hover {
    color: var(--ehtw-text) !important;
}

.ehtw-composer-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.ehtw-composer-placeholder {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 56px;
    color: var(--ehtw-muted);
    font-size: 20px;
    font-weight: 400;
    line-height: 24px;
}

.ehtw-composer-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    width: 100%;
}

.ehtw-composer-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    height: 36px;
    min-height: 36px;
    padding: 0 16px;
    border-radius: 9999px;
    background: #0f1419;
    color: #ffffff;
    font-size: 15px;
    line-height: 20px;
    font-weight: 700;
}

/* 上方搜索工具栏：保持在原搜索框内，随 Filters 展开。 */

#ehtw-search-card #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) .ehtw-search-mode-toolbar,
#ehtw-mobile-search #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open) .ehtw-search-mode-toolbar {
    display: none !important;
}

#ehtw-search-card #searchbox.ehtw-filters-open .ehtw-search-mode-toolbar,
#ehtw-mobile-search #searchbox.ehtw-filters-open .ehtw-search-mode-toolbar {
    display: flex !important;
    position: static !important;
    float: none !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 5px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 40px !important;
    margin: 8px 0 0 !important;
    padding: 5px 0 !important;
    border: none !important;
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

#ehtw-search-card .ehtw-search-mode-toolbar a,
#ehtw-search-card .ehtw-search-mode-toolbar select,
#ehtw-mobile-search .ehtw-search-mode-toolbar a,
#ehtw-mobile-search .ehtw-search-mode-toolbar select {
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    border: none !important;
    border-radius: 0 !important;
    font-size: 13px !important;
}

/* ============================================================
   列表推文：精确间距与原图比例
   ============================================================ */

html.ehtw-list .ehtw-tweet {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr) !important;
    column-gap: 8px !important;
    row-gap: 0 !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 12px 16px 12px !important;
    border-left: none !important;
    border-right: none !important;
    border-top: none !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
}

html.ehtw-list .ehtw-tweet-content {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-list .ehtw-tweet-author {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    flex-wrap: nowrap !important;
    gap: 4px !important;
    width: 100% !important;
    height: 20px !important;
    min-height: 20px !important;
    margin: 0 0 2px !important;
    padding: 0 !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-author-name,
html.ehtw-list .ehtw-author-name a {
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-list .ehtw-handle,
html.ehtw-list .ehtw-time,
html.ehtw-list .ehtw-dot {
    color: #71767b !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-tweet-more {
    flex: 0 0 19px !important;
    width: 19px !important;
    height: 20px !important;
    margin-left: auto !important;
    color: #71767b !important;
}

html.ehtw-list .ehtw-tweet-more svg {
    width: 19px !important;
    height: 20px !important;
}

html.ehtw-list .ehtw-tweet-title {
    margin: 0 !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-list .ehtw-media {
    display: block !important;
    width: min(100%, calc(510px * var(--ehtw-ar, 1))) !important;
    max-width: 100% !important;
    max-height: 510px !important;
    height: auto !important;
    aspect-ratio: var(--ehtw-ar, 1) !important;
    margin: 12px 0 0 !important;
    padding: 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    overflow: hidden !important;
    background: var(--ehtw-media) !important;
}

html.ehtw-list .ehtw-media-link {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
}

html.ehtw-list .ehtw-media img {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    object-fit: cover !important;
    object-position: center center !important;
}

/* ============================================================
   推文操作栏：四项均分 + Bookmark / Share
   ============================================================ */

html.ehtw-list .ehtw-twitter-actions {
    display: grid !important;
    grid-template-columns:
        repeat(4, minmax(0, 1fr))
        19px
        19px !important;
    align-items: center !important;
    justify-content: stretch !important;
    column-gap: 4px !important;
    row-gap: 0 !important;
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
    height: 20px !important;
    min-height: 20px !important;
    margin: 12px 0 0 !important;
    padding: 0 !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action {
    display: inline-flex !important;
    justify-content: flex-start !important;
    align-items: center !important;
    gap: 0 !important;
    width: 100% !important;
    min-width: 0 !important;
    height: 20px !important;
    min-height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    color: #71767b !important;
    font-size: 13px !important;
    line-height: 16px !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-icon {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex: 0 0 19px !important;
    width: 19px !important;
    height: 19px !important;
    border-radius: 50% !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-icon svg {
    width: 18.75px !important;
    height: 18.75px !important;
    color: #71767b;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-action-number {
    display: inline !important;
    padding-left: 4px !important;
    color: #71767b !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 16px !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-bookmark,
html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-share {
    width: 19px !important;
    justify-self: end !important;
    padding: 0 !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-bookmark:hover {
    color: var(--ehtw-accent) !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-bookmark:hover .ehtw-twitter-action-icon {
    background: rgba(29, 155, 240, 0.1) !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-reply:hover,
html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-views:hover,
html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-share:hover {
    color: var(--ehtw-accent) !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-repost:hover {
    color: #00ba7c !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action-heart:hover {
    color: #f91880 !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action:hover .ehtw-action-number,
html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action:hover svg {
    color: inherit !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-twitter-action:hover .ehtw-twitter-action-icon {
    width: 34px !important;
    height: 34px !important;
    margin: 0 -7.5px !important;
}

/* ============================================================
   右栏搜索框：350 × 44，吸顶
   ============================================================ */

html.ehtw-enabled #ehtw-right #ehtw-search-card {
    position: sticky !important;
    top: 0 !important;
    z-index: 110 !important;
    width: 350px !important;
    min-width: 0 !important;
    max-width: 350px !important;
    min-height: 52px !important;
    margin: 0 !important;
    padding: 7px 0 0 !important;
    background: var(--ehtw-bg) !important;
}

#ehtw-search-card .ehtw-search-input-wrap {
    position: relative !important;
    width: 350px !important;
    max-width: 100% !important;
    min-width: 0 !important;
}

#ehtw-search-card #f_search,
#ehtw-mobile-search #f_search {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    padding: 0 12px 0 36px !important;
    margin: 0 !important;
    border: 1px solid #cfd9de !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: normal !important;
    box-shadow: none !important;
}

#ehtw-search-card #f_search::placeholder,
#ehtw-mobile-search #f_search::placeholder {
    color: #71767b !important;
    opacity: 1 !important;
}

#ehtw-search-card #f_search:focus,
#ehtw-mobile-search #f_search:focus {
    border: 1px solid var(--ehtw-accent) !important;
    outline: none !important;
    box-shadow: none !important;
}

#ehtw-search-card .ehtw-search-input-wrap .ehtw-search-icon,
#ehtw-mobile-search .ehtw-search-input-wrap .ehtw-search-icon {
    position: absolute !important;
    top: 50% !important;
    left: 14px !important;
    width: 16px !important;
    height: 16px !important;
    transform: translateY(-50%) !important;
    color: #71767b !important;
}

#ehtw-search-card #searchbox .ehtw-filters-toggle,
#ehtw-mobile-search #searchbox .ehtw-filters-toggle {
    display: inline-flex !important;
    align-self: flex-end !important;
    justify-content: flex-end !important;
    gap: 6px !important;
    width: fit-content !important;
    height: 26px !important;
    margin: 3px 0 0 auto !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    color: var(--ehtw-accent) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
}

/* ============================================================
   趋势卡片：两行、每行约 62px
   ============================================================ */

html.ehtw-enabled #ehtw-right .ehtw-trending-card {
    order: 1;
    width: 350px !important;
    min-width: 0 !important;
    max-width: 350px !important;
    margin: 16px 0 0 !important;
    padding: 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
}

html.ehtw-enabled #ehtw-right .ehtw-trending-card .ehtw-side-title {
    margin: 0 !important;
    padding: 12px 16px !important;
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
}

.ehtw-trending-card .ehtw-trend {
    display: flex !important;
    align-items: flex-start !important;
    justify-content: space-between !important;
    gap: 8px !important;
    width: 100% !important;
    min-height: 62px !important;
    padding: 12px 16px !important;
    color: var(--ehtw-text) !important;
}

.ehtw-trending-card .ehtw-trend:hover {
    background: var(--ehtw-nav-hover) !important;
}

.ehtw-trend-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
}

.ehtw-trending-card .ehtw-trend-category {
    display: block;
    width: 100%;
    min-width: 0;
    color: #71767b !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 16px !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-trending-card .ehtw-trend-name {
    display: block;
    width: 100%;
    min-width: 0;
    margin: 0 !important;
    padding: 0 !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-trend-more {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 18px;
    width: 18px;
    height: 18px;
    color: #71767b !important;
}

.ehtw-trend-more svg {
    width: 18px;
    height: 18px;
}

.ehtw-trending-card .ehtw-trend-count {
    display: none !important;
}

.ehtw-trending-card .ehtw-trending-more {
    display: block;
    width: 100%;
    min-height: 50px;
    margin: 0 !important;
    padding: 16px !important;
    border: none !important;
    border-radius: 0 0 16px 16px;
    background: transparent !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 18px !important;
    text-align: left !important;
}

/* ============================================================
   Who to follow
   ============================================================ */

html.ehtw-enabled #ehtw-right {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 0 !important;
}

html.ehtw-enabled #ehtw-right #ehtw-search-card {
    order: 0;
}

html.ehtw-enabled #ehtw-right .ehtw-who-card {
    order: 2;
    width: 350px !important;
    min-width: 0 !important;
    max-width: 350px !important;
    margin: 16px 0 0 !important;
    padding: 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
}

.ehtw-who-card .ehtw-side-title {
    margin: 0 !important;
    padding: 12px 16px !important;
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
}

.ehtw-who-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    min-height: 65px;
    padding: 12px 16px;
    background: transparent;
}

.ehtw-who-row:hover {
    background: var(--ehtw-nav-hover);
}

.ehtw-who-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
}

.ehtw-who-name {
    display: block;
    min-width: 0;
    max-width: 100%;
    color: var(--ehtw-text) !important;
    font-size: 15px;
    font-weight: 700;
    line-height: 20px;
    text-decoration: none !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-who-name:hover {
    text-decoration: underline !important;
}

.ehtw-who-handle {
    display: block;
    min-width: 0;
    max-width: 100%;
    color: #71767b;
    font-size: 15px;
    font-weight: 400;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ehtw-who-view {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: 32px;
    min-height: 32px;
    padding: 0 16px;
    border-radius: 9999px;
    background: #0f1419;
    color: #ffffff !important;
    font-size: 14px;
    font-weight: 700;
    line-height: 18px;
    text-decoration: none !important;
}

.ehtw-who-view:hover {
    opacity: 0.88;
    color: #ffffff !important;
}

/* ============================================================
   页脚：X 实测左对齐间距
   ============================================================ */

html.ehtw-enabled #ehtw-right .ehtw-footer {
    order: 99;
    width: 350px !important;
    min-width: 0 !important;
    max-width: 350px !important;
    margin: 16px 0 24px !important;
    padding: 0 16px !important;
    border: none !important;
    background: transparent !important;
    color: #71767b !important;
    text-align: left !important;
    font-size: 13px !important;
    line-height: 16px !important;
}

html.ehtw-enabled #ehtw-right .ehtw-footer .dp,
html.ehtw-enabled #ehtw-right .ehtw-footer .dp a {
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    color: #71767b !important;
    text-align: left !important;
    font-size: 13px !important;
    line-height: 16px !important;
}

/* ============================================================
   详情页右栏内容与标题边缘一致
   ============================================================ */

html.ehtw-detail #ehtw-right .ehtw-operation-card #gd5,
html.ehtw-detail #ehtw-right .ehtw-about-card #gdd {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 12px 16px !important;
    text-align: left !important;
}

html.ehtw-detail #ehtw-right .ehtw-operation-card #gd5 > div,
html.ehtw-detail #ehtw-right .ehtw-operation-card #gd5 > p {
    margin: 0 !important;
    padding: 8px 0 !important;
    text-align: left !important;
}

/* ============================================================
   深色主题按钮
   ============================================================ */

@media (prefers-color-scheme: dark) {
    #ehtw-left .ehtw-post-button,
    .ehtw-composer-button,
    .ehtw-who-view {
        background: #eff3f4 !important;
        color: #0f1419 !important;
    }

    #ehtw-search-card #f_search,
    #ehtw-mobile-search #f_search {
        border-color: #2f3336 !important;
    }

    #ehtw-search-card #f_search:focus,
    #ehtw-mobile-search #f_search:focus {
        border-color: var(--ehtw-accent) !important;
    }
}

/* ============================================================
   响应式：保留已验证的手机底栏逻辑
   ============================================================ */

@media (max-width: 999px) {
    html.ehtw-enabled #ehtw-shell {
        width: min(100%, 867px) !important;
        grid-template-columns:
            267px minmax(0, 600px) !important;
    }

    html.ehtw-enabled #ehtw-right {
        display: none !important;
    }

    html.ehtw-enabled #ehtw-center {
        width: 100% !important;
    }
}

@media (max-width: 699px) {
    html.ehtw-enabled #ehtw-shell {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
    }

    html.ehtw-enabled #ehtw-left {
        position: fixed !important;
        top: auto !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 1000 !important;
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100vw !important;
        height: 64px !important;
        min-height: 64px !important;
        max-height: 64px !important;
        padding: 4px 6px !important;
        overflow-x: hidden !important;
        overflow-y: hidden !important;
    }

    #ehtw-left .ehtw-account-card {
        display: none !important;
    }

    #ehtw-left .ehtw-brand-link,
    #ehtw-left .ehtw-post-button {
        display: none !important;
    }

    #ehtw-left #nb {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        justify-content: space-around !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: 100% !important;
    }

    #ehtw-left #nb .ehtw-nav-entry,
    #ehtw-left #nb .ehtw-more-entry {
        display: block !important;
        flex: 1 1 0 !important;
        width: auto !important;
        min-width: 0 !important;
        max-width: none !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        padding: 0 !important;
    }

    #ehtw-left #nb .ehtw-nav-link,
    #ehtw-left #nb .ehtw-more-button {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: 48px !important;
        min-height: 48px !important;
        max-height: 48px !important;
        margin: 0 !important;
        padding: 8px 4px !important;
        gap: 0 !important;
    }

    #ehtw-left #nb .ehtw-nav-label {
        display: none !important;
    }

    #ehtw-left #nb .ehtw-nav-mobile-extra,
    #ehtw-left #nb .ehtw-nav-extra {
        display: none !important;
    }

    #ehtw-left:has(#nb.ehtw-nav-open) {
        height: auto !important;
        min-height: 64px !important;
        max-height: min(75vh, 560px) !important;
        overflow-y: auto !important;
    }

    #ehtw-left #nb.ehtw-nav-open {
        display: flex !important;
        flex-wrap: wrap !important;
        align-content: flex-start !important;
        height: auto !important;
        min-height: 0 !important;
        padding-top: 8px !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra,
    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-extra {
        display: block !important;
        flex: 0 0 100% !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        order: -1 !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra .ehtw-nav-link {
        justify-content: flex-start !important;
        gap: 16px !important;
        padding: 8px 16px !important;
    }

    #ehtw-left #nb.ehtw-nav-open .ehtw-nav-mobile-extra .ehtw-nav-label {
        display: inline !important;
        font-size: 16px !important;
    }

    html.ehtw-enabled #ehtw-center {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        border-left: none !important;
        border-right: none !important;
    }

    html.ehtw-list .ehtw-tweet {
        grid-template-columns:
            40px minmax(0, 1fr) !important;
        gap: 8px !important;
        padding: 12px !important;
    }
}
/* ============================================================
   1.2.0 手机 More 菜单：展开后主导航保持原宽度
   ============================================================ */

@media (max-width: 699px) {
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        align-content: flex-start !important;
        align-items: center !important;
        justify-content: space-around !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        padding-top: 8px !important;
        gap: 0 !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-entry:not(.ehtw-nav-mobile-extra):not(.ehtw-nav-extra),
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-more-entry {
        display: flex !important;
        flex: 1 1 0 !important;
        min-width: 0 !important;
        max-width: none !important;
        width: auto !important;
        height: 48px !important;
        min-height: 48px !important;
        max-height: 48px !important;
        margin: 0 !important;
        padding: 0 !important;
        order: 0 !important;
        align-items: center !important;
        justify-content: center !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-mobile-extra,
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-extra {
        display: block !important;
        flex: 0 0 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        margin: 0 !important;
        order: -1 !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-entry:not(.ehtw-nav-mobile-extra):not(.ehtw-nav-extra)
    .ehtw-nav-link,
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-more-entry .ehtw-more-button {
        display: flex !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: 48px !important;
        min-height: 48px !important;
        max-height: 48px !important;
        margin: 0 !important;
        padding: 8px 4px !important;
        justify-content: center !important;
        align-items: center !important;
        gap: 0 !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-entry:not(.ehtw-nav-mobile-extra):not(.ehtw-nav-extra)
    .ehtw-nav-label,
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-more-entry .ehtw-nav-label {
        display: none !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-nav-entry:not(.ehtw-nav-mobile-extra):not(.ehtw-nav-extra)
    .ehtw-svg-icon,
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open
    > .ehtw-more-entry .ehtw-svg-icon {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        min-height: 26px !important;
        flex: 0 0 26px !important;
    }
}

/* ============================================================
   1.2.0 右栏：卡片不参与 flex 收缩，独立纵向滚动
   ============================================================ */

@media (min-width: 1000px) {
    html.ehtw-enabled #ehtw-right {
        position: sticky !important;
        top: 0 !important;
        align-self: start !important;
        max-height: 100vh !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }

    html.ehtw-enabled #ehtw-right::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
    }

    html.ehtw-enabled #ehtw-right > * {
        flex: none !important;
        flex-grow: 0 !important;
        flex-shrink: 0 !important;
    }
}

/* ============================================================
   1.2.0 Trending：只显示前五项，按钮在其后
   ============================================================ */

html.ehtw-enabled #ehtw-right
.ehtw-trending-card:not(.ehtw-trending-expanded)
.ehtw-trend-extra {
    display: none !important;
}

html.ehtw-enabled #ehtw-right
.ehtw-trending-card.ehtw-trending-expanded
.ehtw-trend-extra {
    display: flex !important;
}

html.ehtw-enabled #ehtw-right
.ehtw-trending-card .ehtw-trending-more {
    display: block !important;
    margin: 0 !important;
    padding: 16px !important;
    border-top: 0 !important;
    background: transparent !important;
}

/* ============================================================
   1.2.0 左栏账号卡片：贴底且较矮窗口可滚动
   ============================================================ */

@media (min-width: 700px) {
    html.ehtw-enabled #ehtw-left {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        width: 267px !important;
        height: 100vh !important;
        min-height: 0 !important;
        max-height: 100vh !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        scrollbar-width: none !important;
    }

    html.ehtw-enabled #ehtw-left > #nb,
    html.ehtw-enabled #ehtw-left > .ehtw-post-button {
        flex: none !important;
        flex-grow: 0 !important;
        flex-shrink: 0 !important;
    }

    html.ehtw-enabled #ehtw-left > .ehtw-account-card {
        display: grid !important;
        grid-template-columns: 40px minmax(0, 1fr) !important;
        align-items: center !important;
        gap: 10px !important;
        flex: none !important;
        flex-grow: 0 !important;
        flex-shrink: 0 !important;
        width: 259px !important;
        min-width: 0 !important;
        max-width: 259px !important;
        height: 65px !important;
        min-height: 65px !important;
        max-height: 65px !important;
        margin: auto 0 12px !important;
        padding: 12px !important;
        border-radius: 9999px !important;
        text-align: left !important;
    }

    html.ehtw-enabled #ehtw-left
    .ehtw-account-text {
        display: flex !important;
        flex: 1 1 auto !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        justify-content: center !important;
        min-width: 0 !important;
        max-width: 100% !important;
        text-align: left !important;
    }

    html.ehtw-enabled #ehtw-left
    .ehtw-account-name,
    html.ehtw-enabled #ehtw-left
    .ehtw-account-handle {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        text-align: left !important;
    }
}

/* ============================================================
   1.2.0 搜索占位符：覆盖原站全局规则
   ============================================================ */

html.ehtw-enabled #f_search::placeholder {
    color: #536471 !important;
    opacity: 1 !important;
}

@media (prefers-color-scheme: dark) {
    html.ehtw-enabled #f_search::placeholder {
        color: #71767b !important;
        opacity: 1 !important;
    }
}

/* ============================================================
   1.2.0 详情标签：禁止单词内部断行
   ============================================================ */

html.ehtw-detail .ehtw-detail-tags #taglist,
html.ehtw-detail .ehtw-detail-tags #taglist * {
    overflow-wrap: normal !important;
    word-break: normal !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw {
    display: inline-block !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    white-space: nowrap !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
    vertical-align: baseline !important;
}

html.ehtw-detail .ehtw-detail-tags #taglist .gt a,
html.ehtw-detail .ehtw-detail-tags #taglist .gtl a,
html.ehtw-detail .ehtw-detail-tags #taglist .gtw a {
    display: inline !important;
    max-width: 100% !important;
    white-space: nowrap !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
}

/* ============================================================
   1.2.0 Gallery actions / About：统一左侧内边距
   ============================================================ */

html.ehtw-detail .ehtw-operation-card #gd5,
html.ehtw-detail .ehtw-about-card #gdd {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 12px 16px !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 p,
html.ehtw-detail .ehtw-operation-card #gd5 div {
    position: static !important;
    float: none !important;
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 8px 0 !important;
    background: none !important;
    background-image: none !important;
    border: none !important;
    text-indent: 0 !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 a {
    margin: 0 !important;
    padding: 0 !important;
    background: none !important;
    background-image: none !important;
    text-indent: 0 !important;
    text-align: left !important;
}

/* ============================================================
   1.2.0 Filters 与首张卡片间距
   ============================================================ */

html.ehtw-enabled #ehtw-right #ehtw-search-card {
    padding-bottom: 8px !important;
}

html.ehtw-enabled #ehtw-right.ehtw-toplist-only-sidebar
> :not(#ehtw-search-card):not(.ehtw-right-search) {
    display: none !important;
}

html.ehtw-enabled #ehtw-right
#ehtw-search-card + .ehtw-side-card,
html.ehtw-enabled #ehtw-right
.ehtw-trending-card {
    margin-top: 0 !important;
}

/* 1.2.1 收尾：手机 More 用网格，操作链接去箭头，右栏卡片间距，占位文字颜色。 */
@media (max-width: 699px) {
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open {
        display: grid !important;
        grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
        align-items: center !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open > .ehtw-nav-mobile-extra,
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open > .ehtw-nav-extra {
        grid-column: 1 / -1 !important;
        order: -1 !important;
        width: 100% !important;
    }

    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open > .ehtw-nav-entry:not(.ehtw-nav-mobile-extra):not(.ehtw-nav-extra),
    html.ehtw-enabled #ehtw-left #nb.ehtw-nav-open > .ehtw-more-entry {
        grid-column: auto !important;
        order: 0 !important;
        min-width: 0 !important;
        width: 100% !important;
    }

}

html.ehtw-detail .ehtw-operation-card #gd5 p > img {
    display: none !important;
}

html.ehtw-enabled #ehtw-right #ehtw-search-card ~ .ehtw-side-card.ehtw-who-card {
    margin-top: 16px !important;
}

html.ehtw-enabled #ehtw-search-card #f_search::placeholder,
html.ehtw-enabled #ehtw-mobile-search #f_search::placeholder {
    color: #71767b !important;
    -webkit-text-fill-color: #71767b !important;
    opacity: 1 !important;
}
/* ============================================================
   1.3.0 全局设计令牌
   ============================================================ */

html.ehtw-enabled,
html.ehtw-login {
    --ehtw-surface: transparent;
    --ehtw-card-border: var(--ehtw-border, #eff3f4);
    --ehtw-secondary: #536471;
    --ehtw-primary-button-bg: #0f1419;
    --ehtw-primary-button-text: #ffffff;
    --ehtw-secondary-button-border: #536471;
    --ehtw-category-text: #ffffff;
    -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
    html.ehtw-enabled,
    html.ehtw-login {
        --ehtw-bg: #000000;
        --ehtw-text: #e7e9ea;
        --ehtw-muted: #71767b;
        --ehtw-border: #2f3336;
        --ehtw-accent: #1d9bf0;
        --ehtw-input: #202327;
        --ehtw-nav-hover: rgba(231, 233, 234, 0.11);
        --ehtw-primary-button-bg: #eff3f4;
        --ehtw-primary-button-text: #0f1419;
        --ehtw-secondary-button-border: #536471;
        --ehtw-secondary: #71767b;
        color-scheme: dark;
    }
}

/* ============================================================
   C1. 统一按钮
   ============================================================ */

html.ehtw-enabled .ehtw-post-button,
html.ehtw-enabled .ehtw-composer-button,
html.ehtw-enabled .ehtw-who-view,
html.ehtw-enabled .ehtw-comments-section #postnewcomment a,
html.ehtw-enabled .ehtw-comments-section #postnewcomment [onclick],
html.ehtw-generic .ehtw-generic-content input[type="submit"],
html.ehtw-generic .ehtw-generic-content button:not(.ehtw-text-button),
html.ehtw-login input[type="submit"] {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 36px !important;
    border: none !important;
    border-radius: 9999px !important;
    background: var(--ehtw-primary-button-bg) !important;
    color: var(--ehtw-primary-button-text) !important;
    font-family: inherit !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    text-decoration: none !important;
    cursor: pointer;
}

html.ehtw-enabled .ehtw-post-button {
    height: 52px !important;
    min-height: 52px !important;
    padding: 0 32px !important;
    font-size: 17px !important;
}

html.ehtw-enabled .ehtw-composer-button,
html.ehtw-enabled .ehtw-who-view,
html.ehtw-enabled .ehtw-comments-section #postnewcomment a,
html.ehtw-enabled .ehtw-comments-section #postnewcomment [onclick],
html.ehtw-generic .ehtw-generic-content input[type="submit"],
html.ehtw-generic .ehtw-generic-content button:not(.ehtw-text-button),
html.ehtw-login input[type="submit"] {
    height: 36px !important;
    padding: 0 16px !important;
}

html.ehtw-enabled .ehtw-who-view {
    height: 32px !important;
    min-height: 32px !important;
    font-size: 14px !important;
}

html.ehtw-generic .ehtw-generic-content input[type="button"],
html.ehtw-login input[type="button"],
html.ehtw-enabled input[type="button"][value="Clear"],
html.ehtw-enabled button.ehtw-secondary-button {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    height: 36px !important;
    min-height: 36px !important;
    padding: 0 16px !important;
    border: 1px solid var(--ehtw-secondary-button-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    cursor: pointer;
}

html.ehtw-enabled .ehtw-filters-toggle,
html.ehtw-enabled .ehtw-trending-more {
    border: 0 !important;
    background: transparent !important;
    color: var(--ehtw-accent) !important;
    font-weight: 400 !important;
}

html.ehtw-enabled .ehtw-comments-section
#postnewcomment a::after,
html.ehtw-enabled .ehtw-comments-section
#postnewcomment [onclick]::after {
    color: var(--ehtw-primary-button-text) !important;
}

/* ============================================================
   C2. 统一卡片
   ============================================================ */

html.ehtw-enabled #ehtw-right .ehtw-side-card,
html.ehtw-generic .ehtw-generic-content .tdo,
html.ehtw-login body > .d {
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    overflow: hidden;
}

html.ehtw-enabled .ehtw-side-card .ehtw-side-title {
    margin: 0 !important;
    padding: 12px 16px !important;
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
    text-align: left !important;
}

html.ehtw-enabled #ehtw-right .ehtw-side-card
.ehtw-trend,
html.ehtw-enabled #ehtw-right .ehtw-side-card
.ehtw-who-row {
    padding: 12px 16px !important;
}

html.ehtw-detail .ehtw-about-card #gdd,
html.ehtw-detail .ehtw-operation-card #gd5 {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 16px 12px !important;
    background: transparent !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-about-card #gdd table {
    margin-top: 0 !important;
    border-spacing: 0 !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-about-card #gdd table tr:first-child td {
    padding-top: 0 !important;
}

html.ehtw-detail .ehtw-operation-card #gd5 p,
html.ehtw-detail .ehtw-operation-card #gd5 div {
    margin: 0 !important;
    padding: 8px 0 !important;
    text-align: left !important;
    text-indent: 0 !important;
    background: transparent !important;
    background-image: none !important;
}

/* ============================================================
   C3. 分类色：扁平背景
   ============================================================ */

html.ehtw-enabled {
    --ehtw-ct1: #707070;
    --ehtw-ct2: #fc4e4e;
    --ehtw-ct3: #e78c1a;
    --ehtw-ct4: #c7bf07;
    --ehtw-ct5: #1a9317;
    --ehtw-ct6: #2756aa;
    --ehtw-ct7: #8800c3;
    --ehtw-ct8: #b452a5;
    --ehtw-ct9: #0f9ebd;
    --ehtw-cta: #5dc13b;
}

html.ehtw-enabled .cn.ct1,
html.ehtw-enabled .cs.ct1,
html.ehtw-enabled .ehtw-avatar.ct1 {
    --ehtw-flat-category: var(--ehtw-ct1);
}

html.ehtw-enabled .cn.ct2,
html.ehtw-enabled .cs.ct2,
html.ehtw-enabled .ehtw-avatar.ct2 {
    --ehtw-flat-category: var(--ehtw-ct2);
}

html.ehtw-enabled .cn.ct3,
html.ehtw-enabled .cs.ct3,
html.ehtw-enabled .ehtw-avatar.ct3 {
    --ehtw-flat-category: var(--ehtw-ct3);
}

html.ehtw-enabled .cn.ct4,
html.ehtw-enabled .cs.ct4,
html.ehtw-enabled .ehtw-avatar.ct4 {
    --ehtw-flat-category: var(--ehtw-ct4);
}

html.ehtw-enabled .cn.ct5,
html.ehtw-enabled .cs.ct5,
html.ehtw-enabled .ehtw-avatar.ct5 {
    --ehtw-flat-category: var(--ehtw-ct5);
}

html.ehtw-enabled .cn.ct6,
html.ehtw-enabled .cs.ct6,
html.ehtw-enabled .ehtw-avatar.ct6 {
    --ehtw-flat-category: var(--ehtw-ct6);
}

html.ehtw-enabled .cn.ct7,
html.ehtw-enabled .cs.ct7,
html.ehtw-enabled .ehtw-avatar.ct7 {
    --ehtw-flat-category: var(--ehtw-ct7);
}

html.ehtw-enabled .cn.ct8,
html.ehtw-enabled .cs.ct8,
html.ehtw-enabled .ehtw-avatar.ct8 {
    --ehtw-flat-category: var(--ehtw-ct8);
}

html.ehtw-enabled .cn.ct9,
html.ehtw-enabled .cs.ct9,
html.ehtw-enabled .ehtw-avatar.ct9 {
    --ehtw-flat-category: var(--ehtw-ct9);
}

html.ehtw-enabled .cn.cta,
html.ehtw-enabled .cs.cta,
html.ehtw-enabled .ehtw-avatar.cta {
    --ehtw-flat-category: var(--ehtw-cta);
}

html.ehtw-enabled .cn[class*="ct"],
html.ehtw-enabled .cs[class*="ct"],
html.ehtw-enabled .ehtw-avatar[class*="ct"] {
    background-color: var(--ehtw-flat-category, #707070) !important;
    background-image: none !important;
    border: 0 !important;
    box-shadow: none !important;
    color: var(--ehtw-category-text) !important;
}

html.ehtw-enabled .ehtw-avatar[class*="ct"] {
    border-radius: 50% !important;
}

html.ehtw-list .ehtw-tweet-author
.cn[class*="ct"] {
    background: transparent !important;
    background-image: none !important;
    border: none !important;
    box-shadow: none !important;
    color: var(--ehtw-muted) !important;
}

html.ehtw-enabled #ehtw-search-card .cn[class*="ct"],
html.ehtw-enabled #ehtw-search-card .cs[class*="ct"],
html.ehtw-enabled #ehtw-mobile-search .cn[class*="ct"],
html.ehtw-enabled #ehtw-mobile-search .cs[class*="ct"] {
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    padding: 4px 9px !important;
    border-radius: 9999px !important;
    color: #ffffff !important;
    font-size: 13px !important;
    line-height: 20px !important;
    box-shadow: none !important;
}

html.ehtw-enabled .cn[data-disabled],
html.ehtw-enabled .cs[data-disabled],
html.ehtw-enabled .cn[data-disabled="1"],
html.ehtw-enabled .cs[data-disabled="1"],
html.ehtw-enabled .cn[data-disabled="true"],
html.ehtw-enabled .cs[data-disabled="true"] {
    opacity: 0.4 !important;
}

/* ============================================================
   A1. 搜索结果数量
   ============================================================ */

html.ehtw-list #ehtw-center .ehtw-results-count {
    display: block !important;
    min-width: 0 !important;
    width: 100% !important;
    padding: 10px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    text-align: left !important;
}

html.ehtw-list #ehtw-center .ehtw-results-count .searchtext {
    display: block !important;
    position: static !important;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    text-align: left !important;
}

/* ============================================================
   A2 / C7. 统一上下文头部
   ============================================================ */

html.ehtw-enabled #ehtw-header {
    display: flex;
    align-items: center;
    min-height: 53px !important;
    height: 53px !important;
    max-height: 53px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: var(--ehtw-glass) !important;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
}

html.ehtw-enabled #ehtw-header.ehtw-tabs-header {
    display: grid !important;
    padding: 0 !important;
}

/* 1.17.261: phone header / bottom nav hide while scrolling down.
   1.17.263: the header is hidden at once (no slide) so iOS Safari stops
   tinting the status bar with it; visibility keeps its layout space so the
   page does not jump. */
@media (max-width: 699px) {
    /* 1.17.264: also drop out of sticky, so the (scrolled-away) header no
       longer sits at the top edge where Safari samples its tint colour.
       Sticky and relative take the same flow space, so nothing jumps. */
    html.ehtw-enabled.ehtw-chrome-scroll-hidden:not(.ehtw-reader) #ehtw-header {
        position: relative !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }

    /* 1.17.262: the bottom nav disappears at once instead of sliding. */
    html.ehtw-enabled.ehtw-chrome-scroll-hidden:not(.ehtw-reader) #ehtw-left {
        display: none !important;
    }
}

html.ehtw-enabled #ehtw-header.ehtw-context-header {
    display: flex !important;
    gap: 20px !important;
    padding: 0 16px !important;
}

html.ehtw-enabled #ehtw-header .ehtw-back-link {
    display: flex !important;
    flex: 0 0 34px;
    align-items: center;
    justify-content: center;
    width: 34px !important;
    height: 34px !important;
    min-width: 34px !important;
    min-height: 34px !important;
    margin: 0 !important;
    padding: 0 !important;
    border-radius: 50% !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-enabled #ehtw-header .ehtw-back-link:hover {
    background: var(--ehtw-nav-hover) !important;
}

html.ehtw-enabled #ehtw-header .ehtw-context-heading {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    max-width: 100%;
    height: 100%;
    text-align: left;
}

html.ehtw-enabled #ehtw-header .ehtw-context-title {
    display: block !important;
    width: 100%;
    min-width: 0;
    margin: 0 !important;
    padding: 0 !important;
    color: var(--ehtw-text) !important;
    font-size: 20px !important;
    font-weight: 700 !important;
    line-height: 24px !important;
    text-align: left !important;
    white-space: nowrap !important;
    overflow: hidden;
    text-overflow: ellipsis;
}

html.ehtw-enabled #ehtw-header .ehtw-context-subtitle {
    display: block;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    line-height: 16px !important;
    text-align: left !important;
}

html.ehtw-list #ehtw-center:has(.ehtw-context-header)
.ehtw-composer {
    display: none !important;
}

/* ============================================================
   A3. 转发状态
   ============================================================ */

html.ehtw-list .ehtw-twitter-action-repost
.ehtw-repost-native {
    cursor: pointer;
}

html.ehtw-list .ehtw-twitter-action-repost
.ehtw-repost-native a {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 2;
}

html.ehtw-list .ehtw-twitter-action-repost
.ehtw-repost-native a img {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    opacity: 0 !important;
    cursor: pointer;
}

html.ehtw-list .ehtw-repost-available:hover,
html.ehtw-list .ehtw-repost-available:hover svg {
    color: #00ba7c !important;
}

html.ehtw-list .ehtw-repost-available:hover
.ehtw-twitter-action-icon {
    background: rgba(0, 186, 124, 0.1) !important;
}

html.ehtw-list .ehtw-repost-unavailable,
html.ehtw-list .ehtw-repost-unavailable:hover,
html.ehtw-list .ehtw-repost-unavailable svg,
html.ehtw-list .ehtw-repost-unavailable:hover svg {
    color: var(--ehtw-muted) !important;
    cursor: default !important;
}

html.ehtw-list .ehtw-repost-unavailable
.ehtw-twitter-action-icon {
    opacity: 0.35 !important;
}

html.ehtw-list .ehtw-repost-unavailable:hover
.ehtw-twitter-action-icon {
    background: transparent !important;
}

/* ============================================================
   A5. 详情页统计及回复数
   ============================================================ */

html.ehtw-detail .ehtw-detail-stats {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 8px 16px !important;
    padding: 12px 0 !important;
}

html.ehtw-detail .ehtw-detail-stat {
    display: inline-flex !important;
    align-items: baseline !important;
    gap: 4px !important;
    font-size: 15px !important;
    white-space: nowrap;
}

html.ehtw-detail .ehtw-detail-reply-count {
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    margin: 10px 0 !important;
    padding: 4px 8px 4px 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-detail-reply-count svg {
    width: 19px !important;
    height: 19px !important;
}

html.ehtw-detail .ehtw-detail-reply-count:hover {
    color: var(--ehtw-accent) !important;
}

/* ============================================================
   B1. Generic 页面基础
   ============================================================ */

html.ehtw-generic body {
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-generic #ehtw-center {
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-generic .ehtw-generic-content {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 0 16px !important;
    color: var(--ehtw-text) !important;
    overflow-wrap: anywhere;
}

html.ehtw-generic .ehtw-generic-content
:is(div.ido, .dc, #newsouter, #newsinner, #nt, .d) {
    min-width: 0 !important;
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    background: none !important;
    background-image: none !important;
    border: 0 !important;
    margin: 0 !important;
}

html.ehtw-generic .ehtw-generic-content
:is(table, tr, td, th) {
    max-width: 100% !important;
    background: transparent !important;
    background-image: none !important;
    border-color: var(--ehtw-border) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-generic .ehtw-generic-content a {
    color: var(--ehtw-accent) !important;
}

html.ehtw-generic .ehtw-generic-content h1 {
    display: none !important;
}

html.ehtw-generic .ehtw-generic-content h2 {
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
    padding: 12px 16px !important;
    margin: 0 !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-generic .ehtw-generic-content
:is(
    input[type="text"],
    input[type="password"],
    input[type="number"],
    textarea,
    select
) {
    box-sizing: border-box !important;
    max-width: 100% !important;
    min-height: 40px !important;
    height: 40px !important;
    padding: 0 16px !important;
    margin: 4px 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    outline: none !important;
    box-shadow: none !important;
}

html.ehtw-generic .ehtw-generic-content textarea {
    min-height: 110px !important;
    height: auto !important;
    padding: 12px 16px !important;
    border-radius: 16px !important;
}

html.ehtw-generic .ehtw-generic-content
:is(
    input[type="text"],
    input[type="password"],
    input[type="number"],
    textarea,
    select
):focus {
    border-color: var(--ehtw-accent) !important;
}

html.ehtw-generic .ehtw-generic-content
input::placeholder,
html.ehtw-generic .ehtw-generic-content
textarea::placeholder {
    color: var(--ehtw-muted) !important;
    opacity: 1 !important;
}

/* ============================================================
   B2. Torrents
   ============================================================ */

html.ehtw-generic .ehtw-generic-content #torrentform {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    padding: 12px 0 !important;
    border: none !important;
    background: transparent !important;
}

html.ehtw-generic #torrentform p a {
    display: inline-flex !important;
    align-items: center !important;
    min-height: 28px !important;
    padding: 4px 10px !important;
    margin: 2px 4px 2px 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    font-size: 13px !important;
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

html.ehtw-generic #torrentform p a:hover {
    background: var(--ehtw-nav-hover) !important;
}

html.ehtw-generic #torrentform #focusme {
    width: 100% !important;
    max-width: 100% !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg,
html.ehtw-generic .ehtw-generic-content
table.itg > tbody {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    table-layout: auto !important;
    border: 0 !important;
    border-collapse: collapse !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: baseline !important;
    gap: 4px 12px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 12px 16px !important;
    border: 0 !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd):hover {
    background: var(--ehtw-hover) !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg td.itd {
    display: block !important;
    position: static !important;
    float: none !important;
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    line-height: 18px !important;
    text-align: left !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(2) {
    flex: 0 0 100% !important;
    order: -1 !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(2) a {
    display: block !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(3) a {
    color: var(--ehtw-accent) !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(4)::before {
    content: "Size ";
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(5)::before {
    content: "Seeds ";
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(6)::before {
    content: "Peers ";
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(7)::before {
    content: "DLs ";
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(8) {
    margin-left: auto !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) {
    display: flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 12px !important;
    width: 100% !important;
    padding: 8px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th {
    display: block !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 18px !important;
}

/* ============================================================
   B3. Toplists
   ============================================================ */

html.ehtw-generic .ehtw-generic-content .dc:has(.tdo) {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    align-items: start !important;
    gap: 16px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 16px !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content .dc:has(.tdo) > h2 {
    grid-column: 1 / -1 !important;
    padding: 0 !important;
    margin: 0 !important;
}

html.ehtw-generic .ehtw-generic-content .tdo {
    display: block !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
    box-shadow: none !important;
    overflow: hidden !important;
}

html.ehtw-generic .ehtw-generic-content .tdo > p {
    margin: 0 !important;
    padding: 12px 16px !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
}

html.ehtw-generic .ehtw-generic-content .tdo img.mr {
    display: none !important;
}

html.ehtw-generic .ehtw-generic-content .tdo table.ttl,
html.ehtw-generic .ehtw-generic-content .tdo table.ttl > tbody {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    border: 0 !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content .tdo table.ttl tr {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    padding: 8px 16px !important;
    border: none !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content .tdo table.ttl tr:hover {
    background: var(--ehtw-nav-hover) !important;
}

html.ehtw-generic .ehtw-generic-content .tdo table.ttl td {
    display: block !important;
    min-width: 0 !important;
    width: auto !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
}

html.ehtw-generic .ehtw-generic-content .tdo table.ttl td.pso {
    flex: 0 0 28px !important;
    width: 28px !important;
    max-width: 28px !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

html.ehtw-generic .ehtw-generic-content .tdo .tun {
    display: block !important;
    min-width: 0 !important;
    max-width: 100% !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}

/* ============================================================
   B4. News
   ============================================================ */

html.ehtw-generic #newsouter .baredge,
html.ehtw-generic #newsouter #botm,
html.ehtw-generic #newsouter .bartop {
    display: none !important;
}

html.ehtw-generic #newsouter,
html.ehtw-generic #newsinner,
html.ehtw-generic #nt,
html.ehtw-generic #nt > tbody,
html.ehtw-generic #nt tr,
html.ehtw-generic #nt td {
    display: block !important;
    position: static !important;
    float: none !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
}

html.ehtw-generic #newsouter .nwo {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    padding: 12px 16px !important;
    margin: 0 !important;
    border: none !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
}

html.ehtw-generic #newsouter .nwo h2 {
    padding: 0 0 8px !important;
    margin: 0 !important;
    font-size: 17px !important;
    font-weight: 700 !important;
    line-height: 24px !important;
}

html.ehtw-generic #newsouter .nwo h2 a {
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

html.ehtw-generic #newsouter .nwo h2 a:hover {
    text-decoration: underline !important;
}

html.ehtw-generic #newsouter .nwi {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
    border: none !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

/* 不覆盖 .nwi 内部带内联颜色的文字。 */

/* ============================================================
   B5. Watched 空状态
   ============================================================ */

html.ehtw-generic .ehtw-generic-content.ehtw-generic-empty {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 200px !important;
    padding: 32px 16px !important;
    text-align: center !important;
}

html.ehtw-generic .ehtw-generic-empty
:is(h2, strong) {
    display: block !important;
    color: var(--ehtw-text) !important;
    font-size: 20px !important;
    font-weight: 700 !important;
    line-height: 26px !important;
    text-align: center !important;
}

html.ehtw-generic .ehtw-generic-empty
:is(p, div:not(.ido), span) {
    color: var(--ehtw-muted) !important;
    font-size: 15px !important;
    line-height: 22px !important;
    text-align: center !important;
}

/* ============================================================
   B6. 登录页：仅 CSS，不访问表单数据
   ============================================================ */

html.ehtw-login {
    --ehtw-bg: #ffffff;
    --ehtw-text: #0f1419;
    --ehtw-muted: #536471;
    --ehtw-border: #eff3f4;
    --ehtw-accent: #1d9bf0;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
    font-family:
        TwitterChirp,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        Helvetica,
        Arial,
        sans-serif !important;
}

html.ehtw-login body {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 100vh !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 16px 0 !important;
    background: var(--ehtw-bg) !important;
    background-image: none !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-login body > .d {
    display: block !important;
    position: static !important;
    float: none !important;
    width: 400px !important;
    min-width: 0 !important;
    max-width: calc(100% - 32px) !important;
    height: auto !important;
    margin: 0 auto !important;
    padding: 32px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    text-align: left !important;
}

html.ehtw-login body > .d p {
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: 22px !important;
    text-align: left !important;
}

html.ehtw-login form[name="ipb_login_form"],
html.ehtw-login form[name="ipb_login_form"] table,
html.ehtw-login form[name="ipb_login_form"] tbody,
html.ehtw-login form[name="ipb_login_form"] tr,
html.ehtw-login form[name="ipb_login_form"] td {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    background: transparent !important;
    border: none !important;
    color: var(--ehtw-text) !important;
    text-align: left !important;
}

html.ehtw-login form[name="ipb_login_form"] table,
html.ehtw-login form[name="ipb_login_form"] tbody,
html.ehtw-login form[name="ipb_login_form"] tr,
html.ehtw-login form[name="ipb_login_form"] td {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
}

html.ehtw-login
:is(input[type="text"], input[type="password"]) {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 40px !important;
    min-height: 40px !important;
    margin: 6px 0 14px !important;
    padding: 0 16px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    outline: none !important;
    box-shadow: none !important;
}

html.ehtw-login
:is(input[type="text"], input[type="password"]):focus {
    border-color: var(--ehtw-accent) !important;
}

html.ehtw-login input::placeholder {
    color: var(--ehtw-muted) !important;
    opacity: 1 !important;
}

html.ehtw-login input[type="submit"] {
    width: 100% !important;
    margin: 8px 0 0 !important;
}

html.ehtw-login a {
    color: var(--ehtw-accent) !important;
}

/* ============================================================
   C4. 非推文模式视觉统一
   ============================================================ */

html.ehtw-other .ehtw-other-content .itg.gld .gl1t {
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
}

html.ehtw-other .ehtw-other-content .itg.gld .gl3t {
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
}

html.ehtw-other .ehtw-other-content
:is(.gl3t, .gl3m, .gl4e) .glink,
html.ehtw-other .ehtw-other-content
.glink {
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-other .ehtw-other-content
:is(table.itg.glte, table.itg.gltm)
:is(.gt, .gtl, .gtw) {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    color: var(--ehtw-accent) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    white-space: normal !important;
}

html.ehtw-other .ehtw-other-content
:is(table.itg.glte, table.itg.gltm)
:is(.gt, .gtl, .gtw)::before {
    content: "#" !important;
}

html.ehtw-other .ehtw-other-content
:is(table.itg.glte, table.itg.gltm)
:is(.gt, .gtl, .gtw) a {
    color: var(--ehtw-accent) !important;
    font-weight: 400 !important;
    text-decoration: none !important;
}

html.ehtw-other .ehtw-other-content
:is(table.itg.glte, table.itg.gltm)
:is(.gt, .gtl, .gtw) a:hover {
    text-decoration: underline !important;
}

html.ehtw-other .ehtw-other-content
:is(table.itg.glte, table.itg.gltm) .tc {
    display: none !important;
}

html.ehtw-other .ehtw-other-content
table.itg.glte .gl3e > .cn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: auto !important;
    height: 20px !important;
    min-height: 20px !important;
    max-height: 20px !important;
    padding: 0 8px !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 9999px !important;
    font-size: 12px !important;
    line-height: 20px !important;
}

html.ehtw-other .ehtw-other-content
table.itg.gltm th {
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
}

html.ehtw-other .ehtw-other-content
table.itg.gltm tr:hover,
html.ehtw-other .ehtw-other-content
table.itg.glte tr:hover {
    background: var(--ehtw-hover) !important;
}

html.ehtw-other .ehtw-other-content
:is(.gt, .gtl, .gtw)[style*="background"] {
    background: transparent !important;
    background-image: none !important;
}

/* ============================================================
   C5. 全站 ptt / ptb 胶囊分页
   ============================================================ */

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb),
html.ehtw-generic .ehtw-generic-content
:is(table.ptt, table.ptb) {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 8px 0 !important;
    padding: 0 !important;
    border: none !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
    background: transparent !important;
    background-image: none !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) > tbody,
html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) tr {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 6px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    background: transparent !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 32px !important;
    max-width: 100% !important;
    height: 32px !important;
    min-height: 32px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 9999px !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-text) !important;
    font-size: 12px !important;
    text-align: center !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td a {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-width: 32px !important;
    min-height: 32px !important;
    padding: 0 11px !important;
    border: 0 !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 12px !important;
    text-decoration: none !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td a:hover {
    background: var(--ehtw-nav-hover) !important;
    color: var(--ehtw-accent) !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td.ptds {
    background: var(--ehtw-accent) !important;
    color: #ffffff !important;
    font-weight: 700 !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td.ptds a {
    background: var(--ehtw-accent) !important;
    color: #ffffff !important;
}

html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td.ptdd,
html.ehtw-enabled #ehtw-center
:is(table.ptt, table.ptb) td.ptdd a {
    background: transparent !important;
    color: var(--ehtw-muted) !important;
}

html.ehtw-enabled #ehtw-center
.ehtw-pagination:not(.ehtw-top-toolbar) .searchnav a,
html.ehtw-enabled #ehtw-center
.ehtw-pagination:not(.ehtw-top-toolbar) .searchnav select {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 32px !important;
    padding: 0 11px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 12px !important;
}

html.ehtw-enabled #ehtw-center
.ehtw-pagination:not(.ehtw-top-toolbar) .searchnav a:hover {
    background: var(--ehtw-nav-hover) !important;
}

/* ============================================================
   C6. 评论分数 / Uploader Comment
   ============================================================ */

html.ehtw-detail .ehtw-comments-section #cdiv
.c1.ehtw-comment-tweet .c2 {
    overflow: visible !important;
    background: transparent !important;
    border: none !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv
.c1.ehtw-comment-tweet .c3 {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    background: none !important;
    background-image: none !important;
    overflow: visible !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv
.c1.ehtw-comment-tweet .c4 {
    position: static !important;
    float: none !important;
    flex: 0 0 auto !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 0 0 auto !important;
    padding: 0 !important;
    overflow: visible !important;
    text-align: right !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
}

html.ehtw-detail .ehtw-comments-section #cdiv
.c1.ehtw-comment-tweet .c4 *,
html.ehtw-detail .ehtw-comments-section #cdiv
.c1.ehtw-comment-tweet .c3 .c {
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
}

/* ============================================================
   通用页面窄屏
   ============================================================ */

@media (max-width: 699px) {
    html.ehtw-generic .ehtw-generic-content {
        padding: 0 12px !important;
    }

    html.ehtw-generic .ehtw-generic-content
    .dc:has(.tdo) {
        grid-template-columns: minmax(0, 1fr) !important;
        padding: 12px !important;
    }

    html.ehtw-generic .ehtw-generic-content
    .dc:has(.tdo) > h2 {
        grid-column: 1 !important;
    }

    html.ehtw-generic .ehtw-generic-content
    table.itg tr:has(> td.itd) {
        padding: 12px 8px !important;
    }

    html.ehtw-enabled #ehtw-header.ehtw-context-header {
        padding: 0 12px !important;
        gap: 12px !important;
    }
}
/* ============================================================
   1.4.0 功能回归：body > .ido 空壳
   ============================================================ */

html.ehtw-enabled body > .ido {
    display: block !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    overflow: hidden !important;
}

/* ============================================================
   1.4.0 Filters：文件搜索面板和日期范围条
   ============================================================ */

html.ehtw-enabled #searchbox.ehtw-filters-collapsed:not(.ehtw-filters-open)
:is(#fsdiv, #rangebar) {
    display: none !important;
}

html.ehtw-enabled #searchbox.ehtw-filters-open #fsdiv {
    display: block !important;
    position: static !important;
    float: none !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 8px 0 !important;
    padding: 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-text) !important;
    overflow: visible !important;
    text-align: left !important;
}

html.ehtw-enabled #searchbox #fsdiv
:is(input[type="text"], input[type="number"], select) {
    max-width: 100% !important;
    min-height: 36px !important;
    padding: 0 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 13px !important;
}

html.ehtw-enabled #searchbox #fsdiv
:is(input[type="text"], input[type="number"], select):focus {
    border-color: var(--ehtw-accent) !important;
    outline: none !important;
}

html.ehtw-enabled #searchbox.ehtw-filters-open #rangebar {
    display: flex !important;
    position: static !important;
    float: none !important;
    flex-direction: row !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
    gap: 2px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 16px !important;
    min-height: 16px !important;
    margin: 8px 0 !important;
    padding: 4px 0 !important;
    border: 0 !important;
    background: transparent !important;
    overflow: hidden !important;
}

html.ehtw-enabled #searchbox #rangebar > a {
    display: block !important;
    position: static !important;
    float: none !important;
    flex: 1 1 0 !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: 8px !important;
    min-height: 8px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    text-decoration: none !important;
}

html.ehtw-enabled #searchbox #rangebar > a > div {
    display: block !important;
    position: static !important;
    width: 100% !important;
    height: 8px !important;
    min-height: 8px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 2px !important;
    background: var(--ehtw-border) !important;
    box-shadow: none !important;
}

html.ehtw-enabled #searchbox #rangebar
[data-inrange]:not([data-inrange="0"]):not([data-inrange="false"]) {
    background: var(--ehtw-accent) !important;
}

html.ehtw-enabled #searchbox #rangebar > a:hover > div {
    filter: brightness(1.2);
}

/* ============================================================
   1.4.0 无原站搜索框页面：右栏 GET 搜索
   ============================================================ */

html.ehtw-enabled #ehtw-right .ehtw-right-search {
    order: 0 !important;
    display: block !important;
    position: sticky !important;
    top: 0 !important;
    z-index: 110 !important;
    flex: none !important;
    width: 350px !important;
    min-width: 0 !important;
    max-width: 350px !important;
    min-height: 52px !important;
    margin: 0 !important;
    padding: 7px 0 8px !important;
    border: none !important;
    background: var(--ehtw-bg) !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search-form,
html.ehtw-enabled #ehtw-right .ehtw-right-search-wrap {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search-input {
    display: block !important;
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    margin: 0 !important;
    padding: 0 12px 0 36px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: normal !important;
    box-shadow: none !important;
    outline: none !important;
    appearance: none !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search-input:focus {
    border-color: var(--ehtw-accent) !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search-input::placeholder {
    color: var(--ehtw-muted) !important;
    opacity: 1 !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search-icon {
    position: absolute !important;
    top: 50% !important;
    left: 14px !important;
    z-index: 1 !important;
    width: 16px !important;
    height: 16px !important;
    transform: translateY(-50%) !important;
    color: var(--ehtw-muted) !important;
    pointer-events: none !important;
}

html.ehtw-enabled #ehtw-right .ehtw-right-search
+ .ehtw-side-card {
    margin-top: 8px !important;
}

/* ============================================================
   1.4.0 /popular：底部模式切换工具栏
   ============================================================ */

html.ehtw-list #ehtw-center
.ehtw-timeline > .ehtw-list-bottom-toolbar {
    display: flex !important;
    position: static !important;
    float: none !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 6px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 40px !important;
    margin: 8px 0 !important;
    padding: 8px 16px !important;
    border: none !important;
    background: transparent !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    text-align: left !important;
}

html.ehtw-list #ehtw-center
.ehtw-list-bottom-toolbar select {
    display: inline-block !important;
    width: auto !important;
    height: 32px !important;
    min-height: 32px !important;
    margin: 0 !important;
    padding: 0 10px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 13px !important;
}

/* ============================================================
   1.4.0 标签浮动归零，媒体不得环绕标签
   ============================================================ */

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags {
    display: block !important;
    position: static !important;
    float: none !important;
    clear: both !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    line-height: 20px !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags
:is(.gt, .gtl, .gtw) {
    display: inline !important;
    position: static !important;
    float: none !important;
    clear: none !important;
    width: auto !important;
    height: auto !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    vertical-align: baseline !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags
:is(.gt, .gtl, .gtw) a {
    display: inline !important;
    float: none !important;
    color: var(--ehtw-accent) !important;
    font-size: 15px !important;
    line-height: 20px !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-media {
    display: block !important;
    position: relative !important;
    float: none !important;
    clear: both !important;
    margin-top: 12px !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
}

/* ============================================================
   1.4.0 登录页深色变量：覆盖先前浅色固定值
   ============================================================ */

@media (prefers-color-scheme: dark) {
    html.ehtw-login {
        --ehtw-bg: #000000;
        --ehtw-text: #e7e9ea;
        --ehtw-muted: #71767b;
        --ehtw-border: #2f3336;
        --ehtw-accent: #1d9bf0;
        --ehtw-primary-button-bg: #eff3f4;
        --ehtw-primary-button-text: #0f1419;
        color-scheme: dark;
    }

    html.ehtw-login body,
    html.ehtw-login body > .d,
    html.ehtw-login form[name="ipb_login_form"],
    html.ehtw-login form[name="ipb_login_form"] table,
    html.ehtw-login form[name="ipb_login_form"] td {
        background: var(--ehtw-bg) !important;
        background-image: none !important;
        color: var(--ehtw-text) !important;
    }

    html.ehtw-login body > .d {
        border-color: var(--ehtw-border) !important;
    }

    html.ehtw-login label,
    html.ehtw-login form[name="ipb_login_form"] td,
    html.ehtw-login form[name="ipb_login_form"] p {
        color: var(--ehtw-text) !important;
    }

    html.ehtw-login
    :is(input[type="text"], input[type="password"]) {
        background: transparent !important;
        border-color: var(--ehtw-border) !important;
        color: var(--ehtw-text) !important;
    }

    html.ehtw-login
    :is(input[type="text"], input[type="password"]):focus {
        border-color: var(--ehtw-accent) !important;
    }

    html.ehtw-login input::placeholder {
        color: var(--ehtw-muted) !important;
    }
}

/* ============================================================
   1.4.0 Torrents：标题、元数据、左对齐
   ============================================================ */

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(2) {
    flex: 0 0 100% !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    min-height: 20px !important;
    height: auto !important;
    line-height: 20px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(2) div {
    display: inline !important;
    position: static !important;
    float: none !important;
    width: auto !important;
    height: auto !important;
    min-height: 20px !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    line-height: 20px !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(2) a {
    display: inline !important;
    height: auto !important;
    min-height: 20px !important;
    max-height: none !important;
    line-height: 20px !important;
    vertical-align: baseline !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> td.itd) > td:nth-child(8) {
    margin-left: 0 !important;
}

html.ehtw-generic .ehtw-generic-content #torrentform,
html.ehtw-generic .ehtw-generic-content #torrentform * {
    text-align: left !important;
}

html.ehtw-generic .ehtw-generic-content #torrentform {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 12px 16px !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform p {
    margin: 8px 0 !important;
    padding: 0 !important;
    text-align: left !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform p a,
html.ehtw-generic .ehtw-generic-content
#torrentform p span {
    display: inline-flex !important;
    align-items: center !important;
    min-height: 28px !important;
    margin: 2px 4px 2px 0 !important;
    padding: 4px 10px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 9999px !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    font-size: 13px !important;
    line-height: 18px !important;
    text-decoration: none !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform p span {
    font-weight: 700 !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform input[type="button"]:not([value="Clear"]),
html.ehtw-generic .ehtw-generic-content
#torrentform input[type="submit"] {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    height: 36px !important;
    min-height: 36px !important;
    padding: 0 16px !important;
    border: 0 !important;
    border-radius: 9999px !important;
    background: var(--ehtw-primary-button-bg) !important;
    color: var(--ehtw-primary-button-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform input[type="button"][value="Clear"] {
    border: 1px solid var(--ehtw-secondary-button-border) !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-generic .ehtw-generic-content
#torrentform input::placeholder {
    color: var(--ehtw-muted) !important;
    opacity: 1 !important;
}

html.ehtw-generic .ehtw-generic-content p.ip {
    margin: 8px 0 !important;
    padding: 0 16px !important;
    text-align: left !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    line-height: 18px !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th a {
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
    text-decoration: none !important;
}

html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th a:hover,
html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th a[aria-current],
html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th a[style*="font-weight: bold"],
html.ehtw-generic .ehtw-generic-content
table.itg tr:has(> th) th a[style*="font-weight:bold"] {
    color: var(--ehtw-text) !important;
}

/* ============================================================
   1.4.0 Toplists：600px 中栏单列卡片
   ============================================================ */

html.ehtw-generic .ehtw-generic-content
.dc:has(.tdo) {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    align-items: start !important;
    gap: 16px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding: 16px !important;
}

html.ehtw-generic .ehtw-generic-content
.dc:has(.tdo) > h2 {
    grid-column: 1 !important;
    margin: 0 !important;
    padding: 0 0 12px !important;
    color: var(--ehtw-text) !important;
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
}

html.ehtw-generic .ehtw-generic-content .tdo {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 0 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: transparent !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo > p {
    margin: 0 !important;
    padding: 12px 16px !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo > p a {
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    text-decoration: none !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo > p a:hover {
    text-decoration: underline !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl tr {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 4px 16px !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl td.pso {
    display: block !important;
    flex: 0 0 36px !important;
    width: 36px !important;
    min-width: 36px !important;
    max-width: 36px !important;
    margin: 0 !important;
    padding: 0 8px 0 0 !important;
    white-space: nowrap !important;
    overflow: visible !important;
    text-align: left !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl tr > td:nth-child(2) {
    display: block !important;
    flex: 1 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl .tun {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl a {
    color: var(--ehtw-text) !important;
    font-weight: 400 !important;
    text-decoration: none !important;
}

html.ehtw-generic .ehtw-generic-content
.tdo table.ttl a:hover {
    text-decoration: underline !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo img.ehtw-gallery-toplist-cover {
    display: block !important;
    flex: 0 0 44px !important;
    width: 44px !important;
    height: 60px !important;
    max-width: 44px !important;
    object-fit: cover !important;
    border-radius: 4px !important;
    background: var(--ehtw-surface) !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo .tun {
    display: block !important;
    width: 100% !important;
    height: auto !important;
    min-height: 60px !important;
    overflow: visible !important;
    white-space: normal !important;
    text-overflow: clip !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo .tun > a {
    display: grid !important;
    grid-template-columns: 44px minmax(0, 1fr) !important;
    align-items: center !important;
    gap: 10px !important;
    min-width: 0 !important;
    width: 100% !important;
    min-height: 60px !important;
    white-space: normal !important;
    overflow: visible !important;
    line-height: 18px !important;
    box-sizing: border-box !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo tr.ehtw-gallery-toplist-hidden {
    display: none !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo table tr {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
    min-height: 60px !important;
    padding: 4px 16px !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo table tr > td {
    display: block !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo table tr > td.pso {
    flex: 0 0 36px !important;
    width: 36px !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    text-align: left !important;
}

html.ehtw-generic .ehtw-gallery-toplists .tdo table tr > td:not(.pso) {
    flex: 1 1 auto !important;
    width: auto !important;
}

html.ehtw-generic #ehtw-center .ehtw-gallery-toplists .tdo .pso {
    display: block !important;
    flex: 0 0 36px !important;
    width: 36px !important;
    min-width: 36px !important;
    margin: 0 !important;
    padding: 0 8px 0 0 !important;
    white-space: nowrap !important;
    text-align: left !important;
}

html.ehtw-other .ehtw-other-content .gl3c.ehtw-hidden-tag-gallery {
    display: none !important;
}

/* 列表内容使用主文字色，强调色保留给操作入口和标签。 */

html.ehtw-generic .ehtw-generic-content
:is(.tun, .nwo, .nwi, .tdo, table.itg) a:not(.ehtw-hashtag) {
    color: var(--ehtw-text) !important;
}

html.ehtw-generic .ehtw-generic-content
:is(.tun, .nwo, .nwi, .tdo, table.itg) a:not(.ehtw-hashtag):hover {
    text-decoration: underline !important;
}

/* ============================================================
   1.4.0 About / Gallery actions：标题紧接内容
   ============================================================ */

html.ehtw-detail #ehtw-right
:is(.ehtw-about-card, .ehtw-operation-card)
.ehtw-side-title {
    margin: 0 !important;
    padding: 12px 16px !important;
    border: 0 !important;
    font-size: 20px !important;
    font-weight: 800 !important;
    line-height: 24px !important;
}

html.ehtw-detail #ehtw-right
.ehtw-about-card #gdd,
html.ehtw-detail #ehtw-right
.ehtw-operation-card #gd5 {
    margin: 0 !important;
    padding: 0 16px 12px !important;
    border: 0 !important;
    background: transparent !important;
}

html.ehtw-detail #ehtw-right
.ehtw-about-card #gdd > :first-child,
html.ehtw-detail #ehtw-right
.ehtw-operation-card #gd5 > :first-child {
    margin-top: 0 !important;
}

html.ehtw-detail #ehtw-right
.ehtw-about-card #gdd tr:first-child td {
    padding-top: 0 !important;
}

/* ============================================================
   1.4.0 Watched 空状态
   ============================================================ */

html.ehtw-generic .ehtw-generic-empty,
html.ehtw-generic .ehtw-generic-empty
:is(p, em, i, span) {
    font-style: normal !important;
}

html.ehtw-generic .ehtw-generic-empty a {
    color: var(--ehtw-accent) !important;
    font-style: normal !important;
    text-decoration: none !important;
}

html.ehtw-generic .ehtw-generic-empty a:hover {
    text-decoration: underline !important;
}

/* ============================================================
   1.4.0 手机端新增搜索表单适配
   ============================================================ */

@media (max-width: 999px) {
    html.ehtw-enabled #ehtw-right
    .ehtw-right-search {
        display: none !important;
    }
}

@media (max-width: 699px) {
    html.ehtw-generic .ehtw-generic-content
    .dc:has(.tdo) {
        grid-template-columns: minmax(0, 1fr) !important;
        padding: 12px !important;
    }

    html.ehtw-generic .ehtw-generic-content
    .tdo table.ttl tr {
        padding: 4px 12px !important;
    }

    html.ehtw-list .ehtw-tweet .ehtw-media {
        clear: both !important;
        margin-left: 0 !important;
        max-width: 100% !important;
    }
}

/* 1.4.2 收尾：标签排版、Extended、缩略图标题、Toplists 宽度、占位文字。 */
html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags {
    display: block !important;
    max-width: 100% !important;
    overflow: hidden !important;
    white-space: normal !important;
    text-align: left !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .gt,
html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-hashtag {
    display: inline-block !important;
    max-width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    vertical-align: top !important;
    margin: 0 6px 0 0 !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .gt:nth-child(n+7),
html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-hashtag:nth-child(n+7) {
    display: none !important;
}

html.ehtw-other #ehtw-center table.itg.glte > tbody > tr > td,
html.ehtw-other #ehtw-center table.itg.glte > tbody > tr > td > div,
html.ehtw-other #ehtw-center table.itg.glte .gl4e {
    border: 0 !important;
}

html.ehtw-other #ehtw-center table.itg.glte {
    border: 0 !important;
}

html.ehtw-other #ehtw-center table.itg.glte > tbody > tr {
    border-bottom: 1px solid var(--ehtw-border) !important;
}

html.ehtw-other #ehtw-center table.itg.glte .gl4e table,
html.ehtw-other #ehtw-center table.itg.glte .gl4e tbody,
html.ehtw-other #ehtw-center table.itg.glte .gl4e tr,
html.ehtw-other #ehtw-center table.itg.glte .gl4e td {
    display: inline !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
}

html.ehtw-other #ehtw-center table.itg.glte .gl4e td.tc {
    display: none !important;
}

html.ehtw-other #ehtw-center table.itg.glte .gl4e .gt,
html.ehtw-other #ehtw-center table.itg.glte .gl4e .gtl,
html.ehtw-other #ehtw-center table.itg.glte .gl4e .gtw {
    display: inline !important;
    float: none !important;
    margin: 0 6px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    color: var(--ehtw-accent) !important;
    font-weight: 400 !important;
    white-space: nowrap !important;
}

html.ehtw-other #ehtw-center table.itg.glte td.gl1e > div {
    overflow: hidden !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
}

html.ehtw-other #ehtw-center .itg.gld .gl4t {
    height: auto !important;
    max-height: 40px !important;
    line-height: 20px !important;
    overflow: hidden !important;
    margin-bottom: 8px !important;
}

html.ehtw-other #ehtw-center .itg.gld .gl1t {
    height: auto !important;
}

html.ehtw-generic table.ttl {
    display: block !important;
    width: 100% !important;
}

html.ehtw-generic table.ttl tbody {
    display: block !important;
}

html.ehtw-generic table.ttl tr {
    width: 100% !important;
}

html.ehtw-generic table.ttl .tun,
html.ehtw-generic table.ttl .tun a {
    width: auto !important;
    max-width: 100% !important;
}

html.ehtw-enabled input::placeholder,
html.ehtw-enabled textarea::placeholder {
    color: var(--ehtw-muted) !important;
    -webkit-text-fill-color: var(--ehtw-muted) !important;
    opacity: 1 !important;
}

/* 1.5.0：评论数和收藏数；评分移到推文头部；详情页爱心是收藏数。 */
html.ehtw-list .ehtw-tweet-rating {
    flex: none;
    color: var(--ehtw-muted);
    font-size: 15px;
    line-height: 20px;
    white-space: nowrap;
}

html.ehtw-detail .ehtw-detail-favorite-action {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
}

html.ehtw-detail .ehtw-detail-favorite-count {
    color: var(--ehtw-muted);
    font-size: 13px;
    line-height: 16px;
}

html.ehtw-detail .ehtw-detail-favorite-action:hover .ehtw-detail-favorite-count {
    color: #f91880;
}
html.ehtw-detail .ehtw-detail-actions {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 32px !important;
    padding: 8px 0 !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-detail-actions .ehtw-detail-reply-count {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    order: 1;
    color: var(--ehtw-muted) !important;
    font-size: 13px;
    text-decoration: none !important;
}

html.ehtw-detail .ehtw-detail-actions .ehtw-detail-favorite-action {
    order: 2;
}

html.ehtw-detail .ehtw-detail-actions .ehtw-detail-rating-action {
    order: 3;
    margin-left: auto !important;
}

html.ehtw-detail .ehtw-detail-actions #gdr,
html.ehtw-detail .ehtw-detail-actions #gdr table {
    margin: 0 !important;
}
/* 1.5.1：手机 Safari。底栏避开安全区，内容不被底栏遮住，不自动放大文字。 */
html.ehtw-enabled {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
}

@media (max-width: 699px) {
    html.ehtw-enabled #ehtw-left {
        padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        height: auto !important;
        min-height: 0 !important;
    }

    html.ehtw-enabled #ehtw-center {
        padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
    }
    html.ehtw-other #ehtw-center .ehtw-other-content .itg.gld,
    html.ehtw-other #ehtw-center .itg.gld {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    html.ehtw-other #ehtw-center .itg.gld .gl3t {
        width: 100% !important;
        height: auto !important;
    }

    html.ehtw-other #ehtw-center .itg.gld .gl3t img {
        width: 100% !important;
        height: auto !important;
    }

    html.ehtw-other #ehtw-center .itg.gld .gl5t > div {
        gap: 2px 4px !important;
    }
}
/* 1.6.0：Thumbnail 模式也是推文。分类用 .cs，加载完成前名字先显示分类。 */
html.ehtw-list .ehtw-tweet-author .cs {
    display: inline !important;
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    text-shadow: none !important;
    white-space: nowrap;
}

html.ehtw-list .ehtw-tweet-pending .ehtw-handle,
html.ehtw-list .ehtw-tweet-pending .ehtw-category-dot,
html.ehtw-list .ehtw-tweet-pending .ehtw-tweet-author .cs {
    display: none !important;
}

html.ehtw-list .ehtw-thumb-tweet .ehtw-tags:empty {
    display: none !important;
}

html.ehtw-list .ehtw-thumb-tweet .ehtw-tags a {
    text-decoration: none !important;
}

html.ehtw-list .ehtw-thumb-tweet .ehtw-tweet-title {
    text-align: left !important;
}

html.ehtw-list #ehtw-center .ehtw-thumb-tweet .ehtw-tweet-title .gl4t {
    display: block !important;
    width: auto !important;
    height: auto !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    visibility: visible !important;
    text-align: left !important;
    line-height: 20px !important;
}

/* 头部放不下时先压缩 @handle，分类和评分保持完整。 */
html.ehtw-list #ehtw-center .ehtw-tweet-author .ehtw-author-name {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    max-width: 45% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet-author .ehtw-handle {
    flex: 0 100 auto !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet-author .cn,
html.ehtw-list #ehtw-center .ehtw-tweet-author .cs,
html.ehtw-list #ehtw-center .ehtw-tweet-author .ehtw-dot,
html.ehtw-list #ehtw-center .ehtw-tweet-author .ehtw-time,
html.ehtw-list #ehtw-center .ehtw-tweet-author .ehtw-tweet-rating {
    flex: none !important;
    max-width: none !important;
    overflow: visible !important;
}
/* 1.6.1：非推文显示模式也显示评论数和收藏数。 */
html.ehtw-other .ehtw-row-stats {
    display: inline-flex !important;
    position: static !important;
    align-items: center;
    gap: 10px;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    color: var(--ehtw-muted);
    font-size: 13px;
    line-height: 16px;
    white-space: nowrap;
}

html.ehtw-other .ehtw-row-stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

html.ehtw-other .ehtw-row-stat svg {
    width: 14px;
    height: 14px;
    flex: none;
}

html.ehtw-other #ehtw-center table.itg .gl4m {
    width: 84px !important;
    min-width: 84px !important;
    max-width: 84px !important;
    white-space: normal !important;
}

html.ehtw-other #ehtw-center table.itg .gl4m .ehtw-row-stats {
    display: flex !important;
    margin-top: 2px !important;
    gap: 8px;
}

html.ehtw-other #ehtw-center table.itg .gl2m {
    width: 1% !important;
    white-space: nowrap !important;
}
/* 1.6.2：回复和推文同一规格。 */
html.ehtw-detail .ehtw-comments-section > .ehtw-section-title {
    display: none !important;
}

html.ehtw-detail .ehtw-reply-box {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
    padding: 12px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    scroll-margin-top: 60px;
}

html.ehtw-detail .ehtw-reply-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--ehtw-avatar, #536471);
    color: #fff;
    font-size: 15px;
    font-weight: 700;
}

html.ehtw-detail .ehtw-reply-placeholder {
    justify-self: start;
    text-align: left;
    color: var(--ehtw-muted);
    font-size: 20px;
    line-height: 24px;
    padding-left: 4px;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #postnewcomment {
    display: block;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    color: transparent !important;
    font-size: 0 !important;
    line-height: 0 !important;
    text-align: right !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #postnewcomment a {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    height: 36px !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 16px !important;
    border: 0 !important;
    border-radius: 9999px !important;
    background: var(--ehtw-text) !important;
    color: transparent !important;
    font-size: 0 !important;
    line-height: 20px !important;
    text-decoration: none !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #postnewcomment a::before,
html.ehtw-detail #ehtw-center .ehtw-comments-section #postnewcomment a::after {
    content: none !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #postnewcomment a::after {
    content: 'Reply' !important;
    position: static !important;
    color: var(--ehtw-bg) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
}

html.ehtw-detail .ehtw-comments-section #formdiv {
    padding: 12px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    max-width: 100% !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet {
    display: grid !important;
    grid-template-columns: 40px minmax(0, 1fr) !important;
    column-gap: 8px !important;
    row-gap: 0 !important;
    width: auto !important;
    margin: 0 !important;
    padding: 12px 16px !important;
    border: 0 !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    border-radius: 0 !important;
    background: transparent !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet::before {
    content: none !important;
    display: none !important;
}

html.ehtw-detail #ehtw-center .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet:hover {
    background: var(--ehtw-hover) !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-avatar {
    grid-column: 1 !important;
    grid-row: 1 / span 6 !important;
    align-self: start !important;
    width: 40px !important;
    height: 40px !important;
    margin: 0 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-heading {
    grid-column: 2 !important;
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
    width: auto !important;
    min-width: 0 !important;
    height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    line-height: 20px !important;
    white-space: nowrap;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-author,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-author a {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    text-decoration: none !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-author a:hover {
    text-decoration: underline !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-handle {
    flex: 0 100 auto !important;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-handle,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-time,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-heading .ehtw-dot {
    color: var(--ehtw-muted) !important;
    font-size: 15px !important;
    font-weight: 400 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-time,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-heading .ehtw-dot {
    flex: none;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-heading .ehtw-comment-badge {
    position: static !important;
    flex: none !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    height: 18px !important;
    margin: 0 0 0 4px !important;
    padding: 0 6px !important;
    overflow: visible !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 4px !important;
    background: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 12px !important;
    font-weight: 400 !important;
    line-height: 16px !important;
    text-indent: 0 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-more {
    display: inline-flex;
    flex: none;
    align-items: center;
    margin-left: auto;
    color: var(--ehtw-muted) !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-more svg {
    width: 19px;
    height: 19px;
}

html.ehtw-detail #ehtw-center #cdiv .c1 .c2 {
    display: none !important;
}

html.ehtw-detail #ehtw-center #cdiv .c1 .c6 {
    grid-column: 2 !important;
    margin: 2px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
    color: var(--ehtw-text) !important;
    font-size: 15px !important;
    line-height: 20px !important;
    overflow-wrap: anywhere;
}

html.ehtw-detail #ehtw-center #cdiv .c1 .c6 a {
    color: var(--ehtw-accent) !important;
    text-decoration: none !important;
}

html.ehtw-detail #ehtw-center #cdiv .c1 .c7 {
    grid-column: 2 !important;
    margin: 4px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    line-height: 16px !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-actions {
    grid-column: 2 !important;
    display: flex;
    align-items: center;
    gap: 96px;
    height: 20px;
    margin-top: 12px;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ehtw-muted) !important;
    font-size: 13px;
    line-height: 16px;
    text-decoration: none !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-action svg {
    width: 18.75px;
    height: 18.75px;
    flex: none;
}

html.ehtw-detail #ehtw-center #cdiv a.ehtw-comment-action:hover {
    color: var(--ehtw-accent) !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like:hover {
    color: #f91880 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-share {
    margin-left: auto;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like .c5 {
    position: static !important;
    float: none !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    color: inherit !important;
    font-size: 0 !important;
    font-weight: 400 !important;
    cursor: pointer;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like .c5 span {
    color: inherit !important;
    font-size: 13px !important;
    line-height: 16px;
    opacity: 1 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-votes {
    position: static !important;
    float: none !important;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    color: var(--ehtw-muted) !important;
    font-size: 13px !important;
    font-weight: 400 !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-votes a {
    color: var(--ehtw-accent) !important;
    text-decoration: none !important;
}

@media (max-width: 699px) {
    html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-actions {
        gap: 56px;
    }

    html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-heading .ehtw-comment-badge {
        display: none !important;
    }
}
/* 1.6.3：操作栏只留有动作或有数据的项；标签可点击。 */
html.ehtw-list .ehtw-twitter-actions {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
}

html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views,
html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views:hover {
    cursor: default !important;
    color: var(--ehtw-muted) !important;
}

html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views:hover svg,
html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views:hover .ehtw-action-number {
    color: var(--ehtw-muted) !important;
}

html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views:hover .ehtw-twitter-action-icon,
html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views .ehtw-twitter-action-icon::before,
html.ehtw-list .ehtw-twitter-actions div.ehtw-twitter-action-views .ehtw-twitter-action-icon::after {
    background: none !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-repost-unavailable {
    visibility: hidden !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link {
    display: inline-block !important;
    max-width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    vertical-align: top !important;
    margin: 0 6px 0 0 !important;
    color: var(--ehtw-accent) !important;
    text-decoration: none !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link:hover {
    text-decoration: underline !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link > .gt,
html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link > .gtl,
html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link > .gtw {
    display: inline !important;
    margin: 0 !important;
    padding: 0 !important;
    color: inherit !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet .ehtw-tags > .ehtw-tag-link:nth-child(n+7) {
    display: none !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like .c5 {
    cursor: default !important;
}

html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like:hover {
    color: var(--ehtw-muted) !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available,
html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available .ehtw-twitter-action-icon,
html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available svg,
html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available .gldown {
    cursor: default !important;
}

html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available .gldown a,
html.ehtw-list .ehtw-twitter-actions .ehtw-repost-available .gldown img {
    cursor: pointer !important;
}
/* 1.7.1：详情页图片放进卡片，横向滑动；不再有下方的 Media 区。 */
html.ehtw-detail {
    --ehtw-strip: 240;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section {
    width: 100% !important;
    margin: 12px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-section-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 12px !important;
    width: 100% !important;
    min-width: 0 !important;
    margin: 0 0 10px !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-section-title {
    margin: 0 !important;
    color: var(--ehtw-text) !important;
    font-size: 17px !important;
    font-weight: 800 !important;
    line-height: 1.3 !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-expand-button {
    flex: 0 0 auto !important;
    min-height: 34px !important;
    padding: 6px 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 999px !important;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-accent) !important;
    font-size: 12px !important;
    cursor: pointer !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt {
    display: flex !important;
    align-items: stretch;
    gap: 4px;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: calc(var(--ehtw-strip) * 1px) !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    border: 0 !important;
    background: none !important;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt a {
    position: relative !important;
    display: block !important;
    flex: none !important;
    width: calc(var(--ehtw-strip) * 1px * var(--ehtw-w, 200) / var(--ehtw-h, 280)) !important;
    max-width: none !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 16px !important;
    background: var(--ehtw-media) !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt a > div {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    margin: 0 !important;
    transform: scale(calc(var(--ehtw-strip) / var(--ehtw-h, 280)));
    transform-origin: 0 0;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt img {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded #gdt {
    --ehtw-strip: 150;
    height: auto !important;
    min-height: 0 !important;
    flex-wrap: wrap !important;
    align-content: flex-start !important;
    overflow-x: hidden !important;
    overflow-y: visible !important;
    padding-bottom: 4px !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded #gdt a {
    height: 150px !important;
    margin-bottom: 8px !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section .ehtw-gallery-continuation {
    display: flex !important;
    flex: 0 0 112px !important;
    align-items: center !important;
    justify-content: center !important;
    width: 112px !important;
    height: 100% !important;
    color: var(--ehtw-muted) !important;
    font-size: 12px !important;
    text-align: center !important;
    white-space: normal !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section .ehtw-gallery-continuation button {
    padding: 8px 10px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 999px !important;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
    cursor: pointer !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded .ehtw-gallery-continuation {
    flex: 1 0 100% !important;
    width: 100% !important;
    height: 48px !important;
    display: none !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags-collapsed #taglist {
    display: block !important;
    max-height: 112px !important;
    overflow: hidden !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-tags-expanded #taglist {
    max-height: none !important;
    overflow: visible !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section .ehtw-gallery-pagination {
    margin: 8px 0 0 !important;
    padding: 0 !important;
    border: 0 !important;
    display: none !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded .ehtw-gallery-pagination:not(.ehtw-gallery-pagination-secondary) {
    display: block !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section .ehtw-gallery-pagination-secondary {
    display: none !important;
}

@media (max-width: 699px) {
    html.ehtw-detail {
        --ehtw-strip: 200;
    }

    html.ehtw-detail #ehtw-center .ehtw-detail-expand-button {
        min-height: 44px !important;
        padding: 8px 14px !important;
        touch-action: manipulation !important;
        pointer-events: auto !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt {
        scrollbar-width: none;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded #gdt {
        --ehtw-strip: 120;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section.ehtw-gallery-grid-expanded #gdt a {
        height: 120px !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-gallery-grid-section #gdt::-webkit-scrollbar {
        display: none;
    }
}
/* 1.7.2：详情页窄屏。新标签表单撑开容器，操作区换行，分页不折行。 */
html.ehtw-detail #ehtw-center #gd4 {
    display: flow-root !important;
    height: auto !important;
}

html.ehtw-detail #ehtw-center #tagmenu_new,
html.ehtw-detail #ehtw-center #tagmenu_act {
    float: none !important;
    width: auto !important;
    height: auto !important;
    margin: 8px 0 0 !important;
    padding: 0 !important;
}

html.ehtw-detail #ehtw-center #tagmenu_new form {
    display: flex !important;
    align-items: center;
    gap: 8px;
    width: 100%;
}

html.ehtw-detail #ehtw-center #newtagfield {
    flex: 1 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
}

html.ehtw-detail #ehtw-center #newtagbutton {
    flex: none !important;
    margin: 0 !important;
}

html.ehtw-detail #ehtw-center .ehtw-detail-favorite-action #gdf,
html.ehtw-detail #ehtw-center .ehtw-detail-favorite-action #favoritelink {
    white-space: nowrap !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt,
html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tbody {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr {
    display: flex !important;
    flex-wrap: nowrap !important;
    max-width: 100% !important;
    overflow-x: auto !important;
    scrollbar-width: none;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt tr::-webkit-scrollbar {
    display: none;
}

html.ehtw-detail #ehtw-center .ehtw-gallery-pagination table.ptt td {
    flex: none !important;
}

@media (max-width: 699px) {
    html.ehtw-detail #ehtw-center .ehtw-detail-actions {
        flex-wrap: wrap !important;
        gap: 8px 24px !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-detail-actions .ehtw-detail-rating-action {
        flex: 0 0 100% !important;
        order: 3;
        margin-left: 0 !important;
        max-width: 100%;
    }

    html.ehtw-detail #ehtw-center .ehtw-detail-actions #gdr {
        width: auto !important;
        max-width: 100% !important;
        margin: 0 !important;
        text-align: left !important;
    }
}
/* 1.8.0：三个点菜单；评论爱心是投票，卡片爱心是收藏。 */
.ehtw-menu-wrap {
    position: relative;
    display: inline-flex;
    flex: none !important;
    margin-left: auto !important;
}

.ehtw-menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin: -4px -6px -4px 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--ehtw-muted);
    cursor: pointer;
}

.ehtw-menu-button:hover {
    background: rgba(29, 155, 240, 0.1);
    color: var(--ehtw-accent);
}

.ehtw-menu-button svg {
    width: 19px;
    height: 19px;
}

.ehtw-menu {
    position: fixed;
    z-index: 1000;
    display: none;
    min-width: 220px;
    max-width: min(300px, calc(100vw - 16px));
    padding: 4px 0;
    overflow: hidden;
    border: 1px solid var(--ehtw-border);
    border-radius: 12px;
    background: var(--ehtw-bg);
    box-shadow: 0 0 15px rgba(101, 119, 134, 0.25);
    text-align: left;
    white-space: normal;
}

.ehtw-menu-open > .ehtw-menu {
    display: block;
}

.ehtw-menu-item,
html.ehtw-detail .ehtw-menu #gd5 p a {
    display: block !important;
    width: 100%;
    margin: 0 !important;
    padding: 10px 16px !important;
    border: 0 !important;
    background: none !important;
    color: var(--ehtw-text) !important;
    font-family: inherit;
    font-size: 15px !important;
    font-weight: 700 !important;
    line-height: 20px !important;
    text-align: left;
    text-decoration: none !important;
    cursor: pointer;
    box-sizing: border-box;
}

.ehtw-menu-item:hover,
html.ehtw-detail .ehtw-menu #gd5 p a:hover {
    background: var(--ehtw-hover) !important;
}

html.ehtw-detail .ehtw-menu #gd5,
html.ehtw-detail .ehtw-menu #gd5 p {
    float: none !important;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    text-align: left !important;
}

html.ehtw-detail .ehtw-menu #gd5 p > img {
    display: none !important;
}

html.ehtw-detail .ehtw-detail-author {
    display: flex !important;
    align-items: center;
}

html.ehtw-detail .ehtw-detail-favorite-action {
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    color: var(--ehtw-muted) !important;
    cursor: pointer;
}

html.ehtw-detail .ehtw-detail-favorite-action svg {
    width: 18.75px;
    height: 18.75px;
}

html.ehtw-detail .ehtw-detail-favorite-action #gdf {
    display: none !important;
}

html.ehtw-detail .ehtw-detail-favorite-action:hover,
html.ehtw-detail .ehtw-detail-favorite-action:hover .ehtw-detail-favorite-count {
    color: #f91880 !important;
}

html.ehtw-detail #ehtw-center #cdiv button.ehtw-comment-like {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
}

html.ehtw-detail #ehtw-center #cdiv button.ehtw-comment-like .c5 {
    cursor: pointer;
}

html.ehtw-detail #ehtw-center #cdiv button.ehtw-comment-like:hover {
    color: #f91880 !important;
}

.ehtw-liked,
html.ehtw-detail #ehtw-center #cdiv .ehtw-comment-like.ehtw-liked,
html.ehtw-detail .ehtw-detail-favorite-action.ehtw-liked {
    color: #f91880 !important;
}

.ehtw-liked svg path {
    fill: currentColor;
}

html.ehtw-detail #ehtw-center #cdiv .c1 .ehtw-comment-votes-native {
    display: none !important;
}

/* The native vote breakdown is revealed on score hover. Keep it out of the
   comment grid so its appearance cannot move the score from under the pointer. */
html.ehtw-detail .ehtw-comments-section #cdiv .c1.ehtw-comment-tweet .c7 {
    position: absolute !important;
    inset: 32px 12px auto 52px !important;
    z-index: 5 !important;
    width: auto !important;
    max-width: none !important;
    pointer-events: none !important;
}
/* 1.9.0：名字是作者，@ 是上传者。 */
.ehtw-handle a {
    color: inherit !important;
    font: inherit !important;
    text-decoration: none !important;
}

.ehtw-handle a:hover {
    text-decoration: underline !important;
}

.ehtw-author-name a {
    display: inline;
    max-width: 100%;
}

/* My Home 子页面使用原站表单，但需要在中栏宽度内重排。 */
@media (min-width: 700px) {
    html.ehtw-myhome #ehtw-shell,
    html.ehtw-myuploads #ehtw-shell,
    html.ehtw-bounty #ehtw-shell {
        width: min(100%, 1225px) !important;
        max-width: 100% !important;
        grid-template-columns: 275px minmax(0, 1fr) !important;
    }

    html.ehtw-myhome #ehtw-right,
    html.ehtw-myuploads #ehtw-right,
    html.ehtw-bounty #ehtw-right {
        display: none !important;
    }

    html.ehtw-myhome #ehtw-center,
    html.ehtw-myuploads #ehtw-center,
    html.ehtw-bounty #ehtw-center {
        width: 100% !important;
        max-width: none !important;
    }
}

html.ehtw-myhome #ehtw-center > .lb,
html.ehtw-myuploads #ehtw-center > .lb,
html.ehtw-bounty #ehtw-center > .lb {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 6px 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 12px 16px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-muted) !important;
}

html.ehtw-myhome #ehtw-center > .lb > div,
html.ehtw-myuploads #ehtw-center > .lb > div,
html.ehtw-bounty #ehtw-center > .lb > div {
    display: inline-flex !important;
    align-items: center !important;
    width: auto !important;
    min-width: 0 !important;
    margin: 0 !important;
    color: var(--ehtw-muted) !important;
    white-space: nowrap !important;
}

html.ehtw-myhome #ehtw-center > .lb a,
html.ehtw-myuploads #ehtw-center > .lb a,
html.ehtw-bounty #ehtw-center > .lb a {
    display: inline-flex !important;
    align-items: center !important;
    min-height: 34px !important;
    padding: 0 10px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 999px !important;
    background: var(--ehtw-card) !important;
    color: var(--ehtw-text) !important;
    text-decoration: none !important;
}

html.ehtw-myhome #ehtw-center > .lb a:hover,
html.ehtw-myuploads #ehtw-center > .lb a:hover,
html.ehtw-bounty #ehtw-center > .lb a:hover {
    border-color: var(--ehtw-accent) !important;
    color: var(--ehtw-accent) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content,
html.ehtw-bounty #ehtw-center .ehtw-generic-content {
    padding: 12px 16px 24px !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content .stuffbox,
html.ehtw-myhome #ehtw-center .ehtw-generic-content .logbox,
html.ehtw-myhome #ehtw-center .ehtw-generic-content #outer,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content .stuffbox,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content .logbox,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content #outer,
html.ehtw-bounty #ehtw-center .ehtw-generic-content .stuffbox,
html.ehtw-bounty #ehtw-center .ehtw-generic-content .logbox,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #outer {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 0 12px !important;
    padding: 14px !important;
    overflow-x: auto !important;
    overflow-y: visible !important;
    -webkit-overflow-scrolling: touch;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 14px !important;
    background: var(--ehtw-card) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) h2,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) h2,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) h2 {
    padding: 8px 0 12px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) p,
html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) label,
html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) td,
html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) th,
html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) strong,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) p,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) label,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) td,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) th,
html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) strong,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) p,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) label,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) td,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) th,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) strong {
    color: var(--ehtw-text) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) a {
    color: var(--ehtw-accent) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(input[type="text"], input[type="password"], input[type="number"], input[type="email"], select, textarea) {
    box-sizing: border-box !important;
    max-width: 100% !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 12px !important;
    background: var(--ehtw-card) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) a,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) a {
    color: var(--ehtw-accent) !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) form {
    box-sizing: border-box !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) form,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) form {
    box-sizing: border-box !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-myhome #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) table {
    max-width: 100% !important;
    border-color: var(--ehtw-border) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-myuploads #ehtw-center .ehtw-generic-content #m {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

/* Bounty search and results use a compact filter panel and cards. */
html.ehtw-bounty #ehtw-center .ehtw-generic-content div#s.stuffbox {
    display: block !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #searchform {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #searchform > div {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #searchform input#s {
    flex: 1 1 220px !important;
    width: auto !important;
    min-width: 0 !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #searchform select {
    flex: 1 1 180px !important;
    width: auto !important;
    min-width: 0 !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #searchform input[type="button"] {
    flex: 0 0 auto !important;
    width: auto !important;
    min-width: 64px !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    border: 0 !important;
    background: transparent !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:first-child {
    display: none !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    grid-template-rows: auto auto auto auto !important;
    align-items: start !important;
    gap: 4px 12px !important;
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 0 8px !important;
    padding: 10px 12px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 12px !important;
    background: var(--ehtw-card) !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td {
    display: flex !important;
    align-items: baseline !important;
    gap: 6px !important;
    box-sizing: border-box !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    padding: 2px 0 !important;
    border: 0 !important;
    background: transparent !important;
    color: var(--ehtw-text) !important;
    white-space: normal !important;
    overflow-wrap: anywhere !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(1) {
    grid-column: 1;
    grid-row: 2;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 1;
    font-size: 15px !important;
    font-weight: 700 !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(3) {
    grid-column: 2;
    grid-row: 2;
    justify-content: flex-end !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(4) {
    grid-column: 2;
    grid-row: 3;
    justify-content: flex-end !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(5) {
    grid-column: 1;
    grid-row: 3;
    font-weight: 600 !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(6) {
    grid-column: 1 / -1;
    grid-row: 4;
    color: var(--ehtw-muted) !important;
    font-size: 12px !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(1)::before { content: 'Updated'; }
html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(3)::before { content: 'Type'; }
html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(4)::before { content: 'Status'; }
html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(5)::before { content: 'Bounty'; }
html.ehtw-bounty #ehtw-center .ehtw-generic-content table.itg > tbody > tr:not(:first-child) > td:nth-child(6)::before { content: 'Posted by'; }

html.ehtw-bounty #ehtw-center .ehtw-generic-content table.ptt,
html.ehtw-bounty #ehtw-center .ehtw-generic-content table.ptb {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow-x: auto !important;
}

/* Most Wanted pages contain a 340px image, 482px details column and a
   second 340px image. Fit all three columns into the narrower center pane. */
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1fr) !important;
    align-items: stretch !important;
    gap: 8px !important;
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 10px 0 !important;
    padding: 0 !important;
    top: auto !important;
    overflow: visible !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d2,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d6 {
    box-sizing: border-box !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d2,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d6 {
    display: flex !important;
    align-items: flex-start !important;
    justify-content: center !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d2 img,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d6 img {
    display: block !important;
    width: 100% !important;
    height: auto !important;
    max-width: 100% !important;
    max-height: 400px !important;
    object-fit: contain !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 {
    display: flex !important;
    flex-direction: column !important;
    justify-content: space-between !important;
    gap: 8px !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 > .d4,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 > .d5 {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 8px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 10px !important;
    background: var(--ehtw-bg) !important;
    color: var(--ehtw-text) !important;
    overflow-wrap: anywhere !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 .d4 table,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 .d5 table {
    width: 100% !important;
    min-width: 0 !important;
    table-layout: fixed !important;
}

html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 .d4 td,
html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 .d5 td {
    min-width: 0 !important;
    padding: 3px 4px !important;
    overflow-wrap: anywhere !important;
}

html.ehtw-myuploads #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) table,
html.ehtw-bounty #ehtw-center .ehtw-generic-content :is(.stuffbox, .logbox, #outer) table {
    max-width: 100% !important;
    border-color: var(--ehtw-border) !important;
    color: var(--ehtw-text) !important;
}

html.ehtw-mytags #ehtw-center .ehtw-generic-content #outer.stuffbox {
    padding: 14px !important;
}

html.ehtw-mytags #ehtw-center #tagset_outer {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 0 12px !important;
    padding: 0 0 12px !important;
    border-bottom: 1px solid var(--ehtw-border) !important;
    background: transparent !important;
}

html.ehtw-mytags #ehtw-center #tagset_outer > * {
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
}

html.ehtw-mytags #ehtw-center #tagset_outer #tagcolor {
    width: 112px !important;
    min-width: 72px !important;
}

html.ehtw-mytags #ehtw-center #usertag_form,
html.ehtw-mytags #ehtw-center #usertags_outer {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer {
    display: flex !important;
    flex-direction: column !important;
    gap: 6px !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer > div {
    display: grid !important;
    grid-template-columns: minmax(88px, 1fr) 66px 66px 26px minmax(58px, 70px) 34px 48px !important;
    align-items: center !important;
    gap: 4px !important;
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    min-height: 42px !important;
    margin: 0 !important;
    padding: 5px 6px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 10px !important;
    background: var(--ehtw-bg) !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer > div > div {
    box-sizing: border-box !important;
    float: none !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(2),
html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(3) {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px !important;
    color: var(--ehtw-muted) !important;
    font-size: 12px !important;
    white-space: nowrap !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer > div > div:first-child {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    text-align: left !important;
    overflow: hidden !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer input[type="text"],
html.ehtw-mytags #ehtw-center #usertags_outer input[type="number"] {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 0 !important;
    min-height: 32px !important;
    height: 32px !important;
    margin: 0 !important;
    padding: 0 7px !important;
    border-radius: 8px !important;
    font-size: 13px !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer input[type="checkbox"] {
    width: 16px !important;
    min-width: 16px !important;
    height: 16px !important;
    min-height: 16px !important;
    margin: 0 !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer button[id^="colorsetter"] {
    width: 24px !important;
    min-width: 24px !important;
    height: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
}

html.ehtw-mytags #ehtw-center #usertags_outer button[id^="tagsave"] {
    width: 48px !important;
    min-width: 48px !important;
    padding: 0 5px !important;
    font-size: 11px !important;
}

@media (max-width: 799px) {
    html.ehtw-mytags #ehtw-center #usertags_outer > div {
        grid-template-columns: minmax(0, 1fr) 72px 72px 58px !important;
        grid-template-rows: auto auto auto !important;
        gap: 5px !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:first-child {
        grid-column: 1 / -1 !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(2),
    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(3) {
        justify-content: center !important;
        font-size: 11px !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer button[id^="tagsave"] {
        width: 58px !important;
        min-width: 58px !important;
        padding: 0 4px !important;
        font-size: 11px !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(5) {
        grid-column: 1 / span 2 !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(6) {
        grid-column: 3 !important;
    }

    html.ehtw-mytags #ehtw-center #usertags_outer > div > div:nth-child(7) {
        grid-column: 4 !important;
    }
}

.ehtw-following-checking {
    visibility: hidden !important;
}

.ehtw-follow-mode-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ehtw-border);
}

.ehtw-follow-mode-tab {
    flex: 1 1 0;
    padding: 9px 12px;
    border-radius: 999px;
    color: var(--ehtw-muted) !important;
    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    text-decoration: none !important;
}

.ehtw-follow-mode-tab:hover {
    background: var(--ehtw-nav-hover);
}

.ehtw-follow-mode-active {
    background: var(--ehtw-card);
    color: var(--ehtw-text) !important;
}

.ehtw-following-hidden {
    display: none !important;
}

html.ehtw-following-authors #toppane {
    display: none !important;
}

html.ehtw-list #ehtw-center .ehtw-tweet.ehtw-following-hidden {
    display: none !important;
}

.ehtw-card-follow-button {
    flex: 0 0 auto;
    min-height: 30px;
    padding: 4px 15px;
    border: 0;
    border-radius: 999px;
    background: #1d9bf0;
    color: #fff;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    cursor: pointer;
}

.ehtw-card-follow-button:hover {
    background: #1a8cd8;
}

.ehtw-card-follow-button:disabled {
    cursor: default;
    background: transparent;
    color: var(--ehtw-muted);
    border: 1px solid var(--ehtw-border);
}

html.ehtw-list .ehtw-tweet-author .ehtw-card-follow-button {
    margin-left: auto;
}

html.ehtw-list .ehtw-tweet-author:has(.ehtw-card-follow-button) {
    height: auto !important;
    min-height: 32px !important;
    overflow: visible !important;
    margin-bottom: 4px !important;
}

html.ehtw-list .ehtw-tweet-author:has(> .ehtw-card-follow-button) .ehtw-card-more-menu {
    margin-left: 4px !important;
}

html.ehtw-list .ehtw-tweet-author .ehtw-follow-choice-wrap {
    margin-left: auto !important;
}

html.ehtw-list .ehtw-tweet-author:has(.ehtw-follow-choice-wrap) .ehtw-card-more-menu {
    margin-left: 4px !important;
}

.ehtw-follow-choice-wrap .ehtw-follow-choice-button {
    width: auto !important;
    min-width: 76px;
    height: 30px !important;
    margin: 0 !important;
    padding: 4px 12px !important;
    border-radius: 999px !important;
    font: inherit !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
}

.ehtw-native-setting-message {
    margin: 12px 0 !important;
    padding: 10px 14px !important;
    border: 1px solid var(--ehtw-border) !important;
    border-radius: 12px !important;
    background: var(--ehtw-card) !important;
    color: var(--ehtw-text) !important;
    font-size: 13px !important;
    line-height: 1.45 !important;
}

@media (max-width: 699px) {
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist * {
        box-sizing: border-box !important;
        min-width: 0 !important;
        max-width: 100% !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
    }

    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gt,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtl,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtw,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gt a,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtl a,
    html.ehtw-detail #ehtw-center .ehtw-detail-tags #taglist .gtw a {
        max-width: 100% !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 {
        grid-template-columns: minmax(0, 0.38fr) minmax(0, 0.62fr) !important;
        grid-template-rows: auto auto !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d2 {
        grid-column: 1 !important;
        grid-row: 1 !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 {
        display: contents !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d6 {
        grid-column: 1 !important;
        grid-row: 2 !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 > .d4,
    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d4 {
        grid-column: 2 !important;
        grid-row: 1 !important;
        align-self: stretch !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d3 > .d5,
    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d5 {
        grid-column: 2 !important;
        grid-row: 2 !important;
        align-self: stretch !important;
    }

    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d2 img,
    html.ehtw-bounty #ehtw-center .ehtw-generic-content #t > .d1 > .d6 img {
        max-height: 320px !important;
    }

    html.ehtw-myhome #ehtw-center .ehtw-generic-content {
        padding: 8px 10px 20px !important;
    }
}
`;

        // ============================================================
        // 3. 注入样式与外壳
        // ============================================================

        styleElement = create('style');
        styleElement.id = 'ehtw-style';
        styleElement.textContent = CSS;

        append(
            document.head || document.documentElement,
            styleElement
        );

        document.documentElement.classList.add(
            'ehtw-enabled'
        );
        if (location.hostname.toLowerCase() === 'exhentai.org') {
            document.documentElement.classList.add('ehtw-exhentai');
        }

        document.documentElement.classList.add(
            isDetail
                ? 'ehtw-detail'
                : isList
                    ? 'ehtw-list'
                    : isGeneric
                        ? 'ehtw-generic'
                        : isLogin
                            ? 'ehtw-login'
                            : 'ehtw-other'
        );
        if (isFollowingFeedPage) {
            document.documentElement.classList.add('ehtw-following-authors');
        }
        if (isMyHomePage) {
            document.documentElement.classList.add('ehtw-myhome');
        }
        if (isMyTagsPage) {
            document.documentElement.classList.add('ehtw-mytags');
        }
        if (isMyUploadsPage) {
            document.documentElement.classList.add('ehtw-myuploads');
        }
        if (isBountyPage || path === '/bounty_post.php') {
            document.documentElement.classList.add('ehtw-bounty');
        }

        // 原站在手机上写死 width=750，手机断点永远不会生效。
        const viewportContent =
            'width=device-width, initial-scale=1, viewport-fit=cover';

        const viewportMeta = document.querySelector(
            'meta[name="viewport"]'
        );

        if (viewportMeta) {
            setAttributeSafe(
                viewportMeta,
                'content',
                viewportContent
            );
        } else {
            const meta = create('meta');

            meta.setAttribute('name', 'viewport');
            meta.setAttribute('content', viewportContent);
            document.head.appendChild(meta);
            registerCreatedNode(meta);
        }

        if (isLogin) {
            committed = true;
            publishSpaPageCleanup(() => rollback?.());
            releasePageBoot();
            return;
        }

        shell = create('div');
        shell.id = 'ehtw-shell';

        const left = create('aside');
        left.id = 'ehtw-left';

        const center = create('main');
        center.id = 'ehtw-center';

        const right = create('aside');
        right.id = 'ehtw-right';

        append(shell, left);
        append(shell, center);
        append(shell, right);

        document.body.insertBefore(
            shell,
            document.body.firstChild
        );

        // ============================================================
        // 4. 左侧导航
        // ============================================================

        function buildNavigation() {
            const brand = create('a', 'ehtw-brand-link');
            brand.href = '/';
            const siteBrand = location.hostname.toLowerCase() === 'exhentai.org'
                ? 'ExHentai'
                : 'E-Hentai';
            brand.setAttribute('aria-label', `${siteBrand} Home`);
            brand.textContent = siteBrand;
            append(left, brand);

            const nav = qs('#nb');
            if (!nav) return;

            move(nav, left);

            const entries = Array.from(nav.children);
            const accountIsLoggedIn = isNativeNavigationLoggedIn(nav);

            const mappings = [
                [/^front/i, 'home'],
                [/^watched/i, 'eye'],
                [/^popular/i, 'flame'],
                [/^torrents?/i, 'download'],
                [/^(favorites?|favs?)/i, 'bookmark'],
                [/^(my\s*home|home)/i, 'user'],
                [/^settings?/i, 'settings'],
                [/^my\s*tags?/i, 'tag'],
                [/^(my\s*uploads?|uploads?)/i, 'upload'],
                [/^top\s*lists?/i, 'list'],
                [/^bounties/i, 'gift'],
                [/^news/i, 'news'],
                [/^forums?/i, 'chat'],
                [/^wiki/i, 'book'],
                [/^hentai\s*verse/i, 'globe']
            ];

            function normalizePath(url) {
                try {
                    const value = new URL(url, location.href);
                    return value.pathname.replace(/\/+$/, '') || '/';
                } catch (_) {
                    return '';
                }
            }

            const currentPath = normalizePath(location.href);

            let uploadHref = '/';
            let homeHref = '/';
            let watchedEntry = null;

            entries.forEach((entry, index) => {
                const link = entry.matches('a[href]')
                    ? entry
                    : entry.querySelector('a[href]');

                if (!link) return;

                addClassSafe(entry, 'ehtw-nav-entry');
                addClassSafe(link, 'ehtw-nav-link');

                const label = textOf(link).trim();

                const mapping = mappings.find(([pattern]) =>
                    pattern.test(label)
                );

                const kind = mapping ? mapping[1] : 'more';

                if (kind === 'eye') watchedEntry = entry;

                const isCurrent =
                    new URL(link.href, location.href).origin === location.origin &&
                    normalizePath(link.href) === currentPath &&
                    !(isFollowingFeedPage && kind === 'eye');

                const originalText = registerCreatedNode(
                    create('span', 'ehtw-nav-label')
                );

                // 原文字节点必须记录搬移，才能在 rollback 时归位。
                while (link.firstChild) {
                    move(link.firstChild, originalText);
                }

                const icon = registerCreatedNode(
                    makeIcon(
                        isCurrent ? kind + '-filled' : kind
                    )
                );

                link.appendChild(icon);
                link.appendChild(originalText);

                if (kind === 'upload') {
                    uploadHref = link.href;
                }

                if (kind === 'user') {
                    homeHref = link.href;
                }

                if (isCurrent) {
                    addClassSafe(entry, 'ehtw-nav-current');
                    setAttributeSafe(
                        link,
                        'aria-current',
                        'page'
                    );
                }

                if (index >= 10) {
                    addClassSafe(entry, 'ehtw-nav-extra');
                }

                if (index >= 5) {
                    addClassSafe(
                        entry,
                        'ehtw-nav-mobile-extra'
                    );
                }
            });

            const hasNativeToplists = entries.some((entry) =>
                /\btop\s*lists?\b/i.test(textOf(entry))
            );
            if (location.hostname.toLowerCase() === 'exhentai.org' && !hasNativeToplists) {
                const toplistsEntry = registerCreatedNode(
                    create('div', 'ehtw-nav-entry ehtw-toplists-link ehtw-nav-mobile-extra')
                );
                const toplistsLink = registerCreatedNode(create('a', 'ehtw-nav-link'));
                toplistsLink.href = 'https://e-hentai.org/toplist.php';
                toplistsLink.title = 'Opens E-Hentai Toplists';
                toplistsLink.appendChild(makeIcon('list'));
                append(toplistsLink, create('span', 'ehtw-nav-label', 'Toplists'));
                append(toplistsEntry, toplistsLink);

                const uploadsEntry = entries.find((entry) =>
                    /\/upld\/manage|\/manage(?:$|[/?#])/i.test(
                        entry.querySelector?.('a[href]')?.getAttribute('href') || ''
                    )
                );
                if (uploadsEntry?.parentNode === nav) {
                    nav.insertBefore(toplistsEntry, uploadsEntry.nextSibling);
                } else {
                    nav.appendChild(toplistsEntry);
                }
            }

            const followingEntry = registerCreatedNode(
                create('div', 'ehtw-nav-entry ehtw-nav-following-entry')
            );
            const followingLink = registerCreatedNode(
                create('a', 'ehtw-nav-link')
            );
            followingLink.href = '/watched?ehtw_following=authors';
            followingLink.appendChild(makeIcon(isFollowingFeedPage ? 'following-filled' : 'following'));
            append(
                followingLink,
                create('span', 'ehtw-nav-label', 'Following')
            );
            append(followingEntry, followingLink);
            if (isFollowingFeedPage) {
                addClassSafe(followingEntry, 'ehtw-nav-current');
                setAttributeSafe(followingLink, 'aria-current', 'page');
            }
            addClassSafe(followingEntry, 'ehtw-nav-mobile-extra');
            if (watchedEntry?.parentNode === nav) {
                nav.insertBefore(followingEntry, watchedEntry.nextSibling);
            } else {
                append(nav, followingEntry);
            }

            const mobileAccountEntry = registerCreatedNode(
                create('div', 'ehtw-nav-entry ehtw-nav-mobile-extra ehtw-mobile-account-entry')
            );
            const mobileAccountLink = registerCreatedNode(
                create('a', 'ehtw-nav-link')
            );
            mobileAccountLink.href = getNativeAccountActionUrl(accountIsLoggedIn);
            mobileAccountLink.appendChild(makeIcon(accountIsLoggedIn ? 'logout' : 'login'));
            append(
                mobileAccountLink,
                create('span', 'ehtw-nav-label', accountIsLoggedIn ? '退出登录' : '登录')
            );
            append(mobileAccountEntry, mobileAccountLink);
            append(nav, mobileAccountEntry);

            const moreEntry = registerCreatedNode(
                create('div', 'ehtw-more-entry')
            );

            const moreButton = registerCreatedNode(
                create('button', 'ehtw-more-button')
            );

            moreButton.type = 'button';
            moreButton.setAttribute('aria-expanded', 'false');

            moreButton.appendChild(makeIcon('moreCircle'));

            append(
                moreButton,
                create('span', 'ehtw-nav-label', 'More')
            );

            append(moreEntry, moreButton);
            append(nav, moreEntry);

            moreButton.addEventListener('click', () => {
                const expanded = nav.classList.contains(
                    'ehtw-nav-open'
                );

                if (expanded) {
                    nav.classList.remove('ehtw-nav-open');
                } else {
                    addClassSafe(nav, 'ehtw-nav-open');
                }

                moreButton.setAttribute(
                    'aria-expanded',
                    String(!expanded)
                );
            });

            const postLink = create(
                'a',
                'ehtw-post-button',
                'Post'
            );

            postLink.href = uploadHref;
            append(left, postLink);

            // 账号入口位于左栏可滚动内容的末尾，
            // CSS 使用 flex + margin-top:auto 将其推到视口底部。
            const account = create('div', 'ehtw-account-card');
            account.setAttribute('data-ehtw-account-menu', '');
            account.setAttribute('role', 'button');
            account.setAttribute('tabindex', '0');
            account.setAttribute('aria-label', '账户菜单');
            account.setAttribute('aria-haspopup', 'menu');
            account.setAttribute('aria-expanded', 'false');

            const avatar = create('span', 'ehtw-account-avatar', 'E');

            const accountText = create('span', 'ehtw-account-text');

            append(
                accountText,
                create(
                    'span',
                    'ehtw-account-name',
                    'My Home'
                )
            );

            append(
                accountText,
                create(
                    'span',
                    'ehtw-account-handle',
                    '@e_hentai'
                )
            );

            append(account, avatar);
            append(account, accountText);

            const accountMenu = create('div', 'ehtw-account-menu');
            accountMenu.hidden = true;
            accountMenu.setAttribute('role', 'menu');
            const homeAction = create('a', 'ehtw-account-menu-action', 'My Home');
            homeAction.href = homeHref;
            homeAction.setAttribute('role', 'menuitem');
            append(accountMenu, homeAction);
            const accountAction = create(
                'a',
                'ehtw-account-menu-action',
                accountIsLoggedIn ? '退出登录' : '登录'
            );
            accountAction.href = getNativeAccountActionUrl(accountIsLoggedIn);
            accountAction.setAttribute('role', 'menuitem');
            append(accountMenu, accountAction);
            append(account, accountMenu);

            const toggleAccountMenu = (event) => {
                if (accountMenu.contains(event.target)) return;
                event.preventDefault();
                accountMenu.hidden = !accountMenu.hidden;
                account.setAttribute('aria-expanded', String(!accountMenu.hidden));
            };
            account.addEventListener('click', toggleAccountMenu);
            account.addEventListener('keydown', (event) => {
                if (event.target !== account || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                toggleAccountMenu(event);
            });
            addSpaPageEventListener(document, 'click', (event) => {
                if (accountMenu.hidden || account.contains(event.target)) return;
                accountMenu.hidden = true;
                account.setAttribute('aria-expanded', 'false');
            });
            addSpaPageEventListener(document, 'keydown', (event) => {
                if (event.key !== 'Escape' || accountMenu.hidden) return;
                accountMenu.hidden = true;
                account.setAttribute('aria-expanded', 'false');
                account.focus();
            });

            append(left, account);
        }

        function shouldUseHistoryBack(event, referrer, origin, historyLength, hasSpaHistoryParent = false) {
            if (
                !event ||
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                historyLength <= 1
            ) {
                return false;
            }

            if (hasSpaHistoryParent) return true;

            try {
                return new URL(referrer).origin === origin;
            } catch (_) {
                return false;
            }
        }

        function getGalleryGridExpandedStorageKey(pathname) {
            const galleryId = String(pathname || '')
                .match(/^\/g\/(\d+)\//i)?.[1];
            return galleryId
                ? `ehtw-gallery-grid-expanded-v1:${galleryId}`
                : null;
        }

        // ============================================================
        // 5. 中栏固定标题
        // ============================================================

        function buildHeader() {
            const header = create('header');
            header.id = 'ehtw-header';

            const pathname =
                location.pathname.replace(/\/+$/, '') || '/';

            const searchParams = new URLSearchParams(
                location.search
            );

            const searchTerm =
                searchParams.get('f_search') || '';

            const isHomeTabs =
                !isDetail &&
                !isGeneric &&
                !searchTerm &&
                ['/', '/watched', '/popular'].includes(pathname);

            const galleryId = isDetail
                ? getGalleryIdFromUrl(location.href)
                : null;
            const galleryReturnHrefStorageKey = galleryId
                ? `ehtw-gallery-return-v1:${galleryId}`
                : null;
            const spaPreviousHref = window.history.state?.ehtwSpaPreviousHref || '';
            const isExplicitReturnEntry = window.history.state?.ehtwSpaReturnBackTarget === true;
            const previousPageHref = spaPreviousHref || (isExplicitReturnEntry ? '' : document.referrer);
            const hasSpaHistoryParent = !!window.history.state?.ehtwSpaRoute;
            const previousPageGalleryId = !galleryId
                ? getGalleryIdFromUrl(previousPageHref)
                : null;
            const searchBackHref = previousPageGalleryId
                ? resolveSearchBackHref(previousPageHref, location.href, location.origin, window.sessionStorage)
                : '';
            let storedGalleryReturnHref = null;
            if (galleryReturnHrefStorageKey) {
                try {
                    if (previousPageHref) {
                        const previous = new URL(previousPageHref, location.href);
                        if (
                            previous.origin === location.origin &&
                            getGalleryIdFromUrl(previous.href) !== galleryId &&
                            isListLikePath(previous.pathname)
                        ) {
                            window.sessionStorage?.setItem(
                                galleryReturnHrefStorageKey,
                                previous.href
                            );
                            const currentDepth = readFiniteNumber(window.history.state?.ehtwSpaDepth);
                            if (window.history.state?.ehtwSpaRoute && currentDepth !== null && currentDepth > 0) {
                                window.sessionStorage?.setItem(
                                    galleryReturnDepthKey(galleryId),
                                    String(currentDepth - 1)
                                );
                            } else {
                                window.sessionStorage?.removeItem(galleryReturnDepthKey(galleryId));
                            }
                        }
                    }
                    storedGalleryReturnHref = window.sessionStorage?.getItem(
                        galleryReturnHrefStorageKey
                    ) || null;
                } catch (_) {}
            }

            function getBackHref() {
                if (galleryId) {
                    return resolveGalleryReturnHref(
                        storedGalleryReturnHref,
                        previousPageHref,
                        location.origin,
                        galleryId
                    );
                }

                if (previousPageGalleryId) return searchBackHref || '/';

                if (previousPageHref) {
                    try {
                        const previous = new URL(previousPageHref, location.href);

                        if (previous.origin === location.origin) {
                            return previous.href;
                        }
                    } catch (_) {}
                }

                if (isMyUploadsPage) {
                    const galleryOrigin = location.hostname.toLowerCase() === 'upld.exhentai.org'
                        ? 'https://exhentai.org'
                        : 'https://e-hentai.org';
                    return `${isGallerySiteOrigin(location.origin) ? location.origin : galleryOrigin}/home.php`;
                }

                return '/';
            }

            function addBackButton() {
                const back = create('a', 'ehtw-back-link');
                back.href = getBackHref();
                back.setAttribute('aria-label', 'Back');
                back.addEventListener('click', (event) => {
                    const isOrdinaryLeftClick =
                        event.button === 0 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey;

                    if (!galleryId && previousPageGalleryId && isOrdinaryLeftClick) {
                        const targetHref = searchBackHref || '/';
                        event.preventDefault();
                        if (
                            window.__EHTW_SPA_READY__ &&
                            typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                        ) {
                            window.__EHTW_SPA_NAVIGATE__(targetHref, {
                                historyMode: 'replace',
                                restoreScrollY: getSavedSpaScroll(targetHref),
                                returnBackHref: getSavedSpaBackTarget(targetHref) || '/',
                                returnBackTarget: true
                            });
                        } else {
                            location.replace(targetHref);
                        }
                        return;
                    }

                    if (!galleryId && isExplicitReturnEntry && isOrdinaryLeftClick) {
                        const targetHref = previousPageHref || '/';
                        if (new URL(targetHref, location.href).href === location.href) {
                            event.preventDefault();
                            return;
                        }
                        event.preventDefault();
                        if (
                            window.__EHTW_SPA_READY__ &&
                            typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                        ) {
                            window.__EHTW_SPA_NAVIGATE__(targetHref, {
                                historyMode: 'replace',
                                restoreScrollY: getSavedSpaScroll(targetHref),
                                returnBackHref: getSavedSpaBackTarget(targetHref) || '/',
                                returnBackTarget: true
                            });
                        } else {
                            location.replace(targetHref);
                        }
                        return;
                    }

                    if (galleryId && isOrdinaryLeftClick) {
                        // Jump straight back to the list from a direct SPA chain.
                        // Thumbnail pagination steps back through same-gallery entries;
                        // SPA depth can diverge from browser history indexes.
                        const isThumbnailPaginationPage = new URL(location.href).searchParams.has('p');
                        if (isThumbnailPaginationPage && storedGalleryReturnHref) {
                            event.preventDefault();
                            if (
                                window.__EHTW_SPA_READY__ &&
                                typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                            ) {
                                window.__EHTW_SPA_NAVIGATE__(storedGalleryReturnHref, {
                                    historyMode: 'replace',
                                    restoreScrollY: getSavedSpaScroll(storedGalleryReturnHref),
                                    returnBackHref: getSavedSpaBackTarget(storedGalleryReturnHref) || '/',
                                    returnBackTarget: true
                                });
                            } else {
                                location.replace(storedGalleryReturnHref);
                            }
                            return;
                        }
                        const returnDepth = readFiniteNumber(
                            window.sessionStorage?.getItem(galleryReturnDepthKey(galleryId))
                        );
                        const currentDepth = readFiniteNumber(window.history.state?.ehtwSpaDepth);
                        if (
                            !isThumbnailPaginationPage &&
                            hasSpaHistoryParent &&
                            returnDepth !== null &&
                            currentDepth !== null &&
                            currentDepth > returnDepth &&
                            currentDepth - returnDepth < window.history.length
                        ) {
                            event.preventDefault();
                            window.history.go(-(currentDepth - returnDepth));
                            return;
                        }
                        if (
                            previousPageHref &&
                            getGalleryIdFromUrl(previousPageHref) === galleryId
                        ) {
                            event.preventDefault();
                            if (window.history.length > 1) {
                                try {
                                    window.sessionStorage?.setItem(
                                        galleryBackTraversalStorageKey,
                                        galleryId
                                    );
                                    window.history.back();
                                } catch (_) {
                                    navigatePage('/');
                                }
                            } else {
                                navigatePage(storedGalleryReturnHref || getBackHref());
                            }
                            return;
                        }

                        if (
                            storedGalleryReturnHref &&
                            shouldUseHistoryBack(
                                event,
                                previousPageHref,
                                location.origin,
                                window.history.length,
                                hasSpaHistoryParent
                            )
                        ) {
                            event.preventDefault();
                            window.history.back();
                            return;
                        }
                    }

                    if (!shouldUseHistoryBack(
                        event,
                        previousPageHref,
                        location.origin,
                        window.history.length,
                        hasSpaHistoryParent
                    )) {
                        // Cannot pop history (fresh tab / reload etc.): still
                        // go to the stored page via SPA and restore its scroll.
                        if (
                            isOrdinaryLeftClick &&
                            window.__EHTW_SPA_READY__ &&
                            typeof window.__EHTW_SPA_NAVIGATE__ === 'function'
                        ) {
                            const targetHref = getBackHref();
                            event.preventDefault();
                            window.__EHTW_SPA_NAVIGATE__(targetHref, {
                                historyMode: 'push',
                                restoreScrollY: getSavedSpaScroll(targetHref)
                            });
                        }
                        return;
                    }

                    event.preventDefault();
                    window.history.back();
                });
                append(back, makeIcon('back'));
                append(header, back);

            }

            function addContextHeading(title, subtitle) {
                addClassSafe(header, 'ehtw-context-header');

                addBackButton();

                const text = create(
                    'div',
                    'ehtw-context-heading'
                );

                append(
                    text,
                    create(
                        'h1',
                        'ehtw-context-title',
                        title
                    )
                );

                if (subtitle) {
                    append(
                        text,
                        create(
                            'div',
                            'ehtw-context-subtitle',
                            subtitle
                        )
                    );
                }

                append(header, text);
            }

            function readResultCount() {
                const source = textOf(qs('.searchtext'));

                if (!source) return '';

                return source
                    .replace(/^Found(?:\s+about)?\s*/i, '')
                    .split('.')[0]
                    .trim();
            }

            function decodeSegment(value) {
                try {
                    return decodeURIComponent(value);
                } catch (_) {
                    return value;
                }
            }

            function getListTitle() {
                if (searchTerm) {
                    return searchTerm;
                }

                const uploaderMatch = pathname.match(
                    /^\/uploader\/(.+)$/i
                );

                if (uploaderMatch) {
                    return decodeSegment(uploaderMatch[1])
                        .replace(/\+/g, ' ');
                }

                const tagMatch = pathname.match(
                    /^\/tag\/(.+)$/i
                );

                if (tagMatch) {
                    const decoded = decodeSegment(
                        tagMatch[1]
                    ).replace(/\+/g, ' ');

                    const bare = decoded.replace(
                        /^[^:]+:/,
                        ''
                    );

                    return '#' + bare
                        .trim()
                        .replace(/\s+/g, '_');
                }

                return 'Search';
            }

            function getGenericTitle() {
                const titles = {
                    '/torrents.php': 'Torrents',
                    '/toplist.php': 'Toplists',
                    '/bounty.php': 'Bounties',
                    '/news.php': 'News',
                    '/favorites.php': 'Favorites',
                    '/home.php': 'My Home',
                    '/uconfig.php': 'Settings',
                    '/mytags': 'My Tags',
                    '/stats.php': 'My Stats',
                    '/hentaiathome.php': 'Hentai@Home',
                    '/bitcoin.php': 'Donations',
                    '/hathperks.php': 'Hath Perks',
                    '/manage': 'My Uploads',
                    '/managefolders': 'Manage Folders',
                    '/managegallery': 'Create New Gallery',
                    '/bounty_post.php': 'Post New Bounty'
                };

                if (titles[pathname]) {
                    return titles[pathname];
                }

                if (pathname === '/exchange.php') {
                    return searchParams.get('t') === 'hath'
                        ? 'Hath Exchange'
                        : 'GP Exchange';
                }

                if (pathname === '/logs.php') {
                    return searchParams.get('t') === 'credits'
                        ? 'Credit Log'
                        : 'Karma Log';
                }

                const fallback = (
                    document.title || ''
                ).split(' - ')[0].trim();

                return fallback || 'Page';
            }

            if (isHomeTabs) {
                addClassSafe(
                    header,
                    'ehtw-tabs-header'
                );

                const tabs = [
                    ['For you', '/', '/', pathname === '/' && !isFollowingFeedPage],
                    ['Watched', '/watched', '/watched', pathname === '/watched']
                ];

                tabs.forEach(([label, href, path, active]) => {
                    const link = create(
                        'a',
                        'ehtw-top-tab'
                    );

                    link.href = href;

                    append(
                        link,
                        create(
                            'span',
                            'ehtw-top-tab-label',
                            label
                        )
                    );

                    if (active) {
                        addClassSafe(
                            link,
                            'ehtw-tab-active'
                        );

                        link.setAttribute(
                            'aria-current',
                            'page'
                        );
                    }

                    append(header, link);
                });
            } else if (isDetail) {
                const commentCount = readCommentCount(document);

                addContextHeading(
                    'Post',
                    commentCount +
                        (commentCount === 1
                            ? ' comment'
                            : ' comments')
                );
            } else if (isGeneric) {
                if (
                    pathname === '/watched' &&
                    !searchTerm
                ) {
                    addClassSafe(
                        header,
                        'ehtw-tabs-header'
                    );

                    const tabs = [
                        ['For you', '/', '/'],
                        ['Watched', '/watched', '/watched']
                    ];

                    tabs.forEach(([label, href, path]) => {
                        const link = create(
                            'a',
                            'ehtw-top-tab'
                        );

                        link.href = href;

                        append(
                            link,
                            create(
                                'span',
                                'ehtw-top-tab-label',
                                label
                            )
                        );

                        if (pathname === path) {
                            addClassSafe(
                                link,
                                'ehtw-tab-active'
                            );

                            link.setAttribute(
                                'aria-current',
                                'page'
                            );
                        }

                        append(header, link);
                    });
                } else {
                    addContextHeading(
                        getGenericTitle(),
                        ''
                    );
                }
            } else {
                addContextHeading(
                    getListTitle(),
                    readResultCount()
                );
            }

            append(center, header);
        }

        // ============================================================
        // 6. 搜索框
        // ============================================================

        function makeSearchToplistPanel() {
            const panel = create('section', 'ehtw-search-toplists');
            const isEhentaiToplistHost = location.origin === 'https://e-hentai.org';
            const isExhentaiToplistHost = location.origin === 'https://exhentai.org';
            if (!isEhentaiToplistHost && !isExhentaiToplistHost) return panel;
            const toplists = [
                ['Yesterday Toplist', '/toplist.php?tl=15'],
                ['Month Toplist', '/toplist.php?tl=13']
            ];
            const sections = toplists.map(([label, href]) => {
                const section = create('section', 'ehtw-search-toplist-section');
                const heading = create('a', 'ehtw-search-toplist-heading', label);
                heading.href = isExhentaiToplistHost
                    ? new URL(href, 'https://e-hentai.org').href
                    : href;
                const status = create('div', 'ehtw-search-toplist-status', 'Loading…');
                const list = create('ol', 'ehtw-search-toplist-list');
                const more = create('details', 'ehtw-search-toplist-more');
                const moreSummary = create('summary');
                const moreList = create('ol', 'ehtw-search-toplist-list ehtw-search-toplist-extra');
                append(more, moreSummary);
                append(more, moreList);
                append(section, heading);
                append(section, status);
                append(section, list);
                append(section, more);
                append(panel, section);
                return { href, status, list, more, moreSummary, moreList };
            });

            const CACHE_KEY = 'ehtw-search-toplist-data-v5';
            const CACHE_TTL = 60 * 60 * 1000;
            const toplistEntryLimit = 50;
            // Retain the last tag filter briefly so a cached Toplist can paint
            // immediately while the fresh My Tags request updates it in the background.
            const cachedHiddenTags = readCachedSearchHiddenTags();
            const hiddenTagsPromise = requestHiddenMyTags()
                .then((tags) => ({ tags, error: null }))
                .catch((error) => ({ tags: null, error }));
            let cache = {};
            try {
                const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                if (saved && typeof saved === 'object') cache = saved;
            } catch (_) {}

            function extractToplistEntries(root, limit = 10) {
                return extractNativeToplistEntries(root, limit, location.href);
            }
            window.__EHTW_EXTRACT_TOPLIST_ENTRIES__ = extractToplistEntries;

            function loadToplistThroughBridge(href) {
                const period = new URL(href, 'https://e-hentai.org').searchParams.get('tl') || '';
                const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                return new Promise((resolve, reject) => {
                    const frame = document.createElement('iframe');
                    let finished = false;
                    const cleanup = () => {
                        if (finished) return;
                        finished = true;
                        window.clearTimeout(timeout);
                        window.removeEventListener('message', onMessage);
                        frame.remove();
                    };
                    const timeout = window.setTimeout(() => {
                        cleanup();
                        reject(new Error('Toplist bridge timed out'));
                    }, 12000);
                    const onMessage = (event) => {
                        const payload = event.data;
                        if (
                            event.origin !== 'https://e-hentai.org' ||
                            event.source !== frame.contentWindow ||
                            payload?.type !== 'ehtw-toplist-bridge' ||
                            payload.token !== token ||
                            payload.period !== period
                        ) return;
                        cleanup();
                        resolve(Array.isArray(payload.entries) ? payload.entries : []);
                    };
                    addUserScriptListener(window, 'message', onMessage);
                    frame.setAttribute('aria-hidden', 'true');
                    frame.tabIndex = -1;
                    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-2px;top:-2px;opacity:0;pointer-events:none;border:0;';
                    const bridgeUrl = new URL(href, 'https://e-hentai.org');
                    bridgeUrl.searchParams.set('_ehtw_toplist_bridge', token);
                    frame.src = bridgeUrl.href;
                    document.body.appendChild(frame);
                });
            }

            function areTagSetsEqual(left, right) {
                if (!left || !right || left.size !== right.size) return false;
                for (const tag of left) if (!right.has(tag)) return false;
                return true;
            }

            function renderSection(section, entries, hiddenTags) {
                const { status, list, more, moreSummary, moreList } = section;
                const visibleEntries = filterToplistEntries(entries, hiddenTags);
                const displayEntries = visibleEntries.slice(0, 10);
                status.textContent = visibleEntries.length ? '' : 'No entries found.';
                list.replaceChildren();
                moreList.replaceChildren();
                more.hidden = displayEntries.length <= 5;
                moreSummary.textContent = displayEntries.length > 5
                    ? `Show ${displayEntries.length - 5} more`
                    : '';
                displayEntries.forEach((entry, entryIndex) => {
                    const item = create('li', 'ehtw-search-toplist-item');
                    append(item, create('span', 'ehtw-search-toplist-rank', String(entryIndex + 1)));
                    const cover = create('span', 'ehtw-search-toplist-cover');
                    if (entry.thumbnail) {
                        const image = create('img');
                        image.src = entry.thumbnail;
                        image.alt = '';
                        image.loading = 'lazy';
                        image.decoding = 'async';
                        append(cover, image);
                    }
                    append(item, cover);
                    const link = create('a', 'ehtw-search-toplist-title', entry.title);
                    link.href = isExhentaiToplistHost
                        ? entry.href.replace(/^https:\/\/e-hentai\.org(?=\/)/i, location.origin)
                        : entry.href;
                    append(item, link);
                    append(entryIndex < 5 ? list : moreList, item);
                });
            }

            async function loadSection(section) {
                    const { href, status } = section;
                    const cached = cache[href];
                    const cachedTagsAreComplete = Array.isArray(cached?.entries) &&
                        cached.entries.every((entry) => Array.isArray(entry?.tags));
                    let entries = cached && Date.now() - cached.at < CACHE_TTL &&
                        cachedTagsAreComplete &&
                        (toplistEntryLimit <= 10 || Number(cached.limit || cached.entries?.length || 0) >= toplistEntryLimit)
                        ? cached.entries
                        : null;

                    if (!Array.isArray(entries)) {
                        try {
                            if (isExhentaiToplistHost) {
                                entries = await loadToplistThroughBridge(href);
                            } else {
                                const response = await window.fetch(href, {
                                    credentials: 'same-origin',
                                    cache: 'no-store'
                                });
                                if (!response?.ok) throw new Error('Toplist request failed');
                                const pageText = await response.text();
                                const page = new window.DOMParser()
                                    .parseFromString(pageText, 'text/html');
                                entries = extractToplistEntries(page, toplistEntryLimit);
                            }
                            // 空结果通常意味着站点改了结构或返回了验证页，
                            // 不缓存它，避免榜单一直空白一小时。
                            if (entries.length) {
                                cache[href] = { at: Date.now(), limit: toplistEntryLimit, entries };
                                try {
                                    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
                                } catch (_) {}
                            }
                        } catch (_) {
                            status.textContent = 'Could not load this list.';
                            return;
                        }
                    }

                    publishToplistEntries(href, entries);
                    if (cachedHiddenTags) {
                        renderSection(section, entries, cachedHiddenTags);
                        hiddenTagsPromise.then((fresh) => {
                            if (!fresh.tags || areTagSetsEqual(cachedHiddenTags, fresh.tags)) return;
                            renderSection(section, entries, fresh.tags);
                        });
                        return;
                    }

                    const hiddenTagState = await hiddenTagsPromise;
                    if (!hiddenTagState.tags) {
                        status.textContent = 'Could not apply hidden tag filters.';
                        return;
                    }
                    renderSection(section, entries, hiddenTagState.tags);
            }

            function load() {
                // Yesterday and Month are independent; let both cache reads or
                // bridge requests run together instead of serializing the sidebar.
                sections.forEach((section) => { loadSection(section); });
            }

            load();
            return panel;
        }

        function buildSearch() {
            const searchbox = qs('#searchbox');
            if (!searchbox) return null;

            right.classList.add('ehtw-toplist-only-sidebar');

            const card = create('section');
            card.id = 'ehtw-search-card';

            const mobile = create('section');
            mobile.id = 'ehtw-mobile-search';

            append(right, card);
            const toplistShortcuts = makeSearchToplistPanel();

            center.insertBefore(
                mobile,
                qs('#ehtw-header')?.nextSibling || null
            );

            move(searchbox, card);
            append(card, toplistShortcuts);

            const form = qs('form', searchbox);
            const input = qs('#f_search', searchbox);

            if (form && input) {
                const wrapper = registerCreatedNode(
                    create('div', 'ehtw-search-input-wrap')
                );

                input.parentNode.insertBefore(wrapper, input);
                move(input, wrapper);

                const icon = registerCreatedNode(
                    makeIcon('search')
                );

                addClassSafe(icon, 'ehtw-search-icon');
                wrapper.insertBefore(icon, input);
            }

            const filters = registerCreatedNode(
                create('button', 'ehtw-filters-toggle')
            );

            filters.type = 'button';

            filters.setAttribute(
                'aria-expanded',
                'false'
            );

            filters.appendChild(makeIcon('filter'));

            append(
                filters,
                create('span', '', 'Filters')
            );

            append(searchbox, filters);

            addClassSafe(
                searchbox,
                'ehtw-filters-collapsed'
            );

            filters.addEventListener('click', () => {
                const expanded = searchbox.classList.contains(
                    'ehtw-filters-open'
                );

                if (expanded) {
                    searchbox.classList.remove(
                        'ehtw-filters-open'
                    );
                } else {
                    addClassSafe(
                        searchbox,
                        'ehtw-filters-open'
                    );
                }

                filters.setAttribute(
                    'aria-expanded',
                    String(!expanded)
                );
            });

            // 原站文件搜索面板仍依赖原有节点和事件。
            // 只搬移，不重建，也不修改其 onclick。
            const fileSearch = qs('#fsdiv');

            if (fileSearch && !searchbox.contains(fileSearch)) {
                addClassSafe(
                    fileSearch,
                    'ehtw-search-extra-panel'
                );

                move(fileSearch, searchbox);
            }

            // 日期范围条原本留在 body > .ido。
            const rangebar = qs('#rangebar');

            if (rangebar && !searchbox.contains(rangebar)) {
                addClassSafe(
                    rangebar,
                    'ehtw-search-extra-panel'
                );

                move(rangebar, searchbox);
            }

            // 搜索页的上方模式切换栏归入 Filters。
            // 原 select、分页链接和原站事件全部保留。
            if (typeof isList !== 'undefined' && isList) {
                const topNav = qsa('.searchnav').find(
                    node =>
                        !node.closest('#ehtw-shell') &&
                        !searchbox.contains(node)
                );

                if (topNav) {
                    addClassSafe(
                        topNav,
                        'ehtw-search-mode-toolbar'
                    );

                    move(topNav, searchbox);
                }
            }

            let currentHost = card;

            function updateSearchPlacement() {
                if (!committed) return;

                const target = window.matchMedia(
                    '(max-width: 999px)'
                ).matches ? mobile : card;

                if (target !== currentHost) {
                    target.appendChild(searchbox);
                    target.appendChild(toplistShortcuts);
                    currentHost = target;
                }
            }

            registerMediaListener(
                window.matchMedia('(max-width: 999px)'),
                updateSearchPlacement
            );

            return updateSearchPlacement;
        }

        // ============================================================
        // 7. Trending 标签统计
        // ============================================================

        function normalizeTag(value) {
            return String(value || '')
                .trim()
                .replace(/^#+/, '')
                .replace(/\s+/g, ' ');
        }

        function collectTags(root = document) {
            const counts = new Map();

            qsa('.gt', root).forEach((tag) => {
                const tagTitle = tag.getAttribute('title') || '';
                if (isFollowingAuthorsPage && !isCreatorTagValue(tagTitle)) {
                    return;
                }

                const raw =
                    textOf(qs('a', tag)) ||
                    textOf(tag) ||
                    tagTitle ||
                    '';

                const name = normalizeTag(raw);

                if (!name) return;

                counts.set(
                    name,
                    (counts.get(name) || 0) + 1
                );
            });

            return Array.from(counts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) {
                        return b[1] - a[1];
                    }

                    return a[0].localeCompare(b[0]);
                })
                .slice(0, 10);
        }

        function buildTrending(tagCounts) {
            if (right?.classList.contains('ehtw-toplist-only-sidebar')) return;
            if (!tagCounts || !tagCounts.length) return;

            const card = create(
                'section',
                'ehtw-side-card ehtw-trending-card'
            );

            append(
                card,
                create(
                    'h2',
                    'ehtw-side-title',
                    "What's happening"
                )
            );

            tagCounts.forEach(([raw, count], index) => {
                const parsed = parseTwitterTag(raw);

                const link = create(
                    'a',
                    'ehtw-trend'
                );

                link.href =
                    '/?f_search=' + encodeURIComponent(raw);

                link.title =
                    count +
                    (count === 1 ? ' gallery' : ' galleries');

                if (index >= 5) {
                    addClassSafe(
                        link,
                        'ehtw-trend-extra'
                    );
                }

                const textColumn = create(
                    'span',
                    'ehtw-trend-text'
                );

                const category =
                    parsed.category === 'Trending in tags'
                        ? 'Trending'
                        : parsed.category + ' · Trending';

                append(
                    textColumn,
                    create(
                        'span',
                        'ehtw-trend-category',
                        category
                    )
                );

                append(
                    textColumn,
                    create(
                        'span',
                        'ehtw-trend-name',
                        '#' + parsed.display
                    )
                );

                append(link, textColumn);

                append(card, link);
            });

            if (tagCounts.length > 5) {
                const moreButton = create(
                    'button',
                    'ehtw-trending-more',
                    'Show more'
                );

                moreButton.type = 'button';

                moreButton.addEventListener(
                    'click',
                    () => {
                        const expanded =
                            card.classList.contains(
                                'ehtw-trending-expanded'
                            );

                        if (expanded) {
                            card.classList.remove(
                                'ehtw-trending-expanded'
                            );

                            moreButton.textContent = 'Show more';
                        } else {
                            addClassSafe(
                                card,
                                'ehtw-trending-expanded'
                            );

                            moreButton.textContent = 'Show less';
                        }
                    }
                );

                append(card, moreButton);
            }

            append(right, card);
        }

        // ============================================================
        // 8. 原生列表分页
        // ============================================================

        function buildPagination(source, target) {
            if (!source || !target) return;

            const wrapper = create(
                'section',
                'ehtw-pagination'
            );

            move(source, wrapper);
            append(target, wrapper);

            return wrapper;
        }

        function findNextListPageUrl(root, baseHref = location.href) {
            let baseUrl;
            try {
                baseUrl = new URL(baseHref, location.href);
            } catch (_) {
                return null;
            }

            const candidates = [];
            const directNext = qs('#dnext, a[rel~="next"]', root);
            if (directNext) candidates.push(directNext);
            candidates.push(...qsa('.searchnav a[href]', root));

            const currentPage = Number.parseInt(
                baseUrl.searchParams.get('page') || '0',
                10
            );
            const numbered = [];
            const labelled = [];
            const seen = new Set();

            candidates.forEach((link) => {
                const href = link.getAttribute('href') || link.href;
                if (!href) return;

                try {
                    const url = new URL(href, baseUrl.href);
                    if (
                        url.origin !== location.origin ||
                        url.href === baseUrl.href ||
                        seen.has(url.href)
                    ) {
                        return;
                    }
                    seen.add(url.href);

                    const page = Number.parseInt(
                        url.searchParams.get('page') || '',
                        10
                    );
                    if (Number.isFinite(page) && page > currentPage) {
                        numbered.push({ page, href: url.href });
                    }

                    const label = [
                        link.getAttribute('aria-label'),
                        link.getAttribute('title'),
                        textOf(link)
                    ].filter(Boolean).join(' ').trim();
                    if (
                        link === directNext ||
                        /\bnext\b|下一页|后一页|^\s*(?:>|»|›|→)\s*$/i.test(label)
                    ) {
                        labelled.push(url.href);
                    }
                } catch (_) {}
            });

            if (labelled.length) return labelled[0];
            numbered.sort((a, b) => a.page - b.page);
            if (numbered.length) return numbered[0].href;
            return null;
        }

        // ============================================================
        // 8.1 画廊分页
        // ============================================================

        function buildGalleryPagination(source, target) {
            if (!source || !target) return null;

            const wrapper = create(
                'section',
                'ehtw-gallery-pagination'
            );

            move(source, wrapper);
            append(target, wrapper);

            return wrapper;
        }

        function findNextGalleryThumbPageUrl(pager, baseHref = location.href) {
            let baseUrl;
            try {
                baseUrl = new URL(baseHref, location.href);
            } catch (_) {
                return null;
            }

            const currentIndex = Number.parseInt(
                baseUrl.searchParams.get('p') || '0',
                10
            );
            const numbered = [];
            const labelled = [];
            qsa('a[href]', pager).forEach((link) => {
                try {
                    const url = new URL(
                        link.getAttribute('href') || link.href,
                        baseUrl.href
                    );
                    if (url.origin !== location.origin || url.href === baseUrl.href) return;

                    const pageIndex = Number.parseInt(
                        url.searchParams.get('p') || '',
                        10
                    );
                    if (Number.isFinite(pageIndex) && pageIndex > currentIndex) {
                        numbered.push({ pageIndex, href: url.href });
                    }

                    const label = [
                        link.getAttribute('aria-label'),
                        link.getAttribute('title'),
                        textOf(link)
                    ].filter(Boolean).join(' ').trim();
                    if (/\bnext\b|下一页|^\s*(?:>|»|›|→)\s*$/i.test(label)) {
                        labelled.push(url.href);
                    }
                } catch (_) {}
            });

            if (labelled.length) return labelled[0];
            numbered.sort((a, b) => a.pageIndex - b.pageIndex);
            return numbered[0]?.href || null;
        }

        function makeHorizontalStripWheelHandler(strip, scope = null) {
            return (event) => {
                let deltaY = Number(event.deltaY) || 0;
                if (!deltaY) {
                    deltaY = -(
                        Number(event.wheelDeltaY) ||
                        Number(event.wheelDelta) ||
                        0
                    );
                }
                if (
                    !strip ||
                    (scope && event.target &&
                        !scope.contains(event.target) &&
                        !event.composedPath?.().includes(scope)) ||
                    event.ctrlKey ||
                    !deltaY ||
                    Math.abs(event.deltaX) > Math.abs(deltaY) * 2
                ) {
                    return false;
                }

                const maxScrollLeft = Math.max(
                    0,
                    strip.scrollWidth - strip.clientWidth
                );
                if (!maxScrollLeft) return false;

                const deltaScale = event.deltaMode === 1
                    ? 40
                    : event.deltaMode === 2
                        ? Math.max(1, strip.clientWidth)
                        : 1;
                const horizontalDelta = deltaY * deltaScale;
                const currentLeft = strip.scrollLeft;
                const atStart = currentLeft <= 0;
                const atEnd = currentLeft >= maxScrollLeft - 1;
                if (
                    (horizontalDelta < 0 && atStart) ||
                    (horizontalDelta > 0 && atEnd)
                ) {
                    return false;
                }

                event.preventDefault();
                strip.scrollLeft = Math.max(
                    0,
                    Math.min(maxScrollLeft, currentLeft + horizontalDelta)
                );
                return true;
            };
        }

        // ============================================================
        // 8.2 页脚
        // ============================================================

        function buildFooter() {
            if (right?.classList.contains('ehtw-toplist-only-sidebar')) return null;
            const footers = qsa('div.dp').filter(
                node => !node.closest('#ehtw-shell')
            );

            if (!footers.length) return null;

            const wrapper = create(
                'div',
                'ehtw-footer'
            );

            footers.forEach(node => {
                move(node, wrapper);
            });

            append(right, wrapper);

            const mobile = create('div');
            mobile.id = 'ehtw-mobile-footer';

            append(center, mobile);

            let currentHost = right;

            function updateFooterPlacement() {
                if (!committed) return;

                const target = window.matchMedia(
                    '(max-width: 999px)'
                ).matches ? mobile : right;

                if (target !== currentHost) {
                    target.appendChild(wrapper);
                    currentHost = target;
                }
            }

            registerMediaListener(
                window.matchMedia('(max-width: 999px)'),
                updateFooterPlacement
            );

            return updateFooterPlacement;
        }

        // ============================================================
        // 9. 列表条目转换
        // ============================================================

        function findGalleryListLink(row) {
            const links = qsa('a[href*="/g/"]', row);
            return links.find((link) => textOf(qs('.glink', link) || link).trim()) || links[0] || null;
        }

        function isGalleryListRow(row) {
            return !!row && (
                row.matches?.('.gl1t') ||
                !!findGalleryListLink(row)
            );
        }

        function getCategoryClass(node) {
            if (!node) return 'ct1';

            const match = Array.from(node.classList)
                .find(
                    name => /^ct(?:[1-9]|a)$/.test(name)
                );

            return match || 'ct1';
        }

        function findUploader(row) {
            const link = qsa('a[href*="/uploader/"]', row)[0] || null;
            const uploaderCell = link?.closest?.('td, .gl4c, .gl5m, .gl4e') || link?.parentElement || null;

            return {
                cell: uploaderCell,
                link,
                name: textOf(
                    link,
                    'Unknown'
                )
            };
        }

        function findPostedNode(row) {
            const candidates = qsa(
                '[id^="posted_"]',
                row
            );

            return candidates.find(
                node => !node.id.startsWith('postedpop_')
            ) || null;
        }

        function findRowTimestamp(row) {
            return textOf(row).match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0] || '';
        }

        function findRating(row) {
            const ratings = qsa('.ir', row);
            return ratings.find((rating) =>
                !rating.closest('.glthumb, .gl1e')
            ) || ratings[0] || null;
        }

        function findDownload(row) {
            return qs('.gldown', row);
        }

        function findPageCount(row) {
            return qsa('td, div, span', row).find((node) =>
                !qs('a', node) && /^\s*\d[\d,]*\s*(?:pages?|页)\s*$/i.test(textOf(node))
            ) || null;
        }

        function extractListTags(link, tagsContainer, creatorTagsOnly = false) {
            if (!link || !tagsContainer) return;

            const tags = qsa(
                '.gt, .gtl, .gtw',
                link
            );

            tags.forEach((tag, index) => {
                const raw = tag.getAttribute('title') || '';
                if (
                    creatorTagsOnly &&
                    !isCreatorTagValue(raw)
                ) {
                    tag.remove();
                    return;
                }

                const anchor = qs('a', tag);
                const sourceText = textOf(anchor || tag);
                const parsed = parseTwitterTag(sourceText);

                addClassSafe(tag, 'ehtw-hashtag');

                if (index >= 6) {
                    addClassSafe(
                        tag,
                        'ehtw-hashtag-overflow'
                    );
                }

                if (anchor) {
                    setTextSafe(
                        anchor,
                        '#' + parsed.display
                    );
                } else {
                    // 未找到 a 时使用可回滚的文本替换。
                    setTextSafe(
                        tag,
                        '#' + parsed.display
                    );
                }

                // 标签原本在画廊链接里，搬出来后需要自己的链接。
                const tagLink = registerCreatedNode(
                    create('a', 'ehtw-tag-link')
                );

                tagLink.href = raw
                    ? '/tag/' + encodeTagPath(raw)
                    : '/?f_search=' +
                        encodeURIComponent(sourceText);

                move(tag, tagLink);
                append(tagsContainer, tagLink);
            });
        }

        function neutralizeHoverHandlers(row) {
            if (!row) return;

            const cell = row.querySelector('td.gl3c, td.gl3m, td.gl3e');
            if (!cell) return;

            for (const name of ['onmouseover', 'onmouseout']) {
                if (!cell.hasAttribute(name)) continue;

                if (!skipTransactionTracking) {
                    modifications.push({
                        type: 'attribute',
                        element: cell,
                        name: name,
                        existed: true,
                        oldValue: cell.getAttribute(name)
                    });
                }

                cell.removeAttribute(name);
            }
        }

        function encodeTagPath(raw) {
            return encodeURI(String(raw).replace(/ /g, '+'))
                .replace(/[?#]/g, (character) => encodeURIComponent(character));
        }

        function parseTwitterTag(raw) {
            const value = String(raw || '')
                .trim()
                .replace(/^#/, '');

            const match = value.match(
                /^([a-z]+):(.+)$/i
            );

            let category = 'Trending in tags';
            let display = value;

            if (match) {
                const namespace = match[1].toLowerCase();
                display = match[2];

                if (namespace === 'f') {
                    category = 'female';
                } else if (namespace === 'm') {
                    category = 'male';
                } else if (namespace === 'x') {
                    category = 'mixed';
                }
            }

            display = display
                .trim()
                .replace(/\s+/g, '_');

            return {
                category,
                display,
                original: value
            };
        }

        function setTextSafe(node, value) {
            if (!node) return;

            // 保存全部原子节点及位置，包括原文本节点。
            // 新文本节点单独登记，以便 rollback 清除。
            const oldChildren = Array.from(node.childNodes);
            const parking = document.createDocumentFragment();

            for (const child of oldChildren) {
                rememberMove(child);
                parking.appendChild(child);
            }

            const textNode = document.createTextNode('');
            textNode.textContent = String(value);

            registerCreatedNode(textNode);
            node.appendChild(textNode);

            // parking 由旧子节点引用维持；rollback 按 moves 逆序
            // 恢复旧子节点，并由 createdNodes 删除新文本节点。
        }

        function formatTwitterTime(value) {
            const match = String(value || '').match(
                /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/
            );

            if (!match) return String(value || '');

            const date = new Date(Date.UTC(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4]),
                Number(match[5])
            ));

            const elapsed = Date.now() -
                (date.getTime() - SITE_UTC_OFFSET_MIN * 60000);

            if (elapsed >= 0 && elapsed < 60000) {
                return 'now';
            }

            if (elapsed >= 0 && elapsed < 3600000) {
                return Math.floor(elapsed / 60000) + 'm';
            }

            if (elapsed >= 0 && elapsed < 86400000) {
                return Math.floor(elapsed / 3600000) + 'h';
            }

            const month = date.toLocaleString(
                'en-US',
                {
                    month: 'short',
                    timeZone: 'UTC'
                }
            );

            const day = date.getUTCDate();

            if (
                date.getUTCFullYear() ===
                new Date().getUTCFullYear()
            ) {
                return month + ' ' + day;
            }

            return month + ' ' + day + ', ' +
                date.getUTCFullYear();
        }

        function formatTwitterFullDate(value) {
            const match = String(value || '').match(
                /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/
            );

            if (!match) return String(value || '');

            const date = new Date(Date.UTC(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4]),
                Number(match[5])
            ));

            return date.toLocaleString(
                'en-US',
                {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC'
                }
            ).replace(',', ' ·');
        }

        function findDetailTimestamp(root) {
            const text = textOf(root);

            const match = text.match(
                /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/
            );

            return match ? match[0] : '';
        }

        function readSpriteRating(node) {
            if (!node) return '';

            const background =
                node.style.backgroundPosition ||
                getComputedStyle(node).backgroundPosition ||
                '';

            const values = background.match(
                /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/
            );

            if (!values) return '';

            const x = Number(values[1]);
            const y = Number(values[2]);

            const scores = {
                0: 5,
                '-16': 4,
                '-32': 3,
                '-48': 2,
                '-64': 1
            };

            let score = scores[String(x)];

            if (score === undefined) return '';

            if (y === -21) {
                score -= 0.5;
            }

            return String(score);
        }

        function extractPageNumber(node) {
            const text = textOf(node);

            const match = text.match(/[\d,]+/);

            return match ? match[0] : '';
        }

        addSpaPageEventListener(document, 'click', (event) => {
            // Keep the popup open when its trigger or one of its controls is
            // clicked. Menu items close themselves before running actions.
            if (event.target?.closest?.('.ehtw-menu-wrap')) return;
            closeActionMenus();
        });
        addSpaPageEventListener(document, 'keydown', (event) => {
            if (event.key === 'Escape') closeActionMenus();
        });
        addSpaPageEventListener(window, 'wheel', closeActionMenus, {
            passive: true
        });
        addSpaPageEventListener(window, 'touchmove', closeActionMenus, {
            passive: true
        });

        function makeTweetAction(kind, href) {
            const node = href
                ? create('a', 'ehtw-twitter-action')
                : create('div', 'ehtw-twitter-action');

            if (href) {
                node.href = href;
            }

            node.classList.add(
                'ehtw-twitter-action-' + kind
            );

            const icon = create(
                'span',
                'ehtw-twitter-action-icon'
            );

            icon.appendChild(makeIcon(kind));
            append(node, icon);

            return node;
        }

        async function saveGalleryFavoriteCategory(galleryHref, category) {
            try {
                const galleryUrl = new URL(galleryHref, location.href);
                const match = galleryUrl.pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?$/i);
                if (galleryUrl.origin !== location.origin || !match) throw new Error('Invalid gallery URL');
                const popupUrl = new URL('/gallerypopups.php', location.origin);
                popupUrl.searchParams.set('gid', match[1]);
                popupUrl.searchParams.set('t', match[2]);
                popupUrl.searchParams.set('act', 'addfav');
                const popupResponse = await window.fetch(popupUrl.href, {
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                if (!popupResponse?.ok) throw new Error(`Unable to load favorites (${popupResponse?.status || 'no response'})`);
                const popup = new window.DOMParser().parseFromString(await popupResponse.text(), 'text/html');
                const form = popup.querySelector('#galpop');
                if (!form) throw new Error('The site did not return the favorites form. Please sign in.');
                const result = await submitFavoriteFormLikeBrowser(form, popupUrl, category, '');
                if (!result?.ok) throw new Error(`Unable to save favorite (${result?.status || 'no response'})`);
                const text = await result.text();
                if (/login|sign in|please log in/i.test(text) && !/favorites updated/i.test(text)) {
                    throw new Error('Please sign in before saving a favorite.');
                }
                if (String(category) === '9') followedUploaderEntriesPromiseState.value = null;
                return true;
            } catch (error) {
                throw error;
            }
        }

        function showFavoritePickerError(error) {
            qs('.ehtw-browser-favorite-error')?.remove();
            const message = String(error?.message || 'Unable to save favorite. Please try again.');
            const toast = registerCreatedNode(create('div', 'ehtw-browser-favorite-error', message));
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'assertive');
            setStyleSafe(toast, 'position', 'fixed');
            setStyleSafe(toast, 'top', 'max(12px, env(safe-area-inset-top))');
            setStyleSafe(toast, 'left', '50%');
            setStyleSafe(toast, 'transform', 'translateX(-50%)');
            setStyleSafe(toast, 'z-index', '2147483647');
            setStyleSafe(toast, 'max-width', 'calc(100vw - 24px)');
            setStyleSafe(toast, 'box-sizing', 'border-box');
            setStyleSafe(toast, 'padding', '10px 14px');
            setStyleSafe(toast, 'border', '1px solid rgba(255,255,255,.18)');
            setStyleSafe(toast, 'border-radius', '12px');
            setStyleSafe(toast, 'background', '#b42318');
            setStyleSafe(toast, 'color', '#fff');
            setStyleSafe(toast, 'font', '600 14px/1.4 system-ui, sans-serif');
            setStyleSafe(toast, 'box-shadow', '0 6px 24px rgba(0, 0, 0, .3)');
            document.body.appendChild(toast);
            window.setTimeout(() => toast.remove(), 5000);
        }

        function toggleBrowserFavorite(galleryHref, control) {
            if (!control || control.dataset.ehtwFavoriteToggleSaving === 'true') return;
            if (!control.classList.contains('ehtw-liked')) {
                openBrowserFavoritePicker(galleryHref, control, () => {
                    control.classList.add('ehtw-liked');
                    control.title = 'Added to Favorites';
                });
                return;
            }

            control.dataset.ehtwFavoriteToggleSaving = 'true';
            control.setAttribute('aria-busy', 'true');
            saveGalleryFavoriteCategory(galleryHref, 'favdel')
                .then(() => {
                    control.classList.remove('ehtw-liked');
                    control.title = 'Add to Favorites';
                })
                .catch(showFavoritePickerError)
                .finally(() => {
                    delete control.dataset.ehtwFavoriteToggleSaving;
                    control.removeAttribute('aria-busy');
                });
        }

        function openBrowserFavoritePicker(galleryHref, anchor, onSaved = () => {}) {
            const galleryUrl = new URL(galleryHref, location.href);
            const match = galleryUrl.pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?$/i);
            if (galleryUrl.origin !== location.origin || !match) return;

            const existing = qs('.ehtw-browser-favorite-picker');
            if (existing) {
                existing.focus();
                try { existing.showPicker?.(); } catch (_) { existing.click(); }
                return;
            }

            const select = registerCreatedNode(create('select', 'ehtw-browser-favorite-picker'));
            select.setAttribute('aria-label', 'Choose a favorites folder');
            select.setAttribute('title', 'Choose a favorites folder');
            const placeholder = create('option', '', 'Choose a favorites folder…');
            placeholder.value = '';
            placeholder.selected = true;
            placeholder.disabled = true;
            select.appendChild(placeholder);
            for (let category = 0; category < 10; category += 1) {
                const option = create('option', '', `Favorites ${category}`);
                option.value = String(category);
                select.appendChild(option);
            }

            const bounds = anchor?.getBoundingClientRect?.();
            const left = Math.max(0, Math.min(Number(bounds?.left) || 0, window.innerWidth - 1));
            const top = Math.max(0, Math.min(Number(bounds?.top) || 0, window.innerHeight - 1));
            setStyleSafe(select, 'position', 'fixed');
            setStyleSafe(select, 'left', left + 'px');
            setStyleSafe(select, 'top', top + 'px');
            setStyleSafe(select, 'z-index', '2147483647');
            setStyleSafe(select, 'width', '1px');
            setStyleSafe(select, 'height', '1px');
            setStyleSafe(select, 'min-height', '1px');
            setStyleSafe(select, 'padding', '0');
            setStyleSafe(select, 'border', '0');
            setStyleSafe(select, 'opacity', '0');
            setStyleSafe(select, 'background', 'transparent');
            setStyleSafe(select, 'color', 'transparent');
            setStyleSafe(select, 'box-shadow', 'none');
            document.body.appendChild(select);

            let saving = false;
            let outsideDismissTimer = null;
            const removeOutsideHandler = () => document.removeEventListener('pointerdown', onOutsidePointerDown, true);
            const close = () => {
                if (outsideDismissTimer !== null) window.clearTimeout(outsideDismissTimer);
                removeOutsideHandler();
                select.remove();
            };
            const onOutsidePointerDown = (event) => {
                if (select.contains(event.target)) return;
                const nextFavoriteTrigger = event.target?.closest?.('.ehtw-twitter-action-heart, .ehtw-detail-favorite-action');
                // Mobile browsers may retarget a native picker selection to the
                // document before dispatching <select>'s change event. Keep the
                // focused select alive through that pointer sequence.
                if (document.activeElement === select && !nextFavoriteTrigger) return;
                if (outsideDismissTimer !== null) window.clearTimeout(outsideDismissTimer);
                outsideDismissTimer = window.setTimeout(() => {
                    outsideDismissTimer = null;
                    if (!saving && !select.value) close();
                }, 450);
            };
            addSpaPageEventListener(document, 'pointerdown', onOutsidePointerDown, true);
            select.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') close();
            });
            select.addEventListener('change', async () => {
                const category = select.value;
                if (!category || saving) return;
                if (outsideDismissTimer !== null) {
                    window.clearTimeout(outsideDismissTimer);
                    outsideDismissTimer = null;
                }
                saving = true;
                select.disabled = true;
                select.title = 'Saving favorite…';
                try {
                    await saveGalleryFavoriteCategory(galleryUrl.href, category);
                    onSaved({ folder: category, galleryHref: galleryUrl.href });
                    close();
                } catch (error) {
                    saving = false;
                    close();
                    showFavoritePickerError(error);
                }
            });
            select.focus();
            try { select.showPicker?.(); } catch (_) { select.click(); }
        }

        // 本轮无新增辅助函数。

        // 构建小尺寸灰色头像，不访问外部资源。
        function makeTwitterPlainAvatar(letter, className) {
            const avatar = create(
                'span',
                className,
                String(letter || 'E').charAt(0).toUpperCase()
            );

            return avatar;
        }

        function mountGalleryToplistCovers(root) {
            const group = root?.querySelector?.('.ehtw-gallery-toplists');
            if (!group) return;

            const sections = Array.from(group.children || [])
                .filter((section) => section.matches?.('.tdo'));
            const sectionHref = (section) => {
                const link = section.querySelector?.('p a[href]');
                return getToplistPageKey(link?.getAttribute('href') || link?.href || '');
            };
            const entriesByPeriod = new Map();
            let hiddenTags = null;
            const applyEntries = (href, entries) => {
                entriesByPeriod.set(href, entries);
                if (hiddenTags) {
                    const matching = sections.find((section) => sectionHref(section) === href);
                    if (matching) renderGalleryToplistCovers(matching, entries, hiddenTags);
                }
            };
            const onToplistData = (event) => {
                const detail = event?.detail;
                if (detail?.href && Array.isArray(detail.entries)) {
                    applyEntries(detail.href, detail.entries);
                }
            };
            addSpaPageEventListener(window, 'ehtw-toplist-data', onToplistData);

            const hiddenTagsPromise = requestHiddenMyTags().catch(() => new Set());
            hiddenTagsPromise.then((tags) => {
                hiddenTags = tags;
                entriesByPeriod.forEach((entries, href) => applyEntries(href, entries));
            });

            const shared = window.__EHTW_TOPLIST_ENTRIES__ || {};
            Object.entries(shared).forEach(([href, entries]) => applyEntries(href, entries));

            const CACHE_KEY = 'ehtw-search-toplist-data-v5';
            const CACHE_TTL = 60 * 60 * 1000;
            const requiresFullCandidates = (location.pathname.replace(/\/+$/, '') || '/') === '/toplist.php' && !location.search;
            const hasEnoughCandidates = (href) => {
                const entries = window.__EHTW_TOPLIST_ENTRIES__?.[href] || shared[href];
                return Array.isArray(entries) &&
                    entries.every((entry) => Array.isArray(entry?.tags)) &&
                    (!requiresFullCandidates || entries.length >= 50);
            };
            let saved = {};
            try {
                const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                if (parsed && typeof parsed === 'object') saved = parsed;
            } catch (_) {}
            Object.entries(saved).forEach(([href, value]) => {
                const key = getToplistPageKey(href);
                if (
                    key &&
                    value &&
                    Date.now() - Number(value.at || 0) < CACHE_TTL &&
                    Array.isArray(value.entries) &&
                    value.entries.every((entry) => Array.isArray(entry?.tags)) &&
                    (!requiresFullCandidates || Number(value.limit || value.entries.length) >= 50)
                ) {
                    publishToplistEntries(key, value.entries);
                }
            });

            const missingLongPeriodSections = sections.filter((section) => {
                const title = String(section.querySelector?.('p')?.textContent || '');
                return /past\s+year|all[\s-]*time/i.test(title) &&
                    !hasEnoughCandidates(sectionHref(section));
            });
            const extractEntries = window.__EHTW_EXTRACT_TOPLIST_ENTRIES__;
            if (typeof extractEntries !== 'function' || !missingLongPeriodSections.length) return;

            (async () => {
                for (let index = 0; index < missingLongPeriodSections.length; index += 1) {
                    const href = sectionHref(missingLongPeriodSections[index]);
                    if (!href || hasEnoughCandidates(href)) continue;
                    try {
                        const response = await window.fetch(href, {
                            credentials: 'same-origin',
                            cache: 'default'
                        });
                        if (!response?.ok) continue;
                        const page = new window.DOMParser().parseFromString(
                            await response.text(),
                            'text/html'
                        );
                        const entries = extractEntries(page, 50);
                        if (!entries.length) continue;
                        saved[href] = { at: Date.now(), limit: 50, entries };
                        try {
                            localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
                        } catch (_) {}
                        publishToplistEntries(href, entries);
                    } catch (_) {}
                    if (index < missingLongPeriodSections.length - 1) {
                        await new Promise((resolve) => window.setTimeout(resolve, 400));
                    }
                }
            })();
        }

        function transformGenericPage() {
            if (typeof isLogin !== 'undefined' && isLogin) {
                return;
            }

            const content = create(
                'div',
                'ehtw-generic-content'
            );

            append(center, content);

            const pathname =
                location.pathname.replace(/\/+$/, '') || '/';

            function canMove(node) {
                if (
                    !node ||
                    node.nodeType !== Node.ELEMENT_NODE
                ) {
                    return false;
                }

                if (node.matches(
                    'script, style, link, ins, ' +
                    '#ehtw-shell, #nb, .dp, template'
                )) {
                    return false;
                }

                if (
                    node === shell ||
                    node.contains(shell) ||
                    node.closest('#ehtw-shell') ||
                    node.closest('#nb')
                ) {
                    return false;
                }

                try {
                    const computed = getComputedStyle(node);

                    if (
                        computed.display === 'none' ||
                        computed.visibility === 'hidden'
                    ) {
                        return false;
                    }
                } catch (_) {}

                return true;
            }

            const originals = Array.from(
                document.body.children
            );

            originals.forEach(node => {
                if (!canMove(node)) return;

                move(node, content);
            });

            if (pathname === '/toplist.php') {
                reorderGalleryToplistSections(content);
            }

            if (pathname === '/watched') {
                const rawText = textOf(content);

                if (
                    /You do not have any watched tags|No hits found/i
                        .test(rawText)
                ) {
                    addClassSafe(
                        content,
                        'ehtw-generic-empty'
                    );
                }
            }

            // 通用页面没有原站搜索框时，右栏使用独立 GET 表单。
            // 不访问或修改任何登录表单。
            if (!qs('#searchbox')) {
                ensureRightSearchForm();
            }

            if (pathname === '/toplist.php') {
                mountGalleryToplistCovers(content);
            }
        }

        function ensureRightSearchForm() {
            if (!right) return null;

            right.classList.add('ehtw-toplist-only-sidebar');

            const existing = qs(
                '.ehtw-right-search-form',
                right
            );

            if (existing) return existing;

            // 新建表单不使用 #f_search，避免与原站搜索控件冲突。
            const host = registerCreatedNode(
                create('section', 'ehtw-right-search')
            );

            const form = registerCreatedNode(
                create('form', 'ehtw-right-search-form')
            );

            form.method = 'GET';
            form.action = '/';
            form.setAttribute('role', 'search');

            const wrapper = create(
                'div',
                'ehtw-right-search-wrap'
            );

            const icon = makeIcon('search');
            addClassSafe(icon, 'ehtw-right-search-icon');

            const input = create('input');

            addClassSafe(
                input,
                'ehtw-right-search-input'
            );

            input.type = 'search';
            input.name = 'f_search';
            input.placeholder = 'Search';
            input.setAttribute(
                'aria-label',
                'Search galleries'
            );

            append(wrapper, icon);
            append(wrapper, input);
            append(form, wrapper);
            append(host, form);
            append(host, makeSearchToplistPanel());

            // 放在右栏第一个元素之前，不影响 Trending、
            // Who to follow 和页脚的原始节点。
            right.insertBefore(
                host,
                right.firstChild
            );

            return form;
        }

        // 作者优先取 artist 标签，其次 group 标签，最后取标题开头的方括号。
        // 来源、语言这类方括号不是作者；“X - 标题”常是角色名，不猜。
        function parseTitleAuthor(title) {
            const match = String(title || '')
                .trim()
                .match(/^(?:\([^)]*\)\s*)?\[([^\]]+)\]/);

            if (!match) return '';

            const inner = match[1].trim();
            const nested = inner.match(/\(([^()]+)\)\s*$/);
            const name = (nested ? nested[1] : inner).trim();

            return /^(patreon|pixiv|fanbox|fantia|twitter|x|skeb|gumroad|subscribestar|ko-?fi|dlsite|fanza|request|commission|english|chinese|japanese|korean|ai generated|decensored|digital)$/i
                .test(name)
                ? ''
                : name;
        }

        function pickAuthor(rawTags, title) {
            const fromTitle = parseTitleAuthor(title);

            const raw =
                rawTags.find((tag) => /^artist:/i.test(tag)) ||
                rawTags.find((tag) => /^group:/i.test(tag));

            if (raw) {
                const name = raw.replace(/^[a-z]+:/i, '');

                return {
                    // 标题里的写法和标签相同时，用标题的大小写。
                    name: fromTitle.toLowerCase() === name.toLowerCase()
                        ? fromTitle
                        : name,
                    href: '/tag/' + encodeTagPath(raw)
                };
            }

            return fromTitle
                ? {
                    name: fromTitle,
                    href: '/?f_search=' + encodeURIComponent(
                        '"' + fromTitle + '"'
                    )
                }
                : null;
        }

        function readPageAuthorTags(root) {
            return Array.from(
                root.querySelectorAll(
                    'a[id^="ta_artist:"], a[id^="ta_group:"]'
                )
            ).map((link) =>
                link.id.replace(/^ta_/, '').replace(/_/g, ' ')
            );
        }

        function showAuthorName(node, author) {
            const link = create('a', '', author.name);

            link.href = author.href;
            node.textContent = '';
            append(node, link);
        }

        // 头像字母跟随作者名；颜色仍是分类色。
        function syncAvatarLetter(root) {
            const letter = qs('.ehtw-avatar-letter', root);
            const name = qs('.ehtw-author-name a', root);

            if (letter && name) {
                letter.textContent = (
                    Array.from(name.textContent.trim())[0] || '?'
                ).toUpperCase();
            }
        }

        function formatHandle(name) {
            return '@' + name.replace(/\s+/g, '_');
        }

        // 右上角三个点的菜单。用 fixed 定位，避免被卡片裁切。
        function closeActionMenus() {
            const openMenus = document.getElementsByClassName('ehtw-menu-open');
            if (!openMenus.length) return;

            Array.from(openMenus).forEach((node) => {
                node.classList.remove('ehtw-menu-open');
            });
        }

        function makeActionMenu() {
            const wrap = create('span', 'ehtw-menu-wrap');
            const button = create('button', 'ehtw-menu-button');
            const panel = create('div', 'ehtw-menu');

            button.type = 'button';
            button.title = 'More';
            button.setAttribute('aria-label', 'More');
            button.appendChild(makeIcon('more'));

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const wasOpen = wrap.classList.contains('ehtw-menu-open');

                closeActionMenus();

                if (wasOpen) return;

                wrap.classList.add('ehtw-menu-open');

                const box = button.getBoundingClientRect();
                const height = panel.getBoundingClientRect().height;
                const below = box.bottom + 4 + height <
                    window.innerHeight - 8;

                panel.style.right =
                    Math.max(
                        8,
                        document.documentElement.clientWidth - box.right
                    ) + 'px';
                panel.style.top = below
                    ? box.bottom + 4 + 'px'
                    : Math.max(8, box.top - height - 4) + 'px';
            });

            append(wrap, button);
            append(wrap, panel);

            return { wrap, panel };
        }

        function addMenuItem(panel, label, action) {
            const item = create('button', 'ehtw-menu-item', label);

            item.type = 'button';
            item.addEventListener('click', () => {
                closeActionMenus();
                action();
            });

            append(panel, item);
        }

        // 收藏数和评论数只存在于画廊页，官方 API 也不提供。
        function readFavoriteCount(text) {
            const source = String(text || '');
            const digits = source.match(/\d[\d,]*/);

            if (digits) {
                return Number(digits[0].replace(/,/g, ''));
            }

            if (/\bonce\b/i.test(source)) return 1;
            if (/\bnever\b/i.test(source)) return 0;

            return null;
        }

        function readCommentCount(root) {
            const shown = root.querySelectorAll('.c1').length;
            const hidden = (
                root.querySelector('#chd')?.textContent || ''
            ).match(/there (?:is|are) (\d+) more comments?/i);

            return shown + (hidden ? Number(hidden[1]) : 0);
        }

        function formatCount(value) {
            if (value < 1000) return String(value);

            const units = value >= 1000000
                ? [1000000, 'M']
                : [1000, 'K'];

            return (value / units[0])
                .toFixed(1)
                .replace(/\.0$/, '') + units[1];
        }

        // 列表卡片的菜单取画廊页的操作链接；只留原站同域、能直接打开的。
        function readGalleryActions(root) {
            return Array.from(root.querySelectorAll('#gd5 a'))
                .map((link) => {
                    const popup = (
                        link.getAttribute('onclick') || ''
                    ).match(/popUp\('([^']+)'/);
                    const href = link.getAttribute('href') || '';
                    const url = popup ? popup[1] : href;

                    return /^https:\/\/e-hentai\.org\//.test(url)
                        ? [link.textContent.trim(), url]
                        : null;
                })
                .filter(Boolean);
        }

        // 一次只请求一页，只请求接近可视区的推文，结果缓存到本地。
        // 一旦遇到限流提示就停止，并在一段时间内不再请求。
        function startGalleryStatsLoader() {
            const CACHE_KEY = isFollowingAuthorsPage
                ? 'ehtw-gallery-following-author-stats-v1'
                : 'ehtw-gallery-stats-v6';
            const CACHE_TTL = 6 * 60 * 60 * 1000;
            const CACHE_LIMIT = 800;
            const REQUEST_GAP = 1500;
            const BLOCK_TIME = 30 * 60 * 1000;

            const tweets = qsa('[data-ehtw-href]');
            const followedAuthorTags = new Set();
            const followedUploaderNames = new Set();
            let followedAuthorTagsLoadFailed = false;
            const followedUploaderNamesPromise = requestWatchedUploaderNames()
                .then((entries) => entries.forEach((entry) => followedUploaderNames.add(entry.key)))
                .catch(() => {});

            function updateCardModeration(tweet, stats) {
                buildCardModerationActions(
                    tweet,
                    Array.isArray(stats.authorTags) && stats.authorTags.length
                        ? stats.authorTags
                        : tweet._ehtwListArtistTags,
                    stats.author || tweet._ehtwListAuthor,
                    stats.uploader || tweet._ehtwListUploader,
                    followedAuthorTags,
                    followedUploaderNames,
                    stats.uploaderHref || tweet._ehtwListUploaderHref || ''
                );
            }

            function setFollowingCardVisibility(tweet, visible) {
                tweet.hidden = !visible;
                tweet.classList.toggle('ehtw-following-hidden', !visible);
                if (visible) {
                    tweet.style.removeProperty('display');
                } else {
                    tweet.style.setProperty('display', 'none', 'important');
                }
            }

            function getCardCreatorTags(tweet, stats) {
                const sourceTag = normalizeCreatorFollowTag(
                    tweet._ehtwFollowingSourceTag || ''
                );
                if (isFollowingAuthorsPage && sourceTag) return [sourceTag];

                const tags = qsa('.ehtw-tags a[href]', tweet)
                    .map((link) => {
                        try {
                            const url = new URL(
                                link.getAttribute('href') || link.href,
                                location.href
                            );
                            const match = url.pathname.match(
                                /^\/tag\/((?:artist|group):[^/]+)$/i
                            );
                            return match ? decodeURIComponent(match[1]) : '';
                        } catch (_) {
                            return '';
                        }
                    })
                    .filter(Boolean);

                const sourceTags = tags.length
                    ? tags
                    : Array.isArray(stats.authorTags)
                        ? stats.authorTags
                        : [];

                return Array.from(new Set(
                    sourceTags
                        .filter((tag) => /^(?:artist|group):/i.test(tag))
                        .map(normalizeCreatorFollowTag)
                        .filter(Boolean)
                ));
            }

            const followedAuthorTagsPromise = (async () => {
                try {
                    (await requestWatchedCreatorTags()).forEach((tag) => {
                        followedAuthorTags.add(tag);
                    });
                } catch (_) {
                    followedAuthorTagsLoadFailed = true;
                }

                if (isFollowingAuthorsPage) {
                    const status = qs('#ehtw-following-status');
                    if (status) {
                        status.textContent = followedAuthorTagsLoadFailed
                            ? 'Could not read followed author tags. Open My Tags and try again.'
                            : followedAuthorTags.size
                                ? `Showing galleries from ${followedAuthorTags.size} artist/group tags watched in My Tags.`
                                : 'No artist or group tags are marked Watched. Use “关注” on a gallery card to add one in My Tags.';
                    }

                    if (!followedAuthorTags.size) {
                        tweets.forEach((tweet) => {
                            setFollowingCardVisibility(tweet, false);
                            tweet.classList.remove('ehtw-following-checking');
                        });
                    }
                }
            })();

            let cache = { blockedUntil: 0, items: {} };

            try {
                const saved = JSON.parse(
                    localStorage.getItem(CACHE_KEY) || 'null'
                );

                if (saved && saved.items) cache = saved;
            } catch (_) {}

            function saveCache() {
                try {
                    const keys = Object.keys(cache.items);

                    if (keys.length > CACHE_LIMIT) {
                        keys
                            .sort((a, b) =>
                                cache.items[a].at - cache.items[b].at
                            )
                            .slice(0, keys.length - CACHE_LIMIT)
                            .forEach((key) => {
                                delete cache.items[key];
                            });
                    }

                    localStorage.setItem(
                        CACHE_KEY,
                        JSON.stringify(cache)
                    );
                } catch (_) {}
            }

            Promise.all([followedAuthorTagsPromise, followedUploaderNamesPromise]).then(() => {
                tweets.forEach((tweet) => {
                    const href = tweet.getAttribute('data-ehtw-href');
                    const saved = href ? cache.items[href] : null;
                    updateCardModeration(tweet, saved || {
                        authorTags: tweet._ehtwListArtistTags || [],
                        author: tweet._ehtwListAuthor,
                        uploader: tweet._ehtwListUploader
                    });
                });
            });

            function showThumbnailMeta(tweet, stats) {
                const name = qs('.ehtw-author-name', tweet);

                if (name && stats.author) {
                    showAuthorName(name, stats.author);
                    syncAvatarLetter(tweet);
                }

                if (!tweet.classList.contains('ehtw-tweet-pending')) {
                    return;
                }

                tweet.classList.remove('ehtw-tweet-pending');

                const handle = qs('.ehtw-handle', tweet);

                if (stats.uploader) {
                    const uploader = {
                        name: stats.uploader,
                        href: stats.uploaderHref
                    };

                    if (name && !qs('a', name)) {
                        showAuthorName(name, uploader);
                        syncAvatarLetter(tweet);
                    }

                    if (handle) {
                        showAuthorName(handle, {
                            name: formatHandle(stats.uploader),
                            href: stats.uploaderHref
                        });
                    }
                }

                const tags = qs('.ehtw-tags', tweet);

                if (!tags || tags.children.length) return;

                const visibleTags = isFollowingAuthorsPage
                    ? stats.tags.filter(([label, href]) =>
                        isCreatorTagValue(label) || isCreatorTagValue(href)
                    )
                    : stats.tags;
                visibleTags.forEach(([label, href]) => {
                    const tag = create(
                        'a',
                        'gt ehtw-hashtag',
                        '#' + parseTwitterTag(label).display
                    );

                    tag.href = href;
                    append(tags, tag);
                });
            }

            function showTweetMenu(tweet, stats) {
                const author = qs('.ehtw-tweet-author', tweet);
                if (!author) return;

                let menuWrap = qs('.ehtw-card-more-menu', author);
                if (!menuWrap && (!stats.actions || !stats.actions.length)) return;

                let menuPanel = qs('.ehtw-menu', menuWrap);
                if (!menuWrap) {
                    const menu = makeActionMenu();
                    menuWrap = menu.wrap;
                    menuWrap.classList.add('ehtw-card-more-menu');
                    menuPanel = menu.panel;
                    append(author, menuWrap);
                }

                if (menuPanel.dataset.ehtwGalleryActionsLoaded) return;
                (stats.actions || []).forEach(([label, url]) => {
                    const item = create('a', 'ehtw-menu-item', label);
                    item.href = url;
                    item.target = '_blank';
                    item.rel = 'noopener noreferrer';
                    append(menuPanel, item);
                });
                menuPanel.dataset.ehtwGalleryActionsLoaded = 'true';
            }

            function showStats(tweet, stats) {
                showThumbnailMeta(tweet, stats);
                showTweetMenu(tweet, stats);
                updateCardModeration(tweet, stats);

                if (isFollowingAuthorsPage) {
                    const cardCreatorTags = getCardCreatorTags(tweet, stats);
                    const matchesFollowedAuthor =
                        !followedAuthorTagsLoadFailed &&
                        cardCreatorTags.some((tag) =>
                            followedAuthorTags.has(tag)
                        );
                    setFollowingCardVisibility(tweet, matchesFollowedAuthor);
                    tweet.classList.remove('ehtw-following-checking');
                }

                const comments = qs('.ehtw-stat-comments', tweet);
                const favorites = qs('.ehtw-stat-favorites', tweet);

                if (comments) {
                    comments.textContent = formatCount(stats.comments);
                    comments.title =
                        stats.comments.toLocaleString() + ' comments';
                }

                if (favorites && stats.favorites !== null) {
                    favorites.textContent = formatCount(stats.favorites);
                    favorites.title =
                        stats.favorites.toLocaleString() + ' favorites';
                }
            }

            // 只保留接近可视区的推文，每次取离屏幕中心最近的一条。
            const near = new Set();
            const failures = new Map();
            let running = false;
            let stopped = false;
            let observer = null;

            function block() {
                stopped = true;
                near.clear();
                cache.blockedUntil = Date.now() + BLOCK_TIME;
                saveCache();
                console.warn(
                    '[EH Twitter Style] Stats paused: rate limited'
                );
            }

            function isRateLimited(response, text) {
                if (
                    response.status === 429 ||
                    response.status === 403
                ) {
                    return true;
                }

                // 限流页很短，也没有画廊结构；标题里的词不算。
                return (
                    text.length < 3000 &&
                    !text.includes('id="favcount"') &&
                    /temporarily banned|too fast|excessive/i.test(text)
                );
            }

            async function fetchPage(url) {
                const response = await fetch(url, {
                    credentials: 'same-origin'
                });

                return {
                    response,
                    text: await response.text()
                };
            }

            function wait(ms) {
                return new Promise((resolve) => {
                    setTimeout(resolve, ms);
                });
            }

            function finish(tweet) {
                failures.delete(tweet);

                if (observer) observer.unobserve(tweet);
            }

            async function loadOne(tweet) {
                if (isFollowingAuthorsPage) {
                    await followedAuthorTagsPromise;
                    if (!followedAuthorTags.size) {
                        setFollowingCardVisibility(tweet, false);
                        finish(tweet);
                        return;
                    }
                }

                const href = tweet.getAttribute('data-ehtw-href');

                const { response, text } = await fetchPage(href);

                if (isRateLimited(response, text)) {
                    block();
                    return;
                }

                // 内容警告页不代替用户点击 View Gallery，跳过该条统计。
                if (
                    !text.includes('id="favcount"') &&
                    /Content Warning/i.test(text)
                ) {
                    finish(tweet);
                    return;
                }

                // DOMParser 的文档是惰性的，不执行脚本，也不加载图片。
                const page = new DOMParser().parseFromString(
                    text,
                    'text/html'
                );

                const favcount = page.querySelector('#favcount');

                if (!favcount) {
                    finish(tweet);
                    return;
                }

                const uploader = page.querySelector('#gdn a');

                const stats = {
                    comments: readCommentCount(page),
                    favorites: readFavoriteCount(favcount.textContent),
                    uploader: uploader
                        ? uploader.textContent.trim()
                        : '',
                    uploaderHref: uploader
                        ? uploader.getAttribute('href')
                        : '',
                    tags: Array.from(
                        page.querySelectorAll('#taglist a')
                    )
                        .filter((tag) => !isFollowingAuthorsPage ||
                            isCreatorTagValue(tag.getAttribute('title')) ||
                            isCreatorTagValue(tag.id) ||
                            isCreatorTagValue(tag.getAttribute('href'))
                        )
                        .slice(0, 6)
                        .map((tag) => [
                            tag.textContent.trim(),
                            tag.getAttribute('href')
                        ]),
                    actions: readGalleryActions(page),
                    author: pickAuthor(
                        readPageAuthorTags(page),
                        page.querySelector('#gj')?.textContent ||
                            page.querySelector('#gn')?.textContent
                    ),
                    authorTags: readPageAuthorTags(page).filter((tag) =>
                        /^(?:artist|group):/i.test(tag)
                    ),
                    at: Date.now()
                };

                cache.items[href] = stats;
                saveCache();
                showStats(tweet, stats);
                finish(tweet);
            }

            function nextTweet() {
                const middle = window.innerHeight / 2;
                let best = null;
                let bestDistance = Infinity;

                near.forEach((tweet) => {
                    const box = tweet.getBoundingClientRect();
                    const distance = Math.abs(
                        box.top + box.height / 2 - middle
                    );

                    if (distance < bestDistance) {
                        best = tweet;
                        bestDistance = distance;
                    }
                });

                return best;
            }

            async function pump() {
                if (running) return;

                running = true;

                while (!stopped) {
                    if (document.hidden) {
                        await new Promise((resolve) => {
                            addSpaPageEventListener(
                                document,
                                'visibilitychange',
                                resolve,
                                { once: true }
                            );
                        });
                        continue;
                    }

                    const tweet = nextTweet();

                    if (!tweet) break;

                    near.delete(tweet);

                    let delay = REQUEST_GAP;

                    try {
                        await loadOne(tweet);
                    } catch (_) {
                        // 切后台、断网都会到这里，只重试这一条，不算限流。
                        const count = (failures.get(tweet) || 0) + 1;

                        failures.set(tweet, count);
                        delay = REQUEST_GAP * (count + 1);

                        if (count < 3) {
                            near.add(tweet);
                        } else {
                            finish(tweet);
                        }
                    }

                    await wait(delay);
                }

                running = false;
            }

            const pending = [];

            tweets.forEach((tweet) => {
                const saved = cache.items[
                    tweet.getAttribute('data-ehtw-href')
                ];

                if (
                    saved &&
                    Date.now() - saved.at < CACHE_TTL &&
                    (!isFollowingAuthorsPage || Array.isArray(saved.authorTags))
                ) {
                    if (isFollowingAuthorsPage) {
                        followedAuthorTagsPromise.then(() => showStats(tweet, saved));
                    } else {
                        showStats(tweet, saved);
                    }
                } else {
                    pending.push(tweet);
                }
            });

            const ensureObserver = () => {
                if (
                    observer ||
                    stopped ||
                    Date.now() < cache.blockedUntil ||
                    typeof IntersectionObserver !== 'function'
                ) {
                    return;
                }

                observer = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            near.add(entry.target);
                        } else {
                            near.delete(entry.target);
                        }
                    });

                    pump();
                }, { rootMargin: '300px 0px' });
            };

            ensureObserver();
            pending.forEach((tweet) => observer?.observe(tweet));

            return (additionalTweets) => {
                if (!Array.isArray(additionalTweets) || stopped) return;
                ensureObserver();
                additionalTweets.forEach((tweet) => {
                    const href = tweet.getAttribute('data-ehtw-href');
                    const saved = href ? cache.items[href] : null;
                    if (saved && Date.now() - saved.at < CACHE_TTL) {
                        showStats(tweet, saved);
                    } else {
                        observer?.observe(tweet);
                    }
                });
            };
        }

        function buildCardModerationActions(
            tweet,
            rawCreatorTags,
            author,
            uploaderName,
            followedAuthorTags = new Set(),
            followedUploaderNames = new Set(),
            uploaderHref = ''
        ) {
            const authorRow = qs('.ehtw-tweet-author', tweet);
            if (!authorRow) return;

            const creatorTags = Array.from(new Set(
                (Array.isArray(rawCreatorTags) ? rawCreatorTags : [])
                    .filter((tag) => /^(?:artist|group):/i.test(tag))
                    .map((tag) => String(tag).trim())
                    .filter(Boolean)
            ));

            // 仅把 artist/group 视为可关注作者标签，不会从语言、类别等标签推断。
            if (!creatorTags.length && author?.name) {
                const authorHref = String(author.href || '');
                creatorTags.push(
                    /\/tag\/group:/i.test(authorHref)
                        ? `group:${author.name}`
                        : `artist:${author.name}`
                );
            }

            qs('.ehtw-follow-choice-wrap', authorRow)?.remove();
            qsa('.ehtw-card-follow-button:not(.ehtw-menu-button)', authorRow)
                .forEach((button) => button.remove());

            const uniqueTags = Array.from(new Set(creatorTags));
            const followOne = (tag, onUpdated = () => {}) => {
                toggleWatchedTagInMyTags(tag, (success, isWatched) => {
                    const normalized = normalizeCreatorFollowTag(tag);
                    if (success && isWatched) followedAuthorTags.add(normalized);
                    else if (success) followedAuthorTags.delete(normalized);
                    onUpdated(success, isWatched);
                });
            };

            const moreMenu = () => {
                let wrap = qs('.ehtw-card-more-menu', authorRow);
                if (!wrap) {
                    const menu = makeActionMenu();
                    wrap = menu.wrap;
                    wrap.classList.add('ehtw-card-more-menu');
                    authorRow.appendChild(wrap);
                }
                return {
                    wrap,
                    panel: qs('.ehtw-menu', wrap)
                };
            };

            if (uniqueTags.length === 1) {
                const tag = uniqueTags[0];
                const normalized = normalizeCreatorFollowTag(tag);
                const alreadyFollowed = followedAuthorTags.has(normalized);
                const button = create(
                    'button',
                    'ehtw-card-follow-button',
                    alreadyFollowed ? '取消关注' : '关注'
                );
                button.type = 'button';
                button.setAttribute(
                    'aria-label',
                    `${alreadyFollowed ? '取消关注' : '关注'}${tag.startsWith('group:') ? ' Group' : ' Artist'} ${tag.replace(/^(?:artist|group):/i, '')}`
                );
                button.setAttribute('aria-pressed', String(alreadyFollowed));
                if (!(rawCreatorTags || []).some((item) => /^(?:artist|group):/i.test(item))) {
                    button.title = `按标题识别的作者名创建 Watched 标签：${tag}`;
                }
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    button.disabled = true;
                    button.textContent = '保存中…';
                    followOne(tag, (success, isWatched) => {
                        if (!success) {
                            button.disabled = false;
                            button.textContent = followedAuthorTags.has(normalized) ? '取消关注' : '关注';
                            return;
                        }
                        button.disabled = false;
                        button.textContent = isWatched ? '取消关注' : '关注';
                        button.setAttribute('aria-pressed', String(isWatched));
                    });
                });

                const existingMore = qs('.ehtw-card-more-menu', authorRow);
                if (existingMore) authorRow.insertBefore(button, existingMore);
                else authorRow.appendChild(button);
            } else if (uniqueTags.length > 1) {
                const menu = makeActionMenu();
                menu.wrap.classList.add('ehtw-follow-choice-wrap');
                const choiceButton = qs('.ehtw-menu-button', menu.wrap);
                const updateChoiceLabel = () => {
                    choiceButton.textContent = uniqueTags.some((tag) =>
                        followedAuthorTags.has(normalizeCreatorFollowTag(tag))
                    ) ? '已关注 ▾' : '关注 ▾';
                };
                updateChoiceLabel();
                choiceButton.classList.add(
                    'ehtw-card-follow-button',
                    'ehtw-follow-choice-button'
                );
                choiceButton.title = '选择关注 Artist 或 Group';
                choiceButton.setAttribute('aria-label', '选择关注 Artist 或 Group');

                uniqueTags.forEach((tag) => {
                    const type = tag.startsWith('group:') ? 'Group' : 'Artist';
                    const normalized = normalizeCreatorFollowTag(tag);
                    const alreadyFollowed = followedAuthorTags.has(normalized);
                    addMenuItem(
                        menu.panel,
                        `${alreadyFollowed ? '取消关注' : '关注'} ${type} · ${tag.replace(/^(?:artist|group):/i, '')}`,
                        () => followOne(tag, () => updateChoiceLabel())
                    );
                });

                const existingMore = qs('.ehtw-card-more-menu', authorRow);
                if (existingMore) authorRow.insertBefore(menu.wrap, existingMore);
                else authorRow.appendChild(menu.wrap);
            }

            const uploader = String(uploaderName || '').trim();
            if (uploader && uploader.toLowerCase() !== 'unknown') {
                const { panel: menuPanel } = moreMenu();

                const uploaderKey = normalizeUploaderName(uploader);
                let followUploaderItem = qs('.ehtw-menu-follow-uploader', menuPanel);
                if (!followUploaderItem) {
                    followUploaderItem = create(
                        'button',
                        'ehtw-menu-item ehtw-menu-follow-uploader'
                    );
                    followUploaderItem.type = 'button';
                    append(menuPanel, followUploaderItem);
                }
                const updateUploaderFollowLabel = () => {
                    const isFollowed = followedUploaderNames.has(uploaderKey);
                    followUploaderItem.textContent = isFollowed
                        ? `取消关注上传者 ${uploader}`
                        : `关注上传者 ${uploader}`;
                    followUploaderItem.setAttribute('aria-pressed', String(isFollowed));
                };
                updateUploaderFollowLabel();
                followUploaderItem.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    followUploaderItem.disabled = true;
                    followUploaderItem.textContent = '保存中…';
                    followUploaderViaFavorites(
                        uploader,
                        tweet.getAttribute('data-ehtw-href'),
                        (success, isWatched, reason) => {
                        if (success && isWatched) followedUploaderNames.add(uploaderKey);
                        else if (success) followedUploaderNames.delete(uploaderKey);
                        followUploaderItem.disabled = false;
                        updateUploaderFollowLabel();
                        if (!success && reason) {
                            followUploaderItem.title = reason;
                        }
                    });
                };

                let blockItem = qs('.ehtw-menu-block-uploader', menuPanel);
                if (!blockItem) {
                    blockItem = create(
                        'button',
                        'ehtw-menu-item ehtw-menu-block-uploader'
                    );
                    blockItem.type = 'button';
                    append(menuPanel, blockItem);
                }
                blockItem.textContent = `屏蔽上传者 ${uploader}`;
                blockItem.setAttribute(
                    'aria-label',
                    `在 E-Hentai 原生设置中屏蔽上传者 ${uploader}`
                );
                blockItem.onclick = () => {
                    closeActionMenus();
                    const target = new URL('/uconfig.php', location.origin);
                    target.hash = `ehtw_block_uploader=${encodeURIComponent(uploader)}`;
                    navigatePage(target.href);
                };
            }
        }

        function createTweet(row) {
            // Thumbnail 模式的单元格没有上传者和标签，
            // 这两项由 startGalleryStatsLoader 从画廊页补齐。
            const isThumbnail = !!row && row.matches('.gl1t');
            const galleryLink = findGalleryListLink(row);
            if (!row || !galleryLink) return null;

            const categoryNode = qs(
                '.gl1c .cn, .gl5t .cs, .gl1m .cs, .gl1e .cs, .gl3e .cn',
                row
            );

            const categoryName = textOf(
                categoryNode,
                'Gallery'
            );

            const categoryClass =
                getCategoryClass(categoryNode);

            neutralizeHoverHandlers(row);

            const galleryHref =
                galleryLink.getAttribute('href') || '';

            const uploader = findUploader(row);
            const postedNode = findPostedNode(row);
            const ratingNode = findRating(row);
            const downloadNode = findDownload(row);
            const pageNode = findPageCount(row);

            const torrentLink = downloadNode
                ? qs('a[href]', downloadNode)
                : null;

            const torrentTitle = downloadNode
                ? (
                    qs('img[title]', downloadNode)
                        ?.getAttribute('title') ||
                    ''
                )
                : '';

            const image = qs(
                '.glthumb img[data-src], .glthumb img[src], ' +
                '.gl3t img[data-src], .gl3t img[src], ' +
                '.gl1e img[data-src], .gl1e img[src], ' +
                '.gl1m img[data-src], .gl1m img[src]',
                row
            );

            const tweet = create(
                'article',
                'ehtw-tweet'
            );

            if (isFollowingFeedPage) {
                tweet.classList.add('ehtw-following-checking');
            }

            tweet.setAttribute('data-ehtw-href', galleryHref);

            if (isThumbnail) {
                tweet.classList.add(
                    'ehtw-thumb-tweet',
                    'ehtw-tweet-pending'
                );
            }

            const avatar = makeAvatar(
                categoryName,
                categoryClass
            );

            const content = create(
                'div',
                'ehtw-tweet-content'
            );

            const author = create(
                'div',
                'ehtw-tweet-author'
            );

            const authorName = create(
                'span',
                'ehtw-author-name'
            );

            const titleText = textOf(
                qs('.glink', galleryLink) || galleryLink
            );

            const listAuthor = pickAuthor(
                qsa('.gt[title], .gtl[title], .gtw[title]', row)
                    .map((tag) => tag.getAttribute('title')),
                titleText
            );
            const listCreatorTags = qsa(
                '.gt[title], .gtl[title], .gtw[title]',
                row
            )
                .map((tag) => tag.getAttribute('title'))
                .filter((tag) => /^(?:artist|group):/i.test(tag || ''));

            tweet._ehtwListAuthor = listAuthor;
            tweet._ehtwListUploader = uploader.name;
            tweet._ehtwListUploaderHref = uploader.link?.getAttribute('href') || '';

            const handleNode = create('span', 'ehtw-handle');

            if (listAuthor) {
                showAuthorName(authorName, listAuthor);
            } else if (uploader.link) {
                showAuthorName(authorName, {
                    name: uploader.name,
                    href: uploader.link.getAttribute('href')
                });
            } else {
                authorName.textContent = isThumbnail
                    ? categoryName
                    : uploader.name;
            }

            if (uploader.link) {
                setTextSafe(uploader.link, formatHandle(uploader.name));
                move(uploader.link, handleNode);
            }

            append(author, authorName);

            append(author, handleNode);

            const fullTime = textOf(postedNode) || findRowTimestamp(row);
            if (fullTime) {

                const time = create(
                    'span',
                    'ehtw-time',
                    formatTwitterTime(fullTime)
                );

                time.title = fullTime;

                append(
                    author,
                    create(
                        'span',
                        'ehtw-dot',
                        '·'
                    )
                );

                append(author, time);

                if (postedNode) {
                    move(postedNode, content);

                    setStyleSafe(
                        postedNode,
                        'display',
                        'none'
                    );
                }
            }

            if (categoryNode) {
                append(
                    author,
                    create(
                        'span',
                        'ehtw-dot ehtw-category-dot',
                        '·'
                    )
                );

                move(categoryNode, author);
            }

            append(content, author);

            const title = create(
                'div',
                'ehtw-tweet-title'
            );

            const tags = create(
                'div',
                'ehtw-tags'
            );

            extractListTags(row, tags, isFollowingAuthorsPage);

            move(galleryLink, title);
            append(content, title);

            if (tags.children.length || isThumbnail) {
                append(content, tags);
            }

            tweet._ehtwListArtistTags = listCreatorTags;
            buildCardModerationActions(
                tweet,
                listCreatorTags,
                listAuthor,
                uploader.name,
                new Set(),
                new Set(),
                tweet._ehtwListUploaderHref
            );

            if (image) {
                const styleText =
                    image.getAttribute('style') || '';

                const widthMatch = styleText.match(
                    /(?:^|;)\s*width\s*:\s*([\d.]+)px/i
                );

                const heightMatch = styleText.match(
                    /(?:^|;)\s*height\s*:\s*([\d.]+)px/i
                );

                const width = widthMatch
                    ? Number(widthMatch[1])
                    : parseFloat(image.style.width);

                const height = heightMatch
                    ? Number(heightMatch[1])
                    : parseFloat(image.style.height);

                const ratio =
                    Number.isFinite(width) &&
                    Number.isFinite(height) &&
                    width > 0 &&
                    height > 0
                        ? width / height
                        : 1;

                const media = create(
                    'div',
                    'ehtw-media'
                );

                setStyleSafe(
                    media,
                    '--ehtw-ar',
                    String(ratio)
                );

                const link = create(
                    'a',
                    'ehtw-media-link'
                );

                link.href = galleryHref;

                move(image, link);
                prepareImage(image);

                append(media, link);
                append(content, media);
            }

            const actions = create(
                'div',
                'ehtw-twitter-actions'
            );

            const reply = makeTweetAction(
                'reply',
                galleryHref + '#cdiv'
            );

            append(
                reply,
                create(
                    'span',
                    'ehtw-action-number ehtw-stat-comments'
                )
            );

            append(actions, reply);

            // 种子数据只取原站 .gldown。
            // 存在原生 a 才允许触发下载弹窗。
            const repost = makeTweetAction('repost');

            if (downloadNode) {
                move(downloadNode, repost);

                addClassSafe(
                    downloadNode,
                    'ehtw-repost-native'
                );
            }

            if (torrentLink) {
                addClassSafe(
                    repost,
                    'ehtw-repost-available'
                );

                repost.title =
                    torrentTitle || 'Show torrents';
            } else {
                addClassSafe(
                    repost,
                    'ehtw-repost-unavailable'
                );

                repost.title =
                    torrentTitle || 'No torrents available';
            }

            append(actions, repost);

            let favoriteHref = '';

            try {
                const url = new URL(
                    galleryHref,
                    location.href
                );

                const match = url.pathname.match(
                    /^\/g\/(\d+)\/([0-9a-f]+)\/?$/i
                );

                if (
                    url.origin === location.origin &&
                    match
                ) {
                    favoriteHref =
                        '/gallerypopups.php?gid=' +
                        encodeURIComponent(match[1]) +
                        '&t=' +
                        encodeURIComponent(match[2]) +
                        '&act=addfav';
                }
            } catch (_) {}

            // 爱心对应收藏：打开原站的收藏表单。
            const heart = makeTweetAction('heart', favoriteHref);

            if (favoriteHref) {
                heart.target = '_blank';
                heart.rel = 'noopener noreferrer';
                heart.title = 'Add to Favorites';
                heart.setAttribute('aria-label', 'Add to Favorites');
                heart.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleBrowserFavorite(galleryHref, heart);
                });
            }

            append(
                heart,
                create(
                    'span',
                    'ehtw-action-number ehtw-stat-favorites'
                )
            );

            const ratingText = readSpriteRating(ratingNode);

            if (ratingText) {
                const rating = create(
                    'span',
                    'ehtw-tweet-rating',
                    '★ ' + ratingText
                );

                rating.title = 'Rating';

                append(author, create('span', 'ehtw-dot', '·'));
                append(author, rating);
            }

            if (ratingNode) {
                move(ratingNode, heart);

                setStyleSafe(
                    ratingNode,
                    'display',
                    'none'
                );
            }

            append(actions, heart);

            const views = makeTweetAction('views');

            append(
                views,
                create(
                    'span',
                    'ehtw-action-number',
                    extractPageNumber(pageNode)
                )
            );

            if (pageNode) {
                move(pageNode, views);

                setStyleSafe(
                    pageNode,
                    'display',
                    'none'
                );
            }

            append(actions, views);

            append(content, actions);
            append(tweet, avatar);
            append(tweet, content);

            syncAvatarLetter(tweet);

            return tweet;
        }

        function transformList() {
            const pathname =
                location.pathname.replace(/\/+$/, '') || '/';
            const isToplistResultPage = pathname === '/toplist.php' &&
                new URLSearchParams(location.search).has('tl');
            const blockedToplistTagsState = { value: null };

            let nextListPageUrl = findNextListPageUrl(document);
            const seenGalleryHrefs = new Set();

            const searchTerm = new URLSearchParams(
                location.search
            ).get('f_search') || '';

            const hasOriginalSearch = !!qs('#searchbox');

            const isUploaderPage =
                /^\/uploader\//i.test(pathname);

            const currentUploader = isUploaderPage
                ? (() => {
                    const raw = pathname.replace(
                        /^\/uploader\//i,
                        ''
                    );

                    try {
                        return decodeURIComponent(raw)
                            .replace(/\+/g, ' ')
                            .trim()
                            .toLowerCase();
                    } catch (_) {
                        return raw.replace(/\+/g, ' ')
                            .trim()
                            .toLowerCase();
                    }
                })()
                : '';

            const uploaderCounts = new Map();

            // 必须在 createTweet 搬走上传者链接之前读取。
            qsa('tr', table).forEach(row => {
                if (!isGalleryListRow(row)) return;

                const link = findUploader(row).link;

                if (!link) return;

                const name = textOf(link).trim();
                const href = link.getAttribute('href');

                if (!name || !href) return;

                if (
                    currentUploader &&
                    name.toLowerCase() === currentUploader
                ) {
                    return;
                }

                try {
                    const url = new URL(href, location.href);

                    if (url.origin !== location.origin) {
                        return;
                    }

                    const previous = uploaderCounts.get(url.href);

                    if (previous) {
                        previous.count++;
                    } else {
                        uploaderCounts.set(url.href, {
                            name,
                            href: url.href,
                            count: 1
                        });
                    }
                } catch (_) {}
            });

            const topUploaders = Array.from(
                uploaderCounts.values()
            )
                .sort((a, b) =>
                    b.count - a.count ||
                    a.name.localeCompare(b.name)
                )
                .slice(0, 3);

            const timeline = create(
                'div',
                'ehtw-timeline'
            );
            const isPopularTimelinePage = pathname === '/popular';
            const popularTimelineItems = [];
            let popularTimelineSequence = 0;
            const getListTimelineTimestamp = (row) => {
                const posted = findPostedNode(row);
                const raw = [
                    posted?.getAttribute('title'),
                    posted?.getAttribute('aria-label'),
                    textOf(posted),
                    findRowTimestamp(row)
                ].filter(Boolean).join(' ');
                const fullDate = raw.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                if (fullDate) {
                    return Date.UTC(
                        Number(fullDate[1]),
                        Number(fullDate[2]) - 1,
                        Number(fullDate[3]),
                        Number(fullDate[4]),
                        Number(fullDate[5])
                    );
                }
                const relative = raw.match(/\b(\d+)\s*(m|h|d|w)\b/i);
                if (relative) {
                    const units = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
                    return Date.now() - Number(relative[1]) * units[relative[2].toLowerCase()];
                }
                const parsed = Date.parse(raw);
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const renderPopularTimeline = () => {
                if (!isPopularTimelinePage || !popularTimelineItems.length) return;
                popularTimelineItems.sort((a, b) =>
                    b.timestamp - a.timestamp || a.sequence - b.sequence
                );
                const existingCards = qsa('.ehtw-tweet', timeline);
                const firstCard = existingCards[0];
                const previousNode = firstCard?.previousSibling || null;
                const anchorCard = existingCards.find((card) =>
                    card.getBoundingClientRect().bottom > 0
                ) || null;
                const anchorTop = anchorCard?.getBoundingClientRect().top ?? 0;
                existingCards.forEach((card) => card.remove());
                const fragment = document.createDocumentFragment();
                popularTimelineItems.forEach(({ tweet }) => fragment.appendChild(tweet));
                const reference = previousNode?.parentNode === timeline
                    ? previousNode.nextSibling
                    : timeline.firstChild;
                timeline.insertBefore(fragment, reference || null);
                if (anchorCard?.isConnected) {
                    const shift = anchorCard.getBoundingClientRect().top - anchorTop;
                    if (Math.abs(shift) > 1) {
                        window.scrollTo?.(window.scrollX || 0, (window.scrollY || 0) + shift);
                    }
                }
            };
        if (isToplistResultPage) {
            addClassSafe(timeline, 'ehtw-toplist-filter-pending');
        }

            append(center, timeline);

            if (isFollowingFeedPage) {
                const modeTabs = create('nav', 'ehtw-follow-mode-tabs');
                [
                    ['authors', '作者'],
                    ['uploaders', '上传者']
                ].forEach(([mode, label]) => {
                    const link = create(
                        'a',
                        'ehtw-follow-mode-tab',
                        label
                    );
                    link.href = `/watched?ehtw_following=${mode}`;
                    if (followingFeedMode === mode) addClassSafe(link, 'ehtw-follow-mode-active');
                    append(modeTabs, link);
                });
                append(timeline, modeTabs);
            }

            // .searchtext 只用作头部副标题的数据源。
            // 不再生成重复的 .ehtw-results-count。
            const oldResultsCount = qs(
                '.ehtw-results-count',
                center
            );

            if (oldResultsCount) {
                setStyleSafe(
                    oldResultsCount,
                    'display',
                    'none'
                );
            }

            const appendListRows = (sourceTable, cloneRows = false) => {
                const appendedTweets = [];
                const previousTrackingState = skipTransactionTracking;
                if (cloneRows) skipTransactionTracking = true;
                const addRow = (row) => {
                    const galleryLink = findGalleryListLink(row);
                    const galleryHref = galleryLink?.getAttribute('href');
                    if (!galleryHref || seenGalleryHrefs.has(galleryHref)) return;
                    const entryTags = getToplistEntryTags(row);
                    if (
                        isToplistResultPage &&
                        blockedToplistTagsState.value &&
                        entryTags.some((tag) => blockedToplistTagsState.value.has(tag))
                    ) {
                        seenGalleryHrefs.add(galleryHref);
                        return;
                    }

                    const sourceRow = cloneRows ? row.cloneNode(true) : row;
                    const timestamp = isPopularTimelinePage
                        ? getListTimelineTimestamp(sourceRow)
                        : 0;
                    const tweet = createTweet(sourceRow);
                    if (!tweet) return;

                    seenGalleryHrefs.add(galleryHref);
                    if (isToplistResultPage) tweet._ehtwToplistTags = entryTags;
                    if (isPopularTimelinePage) {
                        popularTimelineItems.push({
                            tweet,
                            timestamp,
                            sequence: popularTimelineSequence++
                        });
                    } else {
                        append(timeline, tweet);
                    }
                    appendedTweets.push(tweet);
                };

                try {
                    qsa('.gl1t', sourceTable).forEach(addRow);
                    qsa('tr', sourceTable).forEach((row) => {
                        if (qs('th', row)) return;
                        if (!isGalleryListRow(row)) {
                            if (!cloneRows) addClassSafe(row, 'ehtw-hidden-ad');
                            return;
                        }
                        addRow(row);
                    });

                    renderPopularTimeline();

                    return appendedTweets;
                } finally {
                    skipTransactionTracking = previousTrackingState;
                }
            };

            const followingTimelineItems = [];
            const followingSeenGalleryPaths = new Set();
            const followingNextPageUrls = new Map();
            let followingCreatorTags = [];
            const followingFeedSourceInfo = new Map();
            let followingTimelineSequence = 0;
            let followingPageBatchPromise = null;
            let followingRateLimited = false;
            let maybeLoadFollowingMore = () => {};
            const FOLLOWING_CREATOR_FETCH_CONCURRENCY = 3;

            const getFollowingTimestamp = (row) => {
                const posted = findPostedNode(row);
                const raw = [
                    posted?.getAttribute('title'),
                    posted?.getAttribute('aria-label'),
                    textOf(posted)
                ].filter(Boolean).join(' ');
                const fullDate = raw.match(
                    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/
                );
                if (fullDate) {
                    return Date.UTC(
                        Number(fullDate[1]),
                        Number(fullDate[2]) - 1,
                        Number(fullDate[3]),
                        Number(fullDate[4]),
                        Number(fullDate[5])
                    );
                }

                const relative = raw.match(/\b(\d+)\s*(m|h|d|w)\b/i);
                if (relative) {
                    const units = {
                        m: 60000,
                        h: 3600000,
                        d: 86400000,
                        w: 604800000
                    };
                    return Date.now() -
                        Number(relative[1]) * units[relative[2].toLowerCase()];
                }

                const parsed = Date.parse(raw);
                return Number.isFinite(parsed) ? parsed : 0;
            };

            const collectFollowingPage = (
                page,
                baseHref,
                sourceCreatorTag = '',
                sourceUploaderName = ''
            ) => {
                const sourceList = page.querySelector(
                    'table.itg.gltc, table.itg.gltm, table.itg.glte, div.itg.gld, .itg'
                );
                if (!sourceList) return [];
                const appended = [];
                const rows = [
                    ...Array.from(sourceList.querySelectorAll('.gl1t')),
                    ...Array.from(sourceList.querySelectorAll('tr'))
                        .filter((row) => isGalleryListRow(row))
                ];

                rows.forEach((row) => {
                    const galleryLink = findGalleryListLink(row);
                    const href = galleryLink?.getAttribute('href');
                    if (!href) return;

                    try {
                        const url = new URL(href, baseHref);
                        const key = url.pathname;
                        if (url.origin !== location.origin || followingSeenGalleryPaths.has(key)) return;

                        // Import parsed nodes into the live page document before
                        // createTweet moves their children into the timeline.
                        const liveRow = document.importNode(row, true);
                        const tweet = createTweet(liveRow);
                        if (!tweet) {
                            console.warn('[EH Twitter Style] Follow row produced no card', key);
                            return;
                        }
                        followingSeenGalleryPaths.add(key);
                        const normalizedSourceTag = normalizeCreatorFollowTag(sourceCreatorTag);
                        const normalizedSourceUploader = normalizeUploaderName(sourceUploaderName);
                        if (normalizedSourceTag) {
                            tweet._ehtwFollowingSourceTag = normalizedSourceTag;
                        }
                        if (normalizedSourceUploader) {
                            tweet._ehtwFollowingSourceUploader = normalizedSourceUploader;
                        }
                        if (normalizedSourceTag || normalizedSourceUploader) {
                            // This card came from an already-followed source; its optional stats can load after display.
                            tweet.classList.remove('ehtw-following-checking');
                        }
                        const timestamp = getFollowingTimestamp(row);
                        const item = {
                            tweet,
                            // Keep undated entries after dated galleries. A synthetic
                            // "now" timestamp made stale/unknown dates jump to the top.
                            timestamp: timestamp || 0,
                            sequence: followingTimelineSequence++
                        };
                        followingTimelineItems.push(item);
                        appended.push(tweet);
                    } catch (error) {
                        console.warn('[EH Twitter Style] Follow row conversion failed', href, error);
                    }
                });
                return appended;
            };

            const renderFollowingTimeline = (newTweets = []) => {
                followingTimelineItems.sort((a, b) =>
                    b.timestamp - a.timestamp || a.sequence - b.sequence
                );
                qs('.ehtw-empty', timeline)?.remove();
                if (infiniteStatus.parentNode !== timeline) append(timeline, infiniteStatus);
                const fragment = document.createDocumentFragment();
                followingTimelineItems.forEach(({ tweet }) => {
                    fragment.appendChild(tweet);
                });
                timeline.insertBefore(fragment, infiniteStatus);
                if (newTweets.length && typeof registerAdditionalStatsTweets === 'function') {
                    registerAdditionalStatsTweets(newTweets);
                }
            };

            const loadFollowingAuthorTimeline = async () => {
                if (!isFollowingFeedPage) return;

                try {
                    let feedSources = [];
                    if (isFollowingAuthorsPage) {
                        const followedTags = await requestWatchedCreatorTags();
                        feedSources = Array.from(followedTags).map((creatorTag) => ({
                                key: creatorTag,
                                url: '/tag/' + encodeTagPath(creatorTag),
                                creatorTag
                        }));
                    } else if (isFollowingUploadersPage) {
                        feedSources = (await requestWatchedUploaderNames()).map((uploader) => ({
                                key: `uploader:${uploader.key}`,
                            url: uploader.href,
                                uploaderName: uploader.name
                        }));
                    }
                    if (!feedSources.length) {
                        setFollowingStatus(
                            isFollowingAuthorsPage
                                ? 'No artist or group tags are marked Watched. Follow a creator from a gallery card to start this feed.'
                                : 'No uploaders followed yet. Follow an uploader from a card or gallery page to start this feed.',
                            'done'
                        );
                        append(timeline, makeEmptyHint('No followed creators yet.'));
                        append(timeline, infiniteStatus);
                        return;
                    }
                    followingCreatorTags = feedSources.map((source) => source.key);
                    feedSources.forEach((source) => followingFeedSourceInfo.set(source.key, source));

                    for (let offset = 0; offset < feedSources.length; offset += FOLLOWING_CREATOR_FETCH_CONCURRENCY) {
                        const sourceBatch = feedSources.slice(
                            offset,
                            offset + FOLLOWING_CREATOR_FETCH_CONCURRENCY
                        );
                        setFollowingStatus(
                            `Searching ${offset + 1}–${offset + sourceBatch.length}/${feedSources.length}`,
                            'loading'
                        );

                        const results = await Promise.all(sourceBatch.map(async (source) => {
                            const requestUrl = new URL(source.url, location.href).href;
                            try {
                                const fetchUrl = new URL(requestUrl, location.href);
                                fetchUrl.searchParams.set(
                                    '_ehtw_refresh',
                                    `${Date.now()}-${source.key}`
                                );
                                const response = await window.fetch(fetchUrl.href, {
                                    credentials: 'same-origin',
                                    cache: 'reload'
                                });
                                if (response.status === 429 || response.status === 403) {
                                    return { source, requestUrl, rateLimited: true };
                                }
                                if (!response.ok) return { source, requestUrl, failed: true };
                                const page = new window.DOMParser().parseFromString(
                                    await response.text(),
                                    'text/html'
                                );
                                return { source, requestUrl, page };
                            } catch (_) {
                                return { source, requestUrl, failed: true };
                            }
                        }));

                        const newTweets = [];
                        results.forEach(({ source, requestUrl, page, rateLimited }) => {
                            if (rateLimited) {
                                followingRateLimited = true;
                                return;
                            }
                            if (!page) return;
                            const nextUrl = findNextListPageUrl(page, requestUrl);
                            if (nextUrl) followingNextPageUrls.set(source.key, nextUrl);
                            newTweets.push(...collectFollowingPage(
                                page,
                                requestUrl,
                                source.creatorTag || '',
                                source.uploaderName || ''
                            ));
                        });
                        if (newTweets.length) renderFollowingTimeline(newTweets);
                        if (followingRateLimited) break;

                        if (offset + sourceBatch.length < feedSources.length) {
                            await new Promise((resolve) => setTimeout(resolve, 1500));
                        }
                    }

                    if (!followingTimelineItems.length) {
                        append(timeline, makeEmptyHint('No galleries found for followed creators.'));
                    }

                    if (infiniteStatus.parentNode !== timeline) append(timeline, infiniteStatus);
                    if (followingRateLimited) {
                        setFollowingStatus('Creator search was rate-limited. Reload later to continue.', 'error');
                    } else {
                        setInfiniteStatus('', 'idle');
                        startFollowingAuthorContinuation();
                    }
                } catch (error) {
                    console.warn('[EH Twitter Style] Following feed aggregation failed', error);
                    setFollowingStatus('Could not build the author timeline. Check My Tags and reload.', 'error');
                }
            };

            const loadNextFollowingBatch = () => {
                if (followingPageBatchPromise || !followingNextPageUrls.size) {
                    return followingPageBatchPromise || Promise.resolve();
                }

                listInfiniteObserver?.unobserve(infiniteStatus);
                setFollowingStatus('Loading more…', 'loading');
                followingPageBatchPromise = (async () => {
                    let batchFailed = false;
                    const requests = followingCreatorTags
                        .map((key) => [key, followingNextPageUrls.get(key), followingFeedSourceInfo.get(key)])
                        .filter(([, url]) => !!url);

                    for (let offset = 0; offset < requests.length; offset += FOLLOWING_CREATOR_FETCH_CONCURRENCY) {
                        const requestBatch = requests.slice(
                            offset,
                            offset + FOLLOWING_CREATOR_FETCH_CONCURRENCY
                        ).filter(([key, requestedUrl]) =>
                            followingNextPageUrls.get(key) === requestedUrl
                        );
                        if (!requestBatch.length) continue;

                        const results = await Promise.all(requestBatch.map(async ([sourceKey, requestedUrl, source]) => {
                            try {
                                const fetchUrl = new URL(requestedUrl, location.href);
                                fetchUrl.searchParams.set(
                                    '_ehtw_refresh',
                                    `${Date.now()}-${sourceKey}`
                                );
                                const response = await window.fetch(fetchUrl.href, {
                                    credentials: 'same-origin',
                                    cache: 'reload'
                                });
                                if (response.status === 429 || response.status === 403) {
                                    return { sourceKey, requestedUrl, source, rateLimited: true };
                                }
                                if (!response.ok) return { sourceKey, requestedUrl, source, failed: true };
                                const page = new window.DOMParser().parseFromString(
                                    await response.text(),
                                    'text/html'
                                );
                                return { sourceKey, requestedUrl, source, page };
                            } catch (_) {
                                return { sourceKey, requestedUrl, source, failed: true };
                            }
                        }));

                        const newTweets = [];
                        results.forEach(({ sourceKey, requestedUrl, source, page, rateLimited, failed }) => {
                            if (rateLimited) {
                                followingRateLimited = true;
                                batchFailed = true;
                                return;
                            }
                            if (failed || !page) {
                                batchFailed = true;
                                return;
                            }
                            const nextUrl = findNextListPageUrl(page, requestedUrl);
                            if (nextUrl && nextUrl !== requestedUrl) {
                                followingNextPageUrls.set(sourceKey, nextUrl);
                            } else {
                                followingNextPageUrls.delete(sourceKey);
                            }
                            newTweets.push(...collectFollowingPage(
                                page,
                                requestedUrl,
                                source?.creatorTag || '',
                                source?.uploaderName || ''
                            ));
                        });
                        if (newTweets.length) renderFollowingTimeline(newTweets);
                        if (followingRateLimited) break;

                        if (offset + requestBatch.length < requests.length) {
                            await new Promise((resolve) => setTimeout(resolve, 1500));
                        }
                    }

                    if (followingRateLimited || batchFailed) {
                        setFollowingStatus(
                            followingRateLimited
                                ? 'Creator feed was rate-limited. Retry later.'
                                : 'Could not load more creators. Retry to continue.',
                            'error'
                        );
                        const retry = create('button', '', 'Load more');
                        retry.type = 'button';
                        retry.addEventListener('click', () => {
                            followingRateLimited = false;
                            loadNextFollowingBatch();
                        });
                        infiniteStatus.appendChild(retry);
                        return;
                    }

                    if (!followingNextPageUrls.size) {
                        setInfiniteStatus('', 'done');
                        listInfiniteObserver?.disconnect();
                        listInfiniteObserver = null;
                        return;
                    }

                    setInfiniteStatus('', 'idle');
                    if (listInfiniteObserver) {
                        window.requestAnimationFrame?.(() => {
                            if (followingNextPageUrls.size) {
                                listInfiniteObserver?.observe(infiniteStatus);
                                maybeLoadFollowingMore();
                            }
                        });
                    }
                })().finally(() => {
                    followingPageBatchPromise = null;
                });

                return followingPageBatchPromise;
            };

            startFollowingAuthorContinuation = () => {
            if (!isFollowingFeedPage || !followingNextPageUrls.size) return;

                maybeLoadFollowingMore = () => {
                    if (
                        !followingNextPageUrls.size ||
                        followingPageBatchPromise ||
                        infiniteStatus.dataset.state === 'error'
                    ) return;
                    if (
                        infiniteStatus.getBoundingClientRect().top <
                        (window.innerHeight || 0) + 6000
                    ) {
                        loadNextFollowingBatch();
                    }
                };

                if (typeof window.IntersectionObserver === 'function') {
                    listInfiniteObserver = new window.IntersectionObserver(
                        (entries) => {
                            if (entries.some((entry) => entry.isIntersecting)) {
                                maybeLoadFollowingMore();
                            }
                        },
                        { rootMargin: '6000px 0px' }
                    );
                    listInfiniteObserver.observe(infiniteStatus);
                }

                listInfiniteScrollFallback = () => {
                    maybeLoadFollowingMore();
                };
                addSpaPageEventListener(window, 'scroll', listInfiniteScrollFallback, { passive: true });
                listInfiniteScrollFallback();
            };

            if (isFollowingFeedPage) {
                startFollowingAuthorTimeline = loadFollowingAuthorTimeline;
            }

            const converted = isFollowingFeedPage
                ? 0
                : appendListRows(table).length;

            if (isToplistResultPage) {
                requestHiddenMyTags().then((hiddenTags) => {
                    blockedToplistTagsState.value = hiddenTags;
                    qsa('.ehtw-tweet', timeline).forEach((tweet) => {
                        if (!(tweet._ehtwToplistTags || []).some((tag) => hiddenTags.has(tag))) return;
                        const href = tweet.getAttribute('data-ehtw-href');
                        if (href) seenGalleryHrefs.delete(href);
                        tweet.remove();
                    });
                    timeline.classList.remove('ehtw-toplist-filter-pending');
                }).catch(() => {
                    timeline.replaceChildren(create(
                        'div',
                        'ehtw-empty',
                        'Could not load My Tags filters. Reload to retry.'
                    ));
                    timeline.classList.remove('ehtw-toplist-filter-pending');
                });
            }

            if (!converted && !isFollowingFeedPage) {
                append(
                    timeline,
                    makeEmptyHint('No galleries found.')
                );
            }

            // 此时 buildSearch 已处理有搜索框页面的上方工具栏。
            // /popular 等无 #searchbox 的页面，必须保留上下两栏。
            const remainingNavs = qsa('.searchnav').filter(
                node =>
                    !node.closest('#ehtw-search-card') &&
                    !node.closest('#ehtw-mobile-search') &&
                    !node.closest('#ehtw-shell')
            );

            qsa('.searchnav').filter(
                node => !node.closest('#ehtw-shell')
            ).forEach((nav) => {
                qsa('a, span[id]', nav).forEach((control) => {
                    setStyleSafe(control, 'display', 'none');
                });
            });
            qsa('#dnext, #unext').forEach((control) => {
                setStyleSafe(control, 'display', 'none');
            });

            if (!hasOriginalSearch && remainingNavs.length > 1) {
                const upper = remainingNavs[0];

                addClassSafe(
                    upper,
                    'ehtw-list-bottom-toolbar'
                );

                move(upper, timeline);
            }

            if (remainingNavs.length) {
                const lower = remainingNavs[
                    remainingNavs.length - 1
                ];

                if (!hasOriginalSearch && remainingNavs.length === 1) {
                    addClassSafe(
                        lower,
                        'ehtw-list-bottom-toolbar'
                    );

                    move(lower, timeline);
                } else {
                    const pager = buildPagination(lower, timeline);
                    if (pager) {
                        addClassSafe(pager, 'ehtw-list-pagination-hidden');
                    }
                }
            }

            // 缺少原站搜索框时，在右栏补充独立 GET 搜索表单。
            if (!hasOriginalSearch) {
                ensureRightSearchForm();
            }

            // /uploader/ 页面不显示推荐；
            // 不同上传者不足两个也不显示。
            if (
                !right.classList.contains('ehtw-toplist-only-sidebar') &&
                !isUploaderPage &&
                topUploaders.length >= 2
            ) {
                const card = create(
                    'section',
                    'ehtw-side-card ehtw-who-card'
                );

                append(
                    card,
                    create(
                        'h2',
                        'ehtw-side-title',
                        'Who to follow'
                    )
                );

                topUploaders.forEach(item => {
                    const itemRow = create(
                        'div',
                        'ehtw-who-row'
                    );

                    append(
                        itemRow,
                        create(
                            'span',
                            'ehtw-who-avatar',
                            Array.from(item.name)[0]
                                ?.toUpperCase() || '?'
                        )
                    );

                    const info = create(
                        'div',
                        'ehtw-who-info'
                    );

                    const name = create(
                        'a',
                        'ehtw-who-name',
                        item.name
                    );

                    name.href = item.href;
                    append(info, name);

                    append(
                        info,
                        create(
                            'span',
                            'ehtw-who-handle',
                            '@' + item.name.replace(/\s+/g, '_')
                        )
                    );

                    const view = create(
                        'a',
                        'ehtw-who-view',
                        'View'
                    );

                    view.href = item.href;

                    append(itemRow, info);
                    append(itemRow, view);
                    append(card, itemRow);
                });

                append(right, card);
            }

            const infiniteStatus = create('div', 'ehtw-list-infinite-status');
            infiniteStatus.setAttribute('role', 'status');
            infiniteStatus.setAttribute('aria-live', 'polite');
            if (!isFollowingFeedPage) append(timeline, infiniteStatus);

            const seenListPageUrls = new Set([
                new URL(location.href).href
            ]);
            const setInfiniteStatus = (message, state) => {
                infiniteStatus.dataset.state = state;
                infiniteStatus.replaceChildren();
                infiniteStatus.textContent = message;
            };
            const setFollowingStatus = (message, state = 'loading') => {
                setInfiniteStatus(message, state);
            };
            let listPageLoadInProgress = false;
            let listPagesExhausted = !nextListPageUrl;

            const loadNextListPage = async () => {
                if (listPageLoadInProgress || listPagesExhausted || !nextListPageUrl) return;

                const requestedUrl = nextListPageUrl;
                if (seenListPageUrls.has(requestedUrl)) {
                    listPagesExhausted = true;
                    setInfiniteStatus('No more galleries', 'done');
                    listInfiniteObserver?.unobserve(infiniteStatus);
                    return;
                }

                listPageLoadInProgress = true;
                seenListPageUrls.add(requestedUrl);
                setInfiniteStatus('Loading more…', 'loading');
                listInfiniteObserver?.unobserve(infiniteStatus);

                try {
                    const response = await window.fetch(requestedUrl, {
                        credentials: 'same-origin'
                    });
                    if (!response?.ok) {
                        throw new Error(`List page request failed: ${response?.status || 'no response'}`);
                    }

                    const pageText = await response.text();
                    const parsedPage = new window.DOMParser()
                        .parseFromString(pageText, 'text/html');
                    const nextTable = parsedPage.querySelector(
                        'table.itg.gltc, table.itg.gltm, table.itg.glte, div.itg.gld'
                    );
                    if (!nextTable) {
                        throw new Error('The next page did not contain a gallery list');
                    }

                    const pageNextUrl = findNextListPageUrl(parsedPage, requestedUrl);
                    const appendedTweets = appendListRows(nextTable, true);
                    if (!appendedTweets.length) {
                        listPagesExhausted = true;
                        nextListPageUrl = null;
                        setInfiniteStatus('No more galleries', 'done');
                        listInfiniteObserver?.disconnect();
                        return;
                    }

                    qs('.ehtw-empty', timeline)?.remove();
                    registerAdditionalStatsTweets?.(appendedTweets);
                    nextListPageUrl = pageNextUrl && !seenListPageUrls.has(pageNextUrl)
                        ? pageNextUrl
                        : null;
                    listPagesExhausted = !nextListPageUrl;

                    if (listPagesExhausted) {
                        setInfiniteStatus('No more galleries', 'done');
                        listInfiniteObserver?.disconnect();
                    } else {
                        setInfiniteStatus('', 'idle');
                        if (listInfiniteObserver) {
                            window.requestAnimationFrame?.(() => {
                                if (!listPagesExhausted) {
                                    listInfiniteObserver?.observe(infiniteStatus);
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.warn('[EH Twitter Style] Infinite list load failed', error);
                    seenListPageUrls.delete(requestedUrl);
                    setInfiniteStatus('', 'error');
                    const retry = create('button', '', 'Load more');
                    retry.type = 'button';
                    retry.addEventListener('click', () => loadNextListPage());
                    infiniteStatus.appendChild(retry);
                } finally {
                    listPageLoadInProgress = false;
                }
            };

            startListInfiniteContinuation = () => {
                if (isFollowingFeedPage) return;
                if (listPagesExhausted) {
                    setInfiniteStatus('No more galleries', 'done');
                    return;
                }

                if (typeof window.IntersectionObserver === 'function') {
                    listInfiniteObserver = new window.IntersectionObserver(
                        (entries) => {
                            if (entries.some(entry => entry.isIntersecting)) {
                                loadNextListPage();
                            }
                        },
                        { rootMargin: '1000px 0px' }
                    );
                    listInfiniteObserver.observe(infiniteStatus);
                    return;
                }

                listInfiniteScrollFallback = () => {
                    if (
                        !listPagesExhausted &&
                        infiniteStatus.getBoundingClientRect().top <
                            (window.innerHeight || 0) + 1000
                    ) {
                        loadNextListPage();
                    }
                };
                addSpaPageEventListener(window, 'scroll', listInfiniteScrollFallback, { passive: true });
                listInfiniteScrollFallback();
            };

            setStyleSafe(
                table,
                'display',
                'none'
            );
        }

        // ============================================================
        // 10. 详情页转换
        // ============================================================

        function buildDetailAuthor(
            post,
            categoryName,
            categoryClass
        ) {
            const author = create(
                'div',
                'ehtw-detail-author'
            );

            const avatar = makeAvatar(
                categoryName,
                categoryClass
            );

            const meta = create(
                'div',
                'ehtw-detail-author-meta'
            );

            const uploaderLink = qs('#gdn a');

            const uploaderName = textOf(
                uploaderLink,
                'Unknown'
            );

            const name = create(
                'div',
                'ehtw-author-name'
            );

            const detailCreatorTags = readPageAuthorTags(document)
                .filter((tag) => /^(?:artist|group):/i.test(tag));
            const detailAuthor = pickAuthor(
                detailCreatorTags,
                textOf(qs('#gj')) || textOf(qs('#gn'))
            ) || pickAuthor([], textOf(qs('#gn')));

            if (detailAuthor) {
                showAuthorName(name, detailAuthor);
            } else if (uploaderLink) {
                showAuthorName(name, {
                    name: uploaderName,
                    href: uploaderLink.getAttribute('href')
                });
            } else {
                name.textContent = uploaderName;
            }

            append(meta, name);

            const handle = create('div', 'ehtw-handle');

            if (uploaderLink) {
                setTextSafe(uploaderLink, formatHandle(uploaderName));
                move(uploaderLink, handle);
            } else {
                handle.textContent = formatHandle(uploaderName);
            }

            append(meta, handle);

            const followActions = create('div', 'ehtw-detail-follow-actions');
            const followStatus = create('span', 'ehtw-detail-follow-status');
            followStatus.setAttribute('role', 'status');
            followStatus.setAttribute('aria-live', 'polite');
            const setFollowStatus = (message, isError = false) => {
                followStatus.textContent = message || '';
                followStatus.classList.toggle('is-error', !!isError);
            };
            const creatorTags = detailCreatorTags.length
                ? detailCreatorTags
                : detailAuthor?.name
                    ? [
                        /\/tag\/group:/i.test(String(detailAuthor.href || ''))
                            ? `group:${detailAuthor.name}`
                            : `artist:${detailAuthor.name}`
                    ]
                    : [];
            Array.from(new Set(creatorTags)).forEach((tag) => {
                const normalized = normalizeCreatorFollowTag(tag);
                if (!normalized) return;
                const type = normalized.startsWith('group:') ? 'Group' : 'Artist';
                const label = create('button', 'ehtw-detail-follow-button', type);
                label.type = 'button';
                label.title = `关注 ${type} · ${tag.replace(/^(?:artist|group):/i, '')}`;
                let isFollowed = false;
                const updateLabel = () => {
                    label.textContent = type;
                    label.setAttribute('aria-pressed', String(isFollowed));
                    label.setAttribute('aria-label', `${isFollowed ? '取消关注' : '关注'} ${type}`);
                };
                label.addEventListener('click', () => {
                    const wasFollowed = isFollowed;
                    label.disabled = true;
                    isFollowed = !wasFollowed;
                    updateLabel();
                    setFollowStatus('正在保存到 My Tags…');
                    toggleWatchedTagInMyTags(tag, (success, nowFollowed, reason) => {
                        isFollowed = success ? !!nowFollowed : wasFollowed;
                        label.disabled = false;
                        updateLabel();
                        setFollowStatus(
                            success
                                ? `${isFollowed ? '已关注' : '已取消关注'} ${type}`
                                : (reason || '保存失败，请稍后重试。'),
                            !success
                        );
                    });
                });
                append(followActions, label);
                requestWatchedCreatorTags().then((followed) => {
                    isFollowed = followed.has(normalized);
                    updateLabel();
                }).catch(() => {});
            });

            if (uploaderName && uploaderName.toLowerCase() !== 'unknown') {
                const uploaderKey = normalizeUploaderName(uploaderName);
                const uploaderButton = create('button', 'ehtw-detail-follow-button');
                uploaderButton.type = 'button';
                let uploaderFollowed = false;
                const updateUploaderButton = () => {
                    uploaderButton.textContent = '上传者';
                    uploaderButton.setAttribute('aria-pressed', String(uploaderFollowed));
                    uploaderButton.setAttribute('aria-label', `${uploaderFollowed ? '取消关注' : '关注'}上传者`);
                };
                updateUploaderButton();
                uploaderButton.title = `关注上传者 · ${uploaderName}`;
                uploaderButton.addEventListener('click', () => {
                    const wasFollowed = uploaderFollowed;
                    uploaderButton.disabled = true;
                    uploaderFollowed = !wasFollowed;
                    updateUploaderButton();
                    setFollowStatus('正在保存到上传者收藏夹…');
                    followUploaderViaFavorites(uploaderName, location.pathname, (success, nowFollowed, reason) => {
                        uploaderFollowed = success ? !!nowFollowed : wasFollowed;
                        uploaderButton.disabled = false;
                        updateUploaderButton();
                        setFollowStatus(
                            success
                                ? `${uploaderFollowed ? '已关注' : '已取消关注'}上传者`
                                : (reason || '保存失败，请稍后重试。'),
                            !success
                        );
                    });
                });
                requestWatchedUploaderNames().then((entries) => {
                    uploaderFollowed = entries.some((entry) => entry.key === uploaderKey);
                    updateUploaderButton();
                }).catch(() => {});
                append(followActions, uploaderButton);
            }
            if (followActions.children.length) append(followActions, followStatus);

            append(author, avatar);
            append(author, meta);
            if (followActions.children.length) append(author, followActions);

            syncAvatarLetter(author);

            append(post, author);
        }

        function buildDetailCover(post) {
            const original = qs('#gleft');

            if (!original) return;

            const cover = create(
                'div',
                'ehtw-detail-cover'
            );

            move(original, cover);

            const background = qs(
                '#gd1 > div',
                cover
            );

            if (background) {
                const originalBackground =
                    extractBackgroundImage(background);

                if (
                    originalBackground &&
                    originalBackground !== 'none'
                ) {
                    setStyleSafe(
                        background,
                        'background-image',
                        originalBackground
                    );
                }
            }

            append(post, cover);
        }

        function buildDetailMeta(post) {
            const mid = qs('#gmid');
            if (!mid) return;

            const info = qs('#gdd');
            const rating = qs('#gdr');
            const favorites = qs('#gdf');

            const originalInfo = textOf(info);

            const pagesMatch = originalInfo.match(
                /(\d[\d,]*)\s+pages?/i
            );

            const pages = pagesMatch
                ? pagesMatch[1]
                : '—';

            const ratingText = textOf(
                qs('#rating_label')
            );

            const ratingMatch = ratingText.match(
                /(\d+(?:\.\d+)?)/
            );

            const ratingValue = ratingMatch
                ? ratingMatch[1]
                : '—';

            const favoriteNode = qs('#favcount');

            const favoriteSource = favoriteNode
                ? textOf(favoriteNode)
                : originalInfo;

            const favoriteMatch = favoriteSource.match(
                /(\d[\d,]*)/
            );

            let favoriteValue = '—';

            if (favoriteMatch) {
                favoriteValue = favoriteMatch[1];
            } else if (/\bonce\b/i.test(favoriteSource)) {
                favoriteValue = '1';
            } else if (/\bnever\b/i.test(favoriteSource)) {
                favoriteValue = '0';
            } else {
                const fallback = originalInfo.match(
                    /favorited:\s*(\d[\d,]*)\s*times?/i
                );

                if (fallback) {
                    favoriteValue = fallback[1];
                }
            }

            const ratingCountSource = textOf(
                qs('#rating_count')
            );

            const ratingCountMatch = ratingCountSource.match(
                /(\d[\d,]*)/
            );

            const ratingCount = ratingCountMatch
                ? ratingCountMatch[1]
                : '0';

            const commentCount = readCommentCount(document);

            const section = create(
                'section',
                'ehtw-detail-meta'
            );

            const time = findDetailTimestamp(mid);

            if (time) {
                append(
                    section,
                    create(
                        'div',
                        'ehtw-detail-timestamp',
                        formatTwitterFullDate(time)
                    )
                );
            }

            const stats = create(
                'div',
                'ehtw-detail-stats'
            );

            [
                [pages, 'Pages'],
                [ratingValue, 'Rating'],
                [ratingCount, Number(ratingCount.replace(/,/g, '')) === 1
                    ? 'Rating vote'
                    : 'Ratings'],
                [favoriteValue, 'Favorites'],
                [
                    String(commentCount),
                    commentCount === 1
                        ? 'Comment'
                        : 'Comments'
                ]
            ].forEach(([value, label]) => {
                const item = create(
                    'span',
                    'ehtw-detail-stat'
                );

                append(
                    item,
                    create('strong', '', value)
                );

                append(
                    item,
                    create('span', '', label)
                );

                append(stats, item);
            });

            append(section, stats);

            const reply = create(
                'a',
                'ehtw-detail-reply-count'
            );

            reply.href = '#cdiv';

            append(reply, makeIcon('reply'));

            append(
                reply,
                create(
                    'span',
                    '',
                    String(commentCount)
                )
            );

            append(section, reply);

            const native = create(
                'div',
                'ehtw-detail-native-meta'
            );

            move(mid, native);
            append(section, native);
            append(post, section);

            if (info) {
                const about = create(
                    'section',
                    'ehtw-side-card ehtw-about-card'
                );

                append(
                    about,
                    create(
                        'h2',
                        'ehtw-side-title',
                        'About'
                    )
                );

                move(info, about);
                append(right, about);

                const mobile = create(
                    'div',
                    'ehtw-mobile-about'
                );

                append(post, mobile);

                let host = right;

                function updateAboutPlacement() {
                    const target = window.matchMedia(
                        '(max-width: 999px)'
                    ).matches
                        ? mobile
                        : right;

                    if (host !== target) {
                        target.appendChild(about);
                        host = target;
                    }
                }

                registerMediaListener(
                    window.matchMedia('(max-width: 999px)'),
                    updateAboutPlacement
                );

                updateAboutPlacement();
            }

            void rating;
            void favorites;
        }

        function buildDetailTags(post) {
            const gd4 = qs('#gd4');
            if (!gd4) return;

            const section = create(
                'section',
                'ehtw-detail-tags'
            );
            const tagCount = qsa(
                '#taglist .gt, #taglist .gtl, #taglist .gtw',
                gd4
            ).length;

            const header = create('div', 'ehtw-detail-section-header');
            append(header, create('h2', 'ehtw-detail-section-title', 'Tags'));

            const expandButton = create(
                'button',
                'ehtw-detail-expand-button',
                'Expand'
            );
            expandButton.type = 'button';
            expandButton.setAttribute('aria-expanded', 'false');
            expandButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const expanded = section.classList.toggle(
                    'ehtw-detail-tags-expanded'
                );
                section.classList.toggle(
                    'ehtw-detail-tags-collapsed',
                    !expanded
                );
                expandButton.textContent = expanded ? 'Collapse' : 'Expand';
                expandButton.setAttribute('aria-expanded', String(expanded));
            });

            append(section, header);

            move(gd4, section);

            qsa(
                '#taglist .gt, #taglist .gtl, #taglist .gtw',
                section
            ).forEach(tag => {
                addClassSafe(
                    tag,
                    'ehtw-detail-hashtag'
                );

                const anchor = qs('a', tag);
                if (!anchor) return;

                const parsed = parseTwitterTag(
                    textOf(anchor)
                );

                // 原 a、href、onclick 都保留。
                setTextSafe(
                    anchor,
                    '#' + parsed.display
                );
            });

            append(post, section);

            const tagList = qs('#taglist', section);
            if (tagCount && tagList) {
                section.classList.add('ehtw-detail-tags-collapsed');
                expandButton.hidden = true;
                append(header, expandButton);

                const updateTagExpandVisibility = () => {
                    const hasOverflow = tagList.scrollHeight > 112;
                    const expanded =
                        section.classList.contains('ehtw-detail-tags-expanded');

                    if (hasOverflow) {
                        section.classList.toggle(
                            'ehtw-detail-tags-collapsed',
                            !expanded
                        );
                        expandButton.hidden = false;
                        expandButton.textContent = expanded ? 'Collapse' : 'Expand';
                        expandButton.setAttribute(
                            'aria-expanded',
                            String(expanded)
                        );
                    } else {
                        section.classList.remove(
                            'ehtw-detail-tags-collapsed',
                            'ehtw-detail-tags-expanded'
                        );
                        expandButton.hidden = true;
                        expandButton.textContent = 'Expand';
                        expandButton.setAttribute('aria-expanded', 'true');
                    }
                };
                const scheduleTagExpandVisibilityUpdate = () => {
                    const schedule = window.requestAnimationFrame ||
                        ((callback) => window.setTimeout(callback, 0));
                    schedule(updateTagExpandVisibility);
                };

                scheduleTagExpandVisibilityUpdate();
                addSpaPageEventListener(
                    window,
                    'resize',
                    scheduleTagExpandVisibilityUpdate,
                    { passive: true }
                );
            }
        }

        // ============================================================
        // 10.1 详情操作链接
        // ============================================================

        function buildDetailOperations() {
            const detailGalleryHref = `${location.origin}${location.pathname}`;
            const gd5 = qs('#gd5');
            const gdr = qs('#gdr');
            const gdf = qs('#gdf');

            const timeline = qs(
                '.ehtw-detail-main',
                center
            );

            if (!timeline) return null;

            const detailPost = qs(
                '.ehtw-detail-post',
                timeline
            );

            if (detailPost && (gdr || gdf)) {
                const actions = create(
                    'div',
                    'ehtw-detail-actions'
                );

                const replyCount = qs('.ehtw-detail-reply-count');

                if (replyCount) {
                    actions.appendChild(replyCount);
                }

                if (gdr) {
                    const ratingAction = create(
                        'div',
                        'ehtw-detail-rating-action'
                    );

                    move(gdr, ratingAction);
                    append(actions, ratingAction);
                }

                if (gdf) {
                    const favoriteAction = create(
                        'button',
                        'ehtw-detail-favorite-action'
                    );

                    favoriteAction.type = 'button';
                    favoriteAction.title = textOf(
                        qs('#favoritelink'),
                        'Add to Favorites'
                    ).trim();

                    if (
                        !/add to favorites/i.test(favoriteAction.title)
                    ) {
                        favoriteAction.classList.add('ehtw-liked');
                    }

                    // 爱心就是收藏，走原站 #gdf 的 pop_fav()。
                    favoriteAction.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleBrowserFavorite(detailGalleryHref, favoriteAction);
                    }, true);

                    favoriteAction.appendChild(
                        makeIcon('heart')
                    );

                    const favoriteCount = readFavoriteCount(
                        textOf(qs('#favcount'))
                    );

                    if (favoriteCount !== null) {
                        const number = create(
                            'span',
                            'ehtw-detail-favorite-count',
                            formatCount(favoriteCount)
                        );

                        number.title =
                            favoriteCount.toLocaleString() +
                            ' favorites';

                        append(favoriteAction, number);
                    }

                    move(gdf, favoriteAction);
                    append(actions, favoriteAction);
                }

                append(detailPost, actions);
            }

            // Actions 收进卡片右上角，#gd5 原节点搬动，onclick 不变。
            const authorRow = detailPost
                ? qs('.ehtw-detail-author', detailPost)
                : null;

            if (gd5 && authorRow) {
                const menu = makeActionMenu();

                addClassSafe(gd5, 'ehtw-menu-native');
                move(gd5, menu.panel);
                append(authorRow, menu.wrap);

                menu.panel.addEventListener('click', (event) => {
                    event.stopPropagation();

                    if (event.target.closest('a')) {
                        closeActionMenus();
                    }
                });
            }

            return null;
        }

        // ============================================================
        // 10.2 详情缩略图和上下分页
        // ============================================================

        function buildDetailGrid(post) {
            const gdt = qs('#gdt');

            if (!gdt) return;

            let upperPagination = null;
            let lowerPagination = null;

            let previous = gdt.previousElementSibling;

            while (previous) {
                if (previous.classList?.contains('gtb')) {
                    upperPagination = previous;
                    break;
                }

                previous = previous.previousElementSibling;
            }

            let next = gdt.nextElementSibling;

            while (next) {
                if (next.classList?.contains('gtb')) {
                    lowerPagination = next;
                    break;
                }

                next = next.nextElementSibling;
            }

            if (!upperPagination || !lowerPagination) {
                const candidates = qsa('.gtb').filter(
                    node => !node.closest('#ehtw-shell')
                );

                if (!upperPagination) {
                    upperPagination = candidates.find(
                        node => !!(
                            node.compareDocumentPosition(gdt) &
                            Node.DOCUMENT_POSITION_FOLLOWING
                        )
                    ) || null;
                }

                if (!lowerPagination) {
                    lowerPagination = candidates.find(
                        node => !!(
                            node.compareDocumentPosition(gdt) &
                            Node.DOCUMENT_POSITION_PRECEDING
                        )
                    ) || null;
                }
            }

            let nextGalleryThumbPageUrl = (upperPagination || lowerPagination)
                ? findNextGalleryThumbPageUrl(upperPagination || lowerPagination)
                : null;
            let checkGalleryStripEdge = () => {};
            const seenGalleryThumbUrls = new Set();

            const section = create(
                'section',
                'ehtw-gallery-grid-section'
            );
            const expandedStorageKey = getGalleryGridExpandedStorageKey(
                location.pathname
            );
            let imagesInitiallyExpanded = false;
            try {
                imagesInitiallyExpanded = !!expandedStorageKey &&
                    window.sessionStorage?.getItem(expandedStorageKey) === 'true';
            } catch (_) {}

            const imageHeader = create('div', 'ehtw-detail-section-header');
            append(imageHeader, create('h2', 'ehtw-detail-section-title', 'Images'));
            const expandImagesButton = create(
                'button',
                'ehtw-detail-expand-button',
                'Expand'
            );
            expandImagesButton.type = 'button';
            if (imagesInitiallyExpanded) {
                section.classList.add('ehtw-gallery-grid-expanded');
                expandImagesButton.textContent = 'Collapse';
            }
            expandImagesButton.setAttribute(
                'aria-expanded',
                String(imagesInitiallyExpanded)
            );
            expandImagesButton.addEventListener('click', () => {
                const expanded = section.classList.toggle(
                    'ehtw-gallery-grid-expanded'
                );
                expandImagesButton.textContent = expanded ? 'Collapse' : 'Expand';
                expandImagesButton.setAttribute('aria-expanded', String(expanded));
                try {
                    if (expandedStorageKey) {
                        window.sessionStorage?.setItem(
                            expandedStorageKey,
                            String(expanded)
                        );
                    }
                } catch (_) {}
                checkGalleryStripEdge();
            });
            append(imageHeader, expandImagesButton);
            append(section, imageHeader);

            move(gdt, section);

            const horizontalWheelHandler = makeHorizontalStripWheelHandler(
                gdt,
                section
            );
            const horizontalWheelOptions = {
                capture: true,
                passive: false
            };
            addSpaPageEventListener(
                window,
                'wheel',
                horizontalWheelHandler,
                horizontalWheelOptions
            );
            domListeners.push({
                target: window,
                type: 'wheel',
                listener: horizontalWheelHandler,
                options: horizontalWheelOptions
            });

            // 封面就是第 1 页，图片条里不再重复。
            const cover = qs('.ehtw-detail-cover', post);

            if (cover) {
                setStyleSafe(cover, 'display', 'none');
            }

            const prepareGalleryThumb = (link, prepareImageNow = false) => {
                const href = link.getAttribute('href') || link.href;
                if (!href) return false;

                let canonicalHref = href;
                try {
                    canonicalHref = new URL(href, location.href).href;
                } catch (_) {}
                if (seenGalleryThumbUrls.has(canonicalHref)) return false;

                const thumb = qs('div', link);
                if (!thumb) return false;

                setStyleSafe(
                    link,
                    '--ehtw-w',
                    String(parseFloat(thumb.style.width) || 200)
                );
                setStyleSafe(
                    link,
                    '--ehtw-h',
                    String(parseFloat(thumb.style.height) || 280)
                );
                if (prepareImageNow) prepareImage(qs('img', link));
                seenGalleryThumbUrls.add(canonicalHref);
                return true;
            };

            qsa('a', gdt).forEach((link) => {
                prepareGalleryThumb(link);
            });

            // 保留原分页节点供回滚，但页面不再要求手动翻页。
            const pager = upperPagination
                ? buildGalleryPagination(upperPagination, section)
                : null;

            const hiddenPager =
                lowerPagination &&
                lowerPagination !== upperPagination
                    ? buildGalleryPagination(lowerPagination, section)
                    : null;

            if (hiddenPager) {
                addClassSafe(hiddenPager, 'ehtw-gallery-pagination-secondary');
                setStyleSafe(hiddenPager, 'display', 'none');
            }
            if (pager) setStyleSafe(pager, 'display', 'none');

            append(post, section);

            qsa('img', gdt).forEach(prepareImage);

            if (nextGalleryThumbPageUrl) {
                const continuationStatus = create('div', 'ehtw-gallery-continuation');
                continuationStatus.setAttribute('role', 'status');
                continuationStatus.setAttribute('aria-live', 'polite');
                continuationStatus.textContent = '';
                gdt.appendChild(continuationStatus);

                const seenGalleryPageUrls = new Set([
                    new URL(location.href).href
                ]);
                let loadingGalleryPage = false;
                let galleryPagesExhausted = false;
                let galleryPageLoadFailed = false;

                const setContinuationText = (text, state) => {
                    continuationStatus.dataset.state = state;
                    continuationStatus.replaceChildren();
                    continuationStatus.textContent = text;
                };

                const loadNextGalleryThumbPage = async () => {
                    if (
                        loadingGalleryPage ||
                        galleryPagesExhausted ||
                        !nextGalleryThumbPageUrl
                    ) {
                        return;
                    }

                    const requestedUrl = nextGalleryThumbPageUrl;
                    if (seenGalleryPageUrls.has(requestedUrl)) {
                        galleryPagesExhausted = true;
                        setContinuationText('End of gallery', 'done');
                        return;
                    }

                    loadingGalleryPage = true;
                    galleryPageLoadFailed = false;
                    seenGalleryPageUrls.add(requestedUrl);
                    setContinuationText('Loading…', 'loading');

                    try {
                        const response = await window.fetch(requestedUrl, {
                            credentials: 'same-origin'
                        });
                        if (!response?.ok) {
                            throw new Error(`Gallery page request failed: ${response?.status || 'no response'}`);
                        }

                        const pageText = await response.text();
                        const parsedPage = new window.DOMParser()
                            .parseFromString(pageText, 'text/html');
                        const pageGrid = qs('#gdt', parsedPage);
                        if (!pageGrid) {
                            throw new Error('The next page did not contain thumbnails');
                        }

                        const pagePager = qs('.gtb', parsedPage) || parsedPage;
                        const pageNextUrl = findNextGalleryThumbPageUrl(
                            pagePager,
                            requestedUrl
                        );
                        const previousTrackingState = skipTransactionTracking;
                        let appendedCount = 0;
                        skipTransactionTracking = true;
                        try {
                            qsa('a[href]', pageGrid).forEach((sourceLink) => {
                                const link = sourceLink.cloneNode(true);
                                if (!prepareGalleryThumb(link, true)) return;
                                gdt.insertBefore(link, continuationStatus);
                                appendedCount++;
                            });
                        } finally {
                            skipTransactionTracking = previousTrackingState;
                        }

                        if (!appendedCount) {
                            galleryPagesExhausted = true;
                            nextGalleryThumbPageUrl = null;
                            setContinuationText('End of gallery', 'done');
                            return;
                        }

                        nextGalleryThumbPageUrl = pageNextUrl &&
                            !seenGalleryPageUrls.has(pageNextUrl)
                                ? pageNextUrl
                                : null;
                        galleryPagesExhausted = !nextGalleryThumbPageUrl;
                        setContinuationText(
                            galleryPagesExhausted ? 'End of gallery' : '',
                            galleryPagesExhausted ? 'done' : 'idle'
                        );
                    } catch (error) {
                        console.warn('[EH Twitter Style] Gallery strip continuation failed', error);
                        seenGalleryPageUrls.delete(requestedUrl);
                        galleryPageLoadFailed = true;
                        setContinuationText('', 'error');
                        const retry = create('button', '', 'Retry');
                        retry.type = 'button';
                        retry.addEventListener('click', () => {
                            loadNextGalleryThumbPage();
                        });
                        continuationStatus.appendChild(retry);
                    } finally {
                        loadingGalleryPage = false;
                        if (!galleryPagesExhausted && !galleryPageLoadFailed) {
                            window.requestAnimationFrame?.(checkGalleryStripEdge);
                        }
                    }
                };

                checkGalleryStripEdge = () => {
                    if (galleryPagesExhausted || galleryPageLoadFailed) return;
                    if (section.classList.contains('ehtw-gallery-grid-expanded')) return;
                    const remaining = gdt.scrollWidth -
                        (gdt.scrollLeft + gdt.clientWidth);
                    const threshold = Math.max(600, gdt.clientWidth * 1.25);
                    if (remaining <= threshold) loadNextGalleryThumbPage();
                };

                const galleryStripScrollHandler = () => checkGalleryStripEdge();
                gdt.addEventListener('scroll', galleryStripScrollHandler, {
                    passive: true
                });
                domListeners.push({
                    target: gdt,
                    type: 'scroll',
                    listener: galleryStripScrollHandler,
                    options: { passive: true }
                });

                startGalleryStripContinuation = () => {
                    checkGalleryStripEdge();
                };
            }
        }

        // ============================================================
        // 10.3 评论
        // ============================================================

        // 回复的操作栏只放真实存在的功能：回复、分数、原站投票链接、分享。
        function buildCommentActions(comment, heading, c3) {
            const c4 = qs('.c4', comment);
            const c5 = qs('.c5', comment);
            const contact = qs('a[href*="showuser"]', c3);

            if (c4 && qs('a[name="ulcomment"]', c4)) {
                addClassSafe(c4, 'ehtw-comment-badge');
                move(c4, heading);
            }

            const voteUp = qs('[id^="comment_vote_up_"]', comment);
            const voteDown = qs('[id^="comment_vote_down_"]', comment);
            const editLink = c4
                ? qsa('a[href]', c4).find(
                    (link) =>
                        link !== voteUp &&
                        link !== voteDown &&
                        link.getAttribute('name') === null
                )
                : null;

            const menu = makeActionMenu();

            if (voteDown) {
                addMenuItem(menu.panel, 'Vote down', () => {
                    voteDown.click();
                });
            }

            if (editLink) {
                addMenuItem(
                    menu.panel,
                    textOf(editLink, 'Edit').replace(/[\[\]]/g, '').trim(),
                    () => {
                        editLink.click();
                    }
                );
            }

            if (contact) {
                addMenuItem(menu.panel, 'Contact Poster', () => {
                    window.open(contact.href, '_blank', 'noopener');
                });
            }

            if (menu.panel.children.length) {
                registerCreatedNode(menu.wrap);
                append(heading, menu.wrap);
            }

            const actions = registerCreatedNode(
                create('div', 'ehtw-comment-actions')
            );

            const reply = create('a', 'ehtw-comment-action');

            reply.href = '#ehtw-reply-box';
            reply.title = 'Reply';
            reply.appendChild(makeIcon('reply'));
            append(actions, reply);

            if (c5) {
                const like = create(
                    voteUp ? 'button' : 'span',
                    'ehtw-comment-action ehtw-comment-like'
                );

                like.appendChild(makeIcon('heart'));
                move(c5, like);

                // 爱心就是投票：走原站的 Vote+，未登录时没有这个链接。
                if (voteUp) {
                    const syncVoted = () => {
                        like.classList.toggle(
                            'ehtw-liked',
                            voteUp.style.color === 'blue' ||
                                voteUp.style.color === 'red'
                        );
                    };

                    like.type = 'button';
                    like.title = 'Vote';
                    like.addEventListener('click', () => {
                        voteUp.click();
                    });

                    new MutationObserver(syncVoted).observe(voteUp, {
                        attributes: true,
                        attributeFilter: ['style']
                    });

                    syncVoted();
                }

                append(actions, like);
            }

            if (c4 && comment.contains(c4) && !heading.contains(c4)) {
                addClassSafe(c4, 'ehtw-comment-votes-native');
                move(c4, actions);
            }

            comment.appendChild(actions);
        }

        function buildDetailComments(timeline) {
            const cdiv = qs('#cdiv');
            const postNew = qs('#postnewcomment');

            if (!cdiv && !postNew) return;

            const section = create(
                'section',
                'ehtw-comments-section'
            );

            append(
                section,
                makeSectionTitle('Replies')
            );

            if (cdiv) {
                move(cdiv, section);

                qsa('.c1', cdiv).forEach(comment => {
                    const c3 = qs('.c3', comment);
                    const author = qs('a', c3);

                    const authorName = textOf(
                        author,
                        'User'
                    );

                    const originalHeader = textOf(c3);

                    // 原站评论时间：
                    // Posted on 01 November 2026, 02:16 by:
                    // 按 UTC 解析，不依赖浏览器本地时区。
                    const utcMatch = originalHeader.match(
                        /Posted\s+on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s+by:/i
                    );

                    let parsedDate = null;
                    let originalTime = '';

                    if (utcMatch) {
                        const monthNames = [
                            'january', 'february', 'march',
                            'april', 'may', 'june',
                            'july', 'august', 'september',
                            'october', 'november', 'december'
                        ];

                        const monthIndex = monthNames.indexOf(
                            utcMatch[2].toLowerCase()
                        );

                        if (monthIndex >= 0) {
                            parsedDate = new Date(Date.UTC(
                                Number(utcMatch[3]),
                                monthIndex,
                                Number(utcMatch[1]),
                                Number(utcMatch[4]),
                                Number(utcMatch[5])
                            ));

                            originalTime = utcMatch[0];
                        }
                    }

                    const avatar = registerCreatedNode(
                        create(
                            'div',
                            'ehtw-comment-avatar',
                            Array.from(authorName)[0]
                                ?.toUpperCase() || '?'
                        )
                    );

                    const heading = registerCreatedNode(
                        create(
                            'div',
                            'ehtw-comment-heading'
                        )
                    );

                    if (author) {
                        const nameWrap = registerCreatedNode(
                            create(
                                'span',
                                'ehtw-comment-author'
                            )
                        );

                        move(author, nameWrap);
                        append(heading, nameWrap);
                    } else {
                        append(
                            heading,
                            create(
                                'span',
                                'ehtw-comment-author',
                                authorName
                            )
                        );
                    }

                    append(
                        heading,
                        create(
                            'span',
                            'ehtw-comment-handle',
                            '@' + authorName.replace(/\s+/g, '_')
                        )
                    );

                    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
                        const marker = registerCreatedNode(
                            create(
                                'span',
                                'ehtw-dot',
                                '·'
                            )
                        );

                        append(heading, marker);

                        const elapsed = Date.now() -
                            (parsedDate.getTime() - SITE_UTC_OFFSET_MIN * 60000);

                        let relative = '';

                        if (elapsed >= 0 && elapsed < 60000) {
                            relative = 'now';
                        } else if (
                            elapsed >= 0 &&
                            elapsed < 3600000
                        ) {
                            relative =
                                Math.floor(elapsed / 60000) + 'm';
                        } else if (
                            elapsed >= 0 &&
                            elapsed < 86400000
                        ) {
                            relative =
                                Math.floor(elapsed / 3600000) + 'h';
                        } else {
                            const month = parsedDate.toLocaleString(
                                'en-US',
                                {
                                    month: 'short',
                                    timeZone: 'UTC'
                                }
                            );

                            relative =
                                month + ' ' + parsedDate.getUTCDate();

                            if (
                                parsedDate.getUTCFullYear() !==
                                new Date().getUTCFullYear()
                            ) {
                                relative += ', ' +
                                    parsedDate.getUTCFullYear();
                            }
                        }

                        const timeNode = registerCreatedNode(
                            create(
                                'span',
                                'ehtw-comment-time',
                                relative
                            )
                        );

                        timeNode.title = originalTime;

                        append(heading, timeNode);
                    }

                    const c2 = qs('.c2', comment);

                    if (c2) {
                        comment.insertBefore(avatar, c2);
                        comment.insertBefore(heading, c2);

                        addClassSafe(
                            comment,
                            'ehtw-comment-tweet'
                        );

                        buildCommentActions(comment, heading, c3);
                    }
                });
            }

            // X 的回复框在回复列表上方；表单节点原样搬动，onclick 不变。
            if (postNew) {
                const replyBox = create('div', 'ehtw-reply-box');

                replyBox.id = 'ehtw-reply-box';

                append(
                    replyBox,
                    create('span', 'ehtw-reply-avatar', 'E')
                );

                append(
                    replyBox,
                    create(
                        'span',
                        'ehtw-reply-placeholder',
                        'Post your reply'
                    )
                );

                move(postNew, replyBox);

                section.insertBefore(
                    replyBox,
                    cdiv || null
                );

                const form = qs('#formdiv');

                if (form) {
                    section.insertBefore(form, cdiv || null);
                }
            }

            append(timeline, section);
        }

        function transformDetail() {
            const timeline = create(
                'div',
                'ehtw-timeline ehtw-detail-main'
            );

            append(center, timeline);

            const post = create(
                'article',
                'ehtw-detail-post'
            );

            const category = qs('#gdc .cs');

            const categoryName = textOf(
                category,
                'Gallery'
            );

            const categoryClass =
                getCategoryClass(category);

            buildDetailAuthor(
                post,
                categoryName,
                categoryClass
            );

            const gd2 = qs('#gd2');

            if (gd2) {
                move(gd2, post);
            }

            buildDetailCover(post);
            buildDetailGrid(post);

            // 保持原始节点，改变其视觉呈现。
            buildDetailTags(post);

            buildDetailMeta(post);

            append(timeline, post);

            const updateOperationPlacement =
                buildDetailOperations();

            buildDetailComments(timeline);

            return updateOperationPlacement;
        }

        // ============================================================
        // 11. 其它显示模式
        // ============================================================

        function transformOtherList() {
            const content = create(
                'div',
                'ehtw-other-content'
            );

            append(center, content);

            const originalList = qs(
                'table.itg, .itg'
            );

            const navs = qsa('.searchnav');

            if (navs[0]) {
                buildPagination(navs[0], content);
            }

            if (originalList) {
                move(originalList, content);
            }

            if (
                (location.pathname.replace(/\/+$/, '') || '/') === '/toplist.php' &&
                new URLSearchParams(location.search).has('tl')
            ) {
                requestHiddenMyTags().then((hiddenTags) => {
                    if (!hiddenTags.size || !content.isConnected) return;
                    filterToplistResultRows(content, hiddenTags);
                }).catch(() => {});
            }

            if (navs[1]) {
                buildPagination(navs[1], content);
            }

            // 不转换原站列表条目，只补上评论数和收藏数。
            qsa('table.itg tr', content).forEach((row) => {
                const link = qs('a[href*="/g/"]', row);
                const target = qs('.gl3e, .gl4m', row);

                if (!link || !target) return;

                setAttributeSafe(
                    row,
                    'data-ehtw-href',
                    link.getAttribute('href')
                );

                const stats = create('span', 'ehtw-row-stats');

                [
                    ['reply', 'ehtw-stat-comments'],
                    ['heart', 'ehtw-stat-favorites']
                ].forEach(([icon, className]) => {
                    const item = create('span', 'ehtw-row-stat');

                    item.appendChild(makeIcon(icon));
                    append(item, create('span', className));
                    append(stats, item);
                });

                append(target, stats);
                registerCreatedNode(stats);
            });
        }

        // ============================================================
        // 12. 隐藏广告位
        // ============================================================

        function hideAdvertisements() {
            qsa('ins[data-width][data-height]').forEach(
                node => {
                    setStyleSafe(
                        node,
                        'display',
                        'none'
                    );
                }
            );

            if (table) {
                qsa('tr', table).forEach(row => {
                    if (
                        !isGalleryListRow(row) &&
                        !qs('th', row)
                    ) {
                        setStyleSafe(
                            row,
                            'display',
                            'none'
                        );
                    }
                });
            }
        }

        // ============================================================
        // 13. 保留原站隐藏容器
        // ============================================================

        function preserveOriginalStructures() {
            if (isList || isOtherList) {
                const toppane = qs('#toppane');

                if (toppane) {
                    if (isFollowingFeedPage) {
                        setStyleSafe(toppane, 'display', 'none');
                    }

                    const heading = qs(
                        'h1.ih',
                        toppane
                    );

                    if (heading) {
                        setStyleSafe(
                            heading,
                            'display',
                            'none'
                        );
                    }
                }
            }

            // 不删除原始事件节点。
        }

        // ============================================================
        // 14. 初始化
        // ============================================================

        const trending = collectTags(document);

        buildNavigation();
        buildHeader();

        const updateSearchPlacement = buildSearch();

        let updateOperationPlacement = null;

        if (isList) {
            transformList();
        } else if (isDetail) {
            updateOperationPlacement = transformDetail();
        } else if (isGeneric) {
            transformGenericPage();
        } else {
            transformOtherList();
        }

        buildTrending(trending);

        hideAdvertisements();
        preserveOriginalStructures();

        const updateFooterPlacement = buildFooter();

        if (
            !document.getElementById('ehtw-shell') ||
            !document.getElementById('ehtw-center')
        ) {
            throw new Error(
                'Layout initialization failed'
            );
        }

        committed = true;
        publishSpaPageCleanup(() => rollback?.());
        releasePageBoot();

        function handleNativeCardSettingAction() {
            const action = new URLSearchParams(
                location.hash.replace(/^#/, '')
            );
            const followTag = action.get('ehtw_follow_creator') ||
                action.get('ehtw_follow_artist');
            const followUploader = action.get('ehtw_follow_uploader');
            const blockedUploader = action.get('ehtw_block_uploader');
            if (!followTag && !followUploader && !blockedUploader) return;

            const actionState = recoverSpaHistoryState(location.href, window.history.state);
            if (safeReplaceHistoryState(
                window.history,
                actionState,
                '',
                location.pathname + location.search,
                'native-card-setting-action'
            )) rememberSpaHistoryState(location.href, actionState);
            // The action hash is not part of the rendered route. Keep the URL
            // observer aligned after consuming this instruction.
            spaRenderedHref = location.href;

            const message = create('div', 'ehtw-native-setting-message');
            append(center, message);
            const announce = (value) => {
                message.textContent = value;
                message.scrollIntoView({ block: 'nearest' });
            };

            if (followTag || followUploader) {
                const watchedTag = followTag || `uploader:${followUploader}`;
                const isUploaderFollow = !!followUploader;
                if (
                    !isMyTagsPage ||
                    (isUploaderFollow
                        ? !followUploader.trim()
                        : !/^(?:artist|group):/i.test(followTag))
                ) {
                    announce(isUploaderFollow
                        ? '无法识别上传者，请从画廊卡片或详情页重新操作。'
                        : '无法识别作者标签，请从画廊卡片重新操作。');
                    return;
                }

                const tagSetEnabled = qs('#tagset_enable');
                if (tagSetEnabled && !tagSetEnabled.checked) {
                    announce('My Tags 当前已停用标签关注。请先在原生页面启用标签设置。');
                    return;
                }

                const rows = qsa(
                    '#usertags_outer > div[id^="usertag_"]'
                );
                const row = rows.find((candidate) => {
                    const preview = qs('[id^="tagpreview_"]', candidate);
                    const name = preview?.getAttribute('title') ||
                        preview?.textContent || '';
                    if (isUploaderFollow) {
                        const match = String(name).trim().match(/^uploader:(.+)$/i);
                        return normalizeUploaderName(match?.[1]) ===
                            normalizeUploaderName(followUploader);
                    }
                    return normalizeCreatorFollowTag(name) === normalizeCreatorFollowTag(followTag);
                });

                let watch = row
                    ? qs('input[id^="tagwatch_"]', row)
                    : qs('#tagwatch_0');
                if (!watch) {
                    announce('My Tags 没有可用的作者标签输入行。');
                    return;
                }

                if (row && watch.checked) {
                    announce(isUploaderFollow
                        ? `上传者已在 My Tags 中设为 Watched：${followUploader}`
                        : `作者已在原生 My Tags 中设为 Watched：${followTag.replace(/^(?:artist|group):/i, '')}`);
                    return;
                }

                if (!row) {
                    const nameInput = qs('#tagname_new');
                    if (!nameInput) {
                        announce('找不到 My Tags 的新标签输入框。');
                        return;
                    }
                    nameInput.value = watchedTag;
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                watch.checked = true;
                watch.dispatchEvent(new Event('change', { bubbles: true }));
                const rowId = row?.id.match(/_(\d+)$/)?.[1] || '0';
                const save = qs(`#tagsave_${rowId}`);
                if (!save || save.disabled) {
                    announce('关注标签已填入，但原生保存按钮未启用；请检查 My Tags 页面后手动保存。');
                    return;
                }

                announce(isUploaderFollow
                    ? `正在将上传者 ${followUploader} 加入 My Tags / Watched…`
                    : `正在将 ${followTag.replace(/^(?:artist|group):/i, '')} 加入 My Tags / Watched…`);
                save.click();
                return;
            }

            if (!/^\/uconfig\.php$/i.test(location.pathname)) {
                announce('无法识别上传者设置页面，请从画廊卡片重新操作。');
                return;
            }

            const textarea = qs('#xu');
            if (!textarea || !blockedUploader.trim()) {
                announce('找不到 Excluded Uploaders 输入框。');
                return;
            }

            const lines = textarea.value.split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            if (lines.some((line) => line.toLowerCase() === blockedUploader.toLowerCase())) {
                announce(`${blockedUploader} 已在原生 Excluded Uploaders 列表中。`);
                return;
            }

            if (lines.length >= 100) {
                announce('Excluded Uploaders 已达到 100 个条目的上限，请先在原生设置中移除一项。');
                return;
            }

            textarea.value = [...lines, blockedUploader].join('\n');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            const apply = qsa('button, input[type="submit"]')
                .find((button) => (button.textContent || button.value || '')
                    .trim().toLowerCase() === 'apply');
            if (!apply || apply.disabled) {
                announce(`${blockedUploader} 已填入 Excluded Uploaders，但找不到可用的 Apply 按钮；请在原生页面手动应用。`);
                return;
            }

            announce(`正在将 ${blockedUploader} 加入原生 Excluded Uploaders…`);
            apply.click();
        }

        try {
            handleNativeCardSettingAction();
        } catch (error) {
            console.warn('[EH Twitter Style] Native card setting action failed', error);
        }

        if (
            typeof updateSearchPlacement === 'function'
        ) {
            updateSearchPlacement();
        }

        if (
            typeof updateOperationPlacement === 'function'
        ) {
            updateOperationPlacement();
        }

        if (
            typeof updateFooterPlacement === 'function'
        ) {
            updateFooterPlacement();
        }

        if (isList || isOtherList) {
            // 统计是附加功能，失败时不应连带回滚整个界面。
            try {
                registerAdditionalStatsTweets = startGalleryStatsLoader();
            } catch (error) {
                console.warn('[EH Twitter Style] Stats loader failed', error);
            }
        }

        if (isList && typeof startListInfiniteContinuation === 'function') {
            try {
                startListInfiniteContinuation();
            } catch (error) {
                console.warn('[EH Twitter Style] Infinite list setup failed', error);
            }
        }

        if (
            isFollowingFeedPage &&
            typeof startFollowingAuthorTimeline === 'function'
        ) {
            startFollowingAuthorTimeline();
        }

        if (isDetail && typeof startGalleryStripContinuation === 'function') {
            try {
                startGalleryStripContinuation();
            } catch (error) {
                console.warn('[EH Twitter Style] Gallery strip continuation setup failed', error);
            }
        }

        console.info(
            '[EH Twitter Style] Applied:',
            isDetail
                ? 'detail'
                : isList
                    ? 'list'
                    : 'other list mode'
        );

        // 转换成功后，原始列表表格已不再参与显示；移除它可避免把原表和新卡片
        // 同时留在 DOM。事务日志只用于初始化失败回滚，成功后释放其节点引用。
        if (isList && table?.isConnected) {
            table.remove();
            table = null;
        }
        skipTransactionTracking = true;

    } catch (error) {
        releasePageBoot();
        // ========================================================
        // 0.5.0：catch 不依赖 try 内部声明
        // ========================================================

        console.error(
            '[EH Twitter Style] Initialization failed:',
            error
        );

        try {
            rollback();
        } catch (rollbackError) {
            console.error(
                '[EH Twitter Style] Rollback failed:',
                rollbackError
            );

            // 最后兜底：这些变量均在 try 外层声明。
            try {
                if (styleElement) {
                    styleElement.remove();
                }
            } catch (_) {}

            try {
                document.documentElement.classList.remove(
                    'ehtw-enabled',
                    'ehtw-exhentai',
                    'ehtw-list',
                    'ehtw-detail',
                    'ehtw-myhome',
                    'ehtw-mytags',
                    'ehtw-myuploads',
                    'ehtw-bounty',
                    'ehtw-other',
                    'ehtw-generic',
                    'ehtw-login'
                );
            } catch (_) {}

            try {
                delete window[RUN_KEY];
            } catch (_) {
                window[RUN_KEY] = false;
            }
        }
    }
    }

    let spaNavigationInProgress = false;
    let spaNavigationHistoryMode = null;
    let pendingSpaPop = null;
    const HISTORY_STATE_SCROLL_DEBOUNCE_MS = 200;
    const SCROLL_RESTORE_QUIET_MS = 650;
    let pendingScrollHistoryStateWrite = null;
    let scrollHistoryStateWriteTimer = null;

    function historyStateWriteSuppressionReason(href = location.href) {
        if (spaNavigationInProgress) return 'navigation-in-progress';
        if (window.__EHTW_SCROLL_SAVE_LOCK__) return 'scroll-restore-active';
        if (Date.now() < scrollRestoreProtectionUntil) return 'scroll-restore-quiet-window';
        if (isEdgeGestureProtected()) return 'left-edge-gesture-active';
        if (
            document.documentElement?.classList.contains('ehtw-navigation-pending') &&
            href !== spaRenderedHref
        ) return 'pending-destination-does-not-match-rendered-route';
        return '';
    }

    function flushPendingScrollHistoryStateWrite(source = 'scroll-debounce') {
        const pending = pendingScrollHistoryStateWrite;
        if (!pending) return false;
        const suppressedBy = historyStateWriteSuppressionReason(pending.href);
        if (suppressedBy) {
            if (navLogEnabled) navLog('scroll-history-state-write-skipped', {
                source: pending.source,
                requestedBy: source,
                scrollY: pending.scrollY,
                reason: suppressedBy
            });
            return false;
        }
        if (location.href !== pending.href || spaRenderedHref !== pending.href) {
            pendingScrollHistoryStateWrite = null;
            if (navLogEnabled) navLog('scroll-history-state-write-discarded', {
                source: pending.source,
                requestedBy: source,
                targetHref: pending.href,
                currentHref: location.href,
                renderedHref: spaRenderedHref
            });
            return false;
        }
        const current = recoverSpaHistoryState(pending.href, window.history.state);
        const nextState = {
            ...(pending.state || {}),
            ...(current || {}),
            ehtwSpa: true,
            ehtwScrollY: pending.scrollY
        };
        const replaced = safeReplaceHistoryState(window.history, nextState, '', pending.href, `scroll-${source}`);
        if (!replaced) return false;
        rememberSpaHistoryState(pending.href, nextState);
        pendingScrollHistoryStateWrite = null;
        if (navLogEnabled) navLog('scroll-history-state-write', {
            source: pending.source,
            requestedBy: source,
            scrollY: pending.scrollY,
            historyState: summarizeNavLogState(nextState)
        });
        return true;
    }

    function schedulePendingScrollHistoryStateWrite(delay = HISTORY_STATE_SCROLL_DEBOUNCE_MS) {
        if (!pendingScrollHistoryStateWrite) return;
        window.clearTimeout(scrollHistoryStateWriteTimer);
        scrollHistoryStateWriteTimer = window.setTimeout(() => {
            scrollHistoryStateWriteTimer = null;
            flushPendingScrollHistoryStateWrite('scroll-debounce');
        }, Math.max(0, Number(delay) || 0));
    }

    function queueScrollHistoryStateWrite(href, state, scrollY, source, force = false) {
        pendingScrollHistoryStateWrite = {
            href,
            state: { ...(state || {}) },
            scrollY: Math.max(0, Math.round(Number(scrollY) || 0)),
            source
        };
        if (force) {
            window.clearTimeout(scrollHistoryStateWriteTimer);
            scrollHistoryStateWriteTimer = null;
            flushPendingScrollHistoryStateWrite(source || 'forced');
        } else if (!historyStateWriteSuppressionReason(href)) {
            schedulePendingScrollHistoryStateWrite();
        } else {
            window.clearTimeout(scrollHistoryStateWriteTimer);
            scrollHistoryStateWriteTimer = null;
        }
    }

    function protectScrollStateAfterRestore() {
        scrollRestoreProtectionUntil = Math.max(scrollRestoreProtectionUntil, Date.now() + SCROLL_RESTORE_QUIET_MS);
        if (pendingScrollHistoryStateWrite) {
            schedulePendingScrollHistoryStateWrite(scrollRestoreProtectionUntil - Date.now());
        }
    }
    flushDeferredScrollHistoryReplace = (source) => flushPendingScrollHistoryStateWrite(source || 'edge-gesture-quiet-end');

    // Suspended list and detail pages: the live transformed DOM and listeners
    // are parked in a shadow root and restored when Back returns to that entry.
    const MAX_SUSPENDED_SPA_PAGES = 3;
    const SPA_STATE_CLASSES = ['ehtw-navigation-pending', 'ehtw-page-boot', 'ehtw-reader-boot', 'ehtw-chrome-scroll-hidden'];
    let spaInlineScriptSequence = 0;

    function findSuspendedSpaPageByHref(href) {
        let absoluteHref = '';
        try { absoluteHref = new URL(href, location.href).href; } catch (_) { return null; }
        for (const record of suspendedSpaPages.values()) {
            if (record.href === absoluteHref) return record;
        }
        return null;
    }

    function collectInlineLexicalNames(scriptText) {
        const tokens = [];
        const source = String(scriptText || '');
        let braceDepth = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        for (let index = 0; index < source.length;) {
            const character = source[index];
            if (character === '/' && source[index + 1] === '/') {
                index += 2;
                while (index < source.length && source[index] !== '\n') index += 1;
                continue;
            }
            if (character === '/' && source[index + 1] === '*') {
                index += 2;
                while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
                index = Math.min(source.length, index + 2);
                continue;
            }
            if (character === '"' || character === "'" || character === '`') {
                const quote = character;
                index += 1;
                while (index < source.length) {
                    if (source[index] === '\\') index += 2;
                    else if (source[index++] === quote) break;
                }
                continue;
            }
            if (/[A-Za-z_$]/.test(character)) {
                const start = index++;
                while (index < source.length && /[\w$]/.test(source[index])) index += 1;
                tokens.push({
                    value: source.slice(start, index),
                    topLevel: braceDepth === 0 && parenDepth === 0 && bracketDepth === 0
                });
                continue;
            }
            if (character === '{') braceDepth += 1;
            else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (character === '(') parenDepth += 1;
            else if (character === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (character === '[') bracketDepth += 1;
            else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            index += 1;
        }

        const names = new Set();
        for (let index = 0; index < tokens.length - 1; index += 1) {
            if (
                tokens[index].topLevel &&
                (tokens[index].value === 'let' || tokens[index].value === 'const') &&
                tokens[index + 1].topLevel
            ) {
                names.add(tokens[index + 1].value);
            }
        }
        return names;
    }

    function isExecutableInlineClassicScript(script) {
        if (!script || script.src) return false;
        const type = String(script.getAttribute?.('type') || '').trim().toLowerCase();
        if (!type || type === 'text/javascript' || type === 'application/javascript' || type === 'text/ecmascript' || type === 'application/ecmascript') {
            return true;
        }
        return false;
    }

    function getSpaScriptSourceKey(value, base = location.href) {
        try {
            const url = new URL(value, base);
            return `${url.origin}${url.pathname}`;
        } catch (_) {
            return String(value || '');
        }
    }

    const spaExecutedScriptSources = new Set();
    function rememberSpaExternalScriptSources(root = document) {
        Array.from(root?.querySelectorAll?.('script[src]') || []).forEach((script) => {
            const source = script.getAttribute?.('src') || script.src;
            if (source) {
                spaExecutedScriptSources.add(getSpaScriptSourceKey(source, root?.baseURI || location.href));
            }
        });
    }

    function rememberSpaInlineLexicalBindings(root = document) {
        Array.from(root?.querySelectorAll?.('script') || []).forEach((script) => {
            if (!isExecutableInlineClassicScript(script)) return;
            collectInlineLexicalNames(script.textContent || '').forEach((name) => spaInlineLexicalBindings.add(name));
        });
    }

    function rewriteInlineLexicalNames(scriptText, aliases) {
        if (!aliases?.size) return String(scriptText || '');
        const source = String(scriptText || '');
        let output = '';
        let index = 0;
        let previousSignificant = '';
        while (index < source.length) {
            const character = source[index];
            if (character === '/' && source[index + 1] === '/') {
                const end = source.indexOf('\n', index + 2);
                const next = end < 0 ? source.length : end;
                output += source.slice(index, next);
                index = next;
                continue;
            }
            if (character === '/' && source[index + 1] === '*') {
                const close = source.indexOf('*/', index + 2);
                const next = close < 0 ? source.length : close + 2;
                output += source.slice(index, next);
                index = next;
                continue;
            }
            if (character === '"' || character === "'" || character === '`') {
                const quote = character;
                const start = index++;
                while (index < source.length) {
                    if (source[index] === '\\') index += 2;
                    else if (source[index++] === quote) break;
                }
                output += source.slice(start, index);
                previousSignificant = 'literal';
                continue;
            }
            if (/[A-Za-z_$]/.test(character)) {
                const start = index++;
                while (index < source.length && /[\w$]/.test(source[index])) index += 1;
                const identifier = source.slice(start, index);
                let next = index;
                while (/\s/.test(source[next] || '')) next += 1;
                const isProperty = previousSignificant === '.' || source[next] === ':';
                output += !isProperty && aliases.has(identifier) ? aliases.get(identifier) : identifier;
                previousSignificant = identifier;
                continue;
            }
            output += character;
            if (!/\s/.test(character)) previousSignificant = character;
            index += 1;
        }
        return output;
    }

    const spaInlineLexicalBindings = new Set();
    rememberSpaInlineLexicalBindings();

    function evictSuspendedSpaPage(record) {
        try { record.cleanup?.(); } catch (_) {}
        try { record.host?.remove(); } catch (_) {}
    }

    function suspendCurrentSpaPage(entryId, cleanup, href, scrollY, historyState = {}) {
        try {
            if (!spaSuspendCacheEnabled) return false;
            if (!entryId || typeof cleanup !== 'function' || !document.body) return false;
            const root = document.documentElement;
            const leavingPath = new URL(href, location.href).pathname;
            // Never park detail markup under a listing URL. If a previous SPA
            // transition left URL and DOM out of sync, rebuild the destination.
            if (
                isListLikePath(leavingPath) &&
                (root.classList.contains('ehtw-detail') || document.querySelector('#gmid'))
            ) {
                return false;
            }
            const earlyStyle = document.getElementById('ehtw-page-boot-style');
            const headNodes = Array.from(
                document.head.querySelectorAll('link[rel~="stylesheet"], style')
            ).filter((node) => node !== earlyStyle);
            const listeners = (window.__EHTW_PAGE_LISTENERS__ || []).slice();
            const viewport = document.querySelector('meta[name="viewport"]');
            const record = {
                href,
                scrollY,
                historyState: { ...(historyState || {}) },
                cleanup,
                listeners,
                headNodes,
                title: document.title,
                lang: root.lang,
                viewportContent: viewport?.getAttribute('content') || '',
                rootClass: Array.from(root.classList)
                    .filter((name) => !SPA_STATE_CLASSES.includes(name))
                    .join(' '),
                bodyAttrs: Array.from(document.body.attributes).map((a) => [a.name, a.value]),
                host: null,
                shadow: null
            };
            // 1.17.250: moving nodes into the shadow host drops the scroll
            // offsets of inner scrollers (e.g. the #gdt thumbnail strip).
            record.innerScrollPositions = [];
            document.body.querySelectorAll('*').forEach((element) => {
                const left = element.scrollLeft || 0;
                const top = element.scrollTop || 0;
                if (left > 0 || top > 0) record.innerScrollPositions.push({ element, left, top });
            });
            const host = document.createElement('div');
            host.setAttribute('aria-hidden', 'true');
            host.style.cssText = 'position:fixed;top:1000000px;left:0;width:100%;height:0;' +
                'overflow:hidden;visibility:hidden;pointer-events:none;';
            const shadow = host.attachShadow({ mode: 'open' });
            // Page-level listeners must not fire while another page is shown.
            listeners.forEach(({ target, type, listener, options }) => {
                try { target.removeEventListener?.(type, listener, options); } catch (_) {}
            });
            headNodes.forEach((node) => node.remove());
            shadow.append(...Array.from(document.body.childNodes));
            root.appendChild(host);
            record.host = host;
            record.shadow = shadow;
            suspendedSpaPages.delete(entryId);
            suspendedSpaPages.set(entryId, record);
            while (suspendedSpaPages.size > MAX_SUSPENDED_SPA_PAGES) {
                const [oldId, oldRecord] = suspendedSpaPages.entries().next().value;
                suspendedSpaPages.delete(oldId);
                evictSuspendedSpaPage(oldRecord);
            }
            return true;
        } catch (error) {
            console.warn('[EH Twitter Style] suspend failed', error);
            return false;
        }
    }

    async function resumeSuspendedSpaPage(entryId, targetUrl) {
        if (!spaSuspendCacheEnabled) return false;
        const record = suspendedSpaPages.get(entryId);
        if (!isSuspendedSpaPageCompatible(record, targetUrl)) {
            if (record) {
                suspendedSpaPages.delete(entryId);
                evictSuspendedSpaPage(record);
                console.warn('[EH Twitter Style] Discarded mismatched suspended page', {
                    target: targetUrl.href,
                    saved: record.href,
                    savedClass: record.rootClass
                });
            }
            return false;
        }
        suspendedSpaPages.delete(entryId);

        const cleanup = window.__EHTW_PAGE_CLEANUP__;
        window.__EHTW_SPA_READY__ = false;
        window.__EHTW_PAGE_CLEANUP__ = null;
        try { cleanup?.(); } catch (_) {}

        const root = document.documentElement;
        const earlyStyle = document.getElementById('ehtw-page-boot-style');
        Array.from(document.head.querySelectorAll('link[rel~="stylesheet"], style'))
            .filter((node) => node !== earlyStyle)
            .forEach((node) => node.remove());
        record.headNodes.forEach((node) => document.head.appendChild(node));
        if (earlyStyle) document.head.appendChild(earlyStyle);
        await Promise.all(record.headNodes
            .filter((node) => node.tagName === 'LINK')
            .map((link) => new Promise((resolve) => {
                if (link.sheet) return resolve();
                let timer = null;
                const finish = () => {
                    link.removeEventListener('load', finish);
                    link.removeEventListener('error', finish);
                    if (timer !== null) window.clearTimeout(timer);
                    resolve();
                };
                link.addEventListener('load', finish, { once: true });
                link.addEventListener('error', finish, { once: true });
                timer = window.setTimeout(finish, 800);
            })));

        root.className = record.rootClass;
        root.lang = record.lang || root.lang;
        document.title = record.title || document.title;
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport && record.viewportContent) viewport.setAttribute('content', record.viewportContent);
        Array.from(document.body.attributes).forEach((a) => document.body.removeAttribute(a.name));
        record.bodyAttrs.forEach(([name, value]) => document.body.setAttribute(name, value));
        if (navLogEnabled) {
            const nodes = Array.from(record.shadow.querySelectorAll('iframe, meta[http-equiv], script, form'));
            const iframes = nodes.filter((node) => node.tagName === 'IFRAME');
            const metas = nodes.filter((node) => node.tagName === 'META');
            const scripts = nodes.filter((node) => node.tagName === 'SCRIPT');
            const forms = nodes.filter((node) => node.tagName === 'FORM');
            navLog('suspended-nodes-reinsert', {
                counts: { iframe: iframes.length, metaHttpEquiv: metas.length, script: scripts.length, form: forms.length },
                iframeSrcPaths: iframes.map((node) => navLogPath(node.getAttribute('src') || '')),
                metaHttpEquiv: metas.map((node) => String(node.getAttribute('http-equiv') || '').slice(0, 40)),
                metaRefreshPaths: metas.filter((node) => String(node.getAttribute('http-equiv') || '').toLowerCase() === 'refresh')
                    .map((node) => node.getAttribute('content')?.match(/url\s*=\s*['"]?([^;'"\s]+)/i)?.[1])
                    .filter(Boolean).map(navLogPath),
                scriptSrcPaths: scripts.filter((node) => node.getAttribute('src')).map((node) => navLogPath(node.getAttribute('src'))),
                formActionPaths: forms.map((node) => navLogPath(node.getAttribute('action') || location.href))
            });
        }
        document.body.replaceChildren(...Array.from(record.shadow.childNodes));
        record.host.remove();
        const restoreInnerScrollPositions = () => {
            (record.innerScrollPositions || []).forEach(({ element, left, top }) => {
                if (!element.isConnected) return;
                try {
                    if (left) element.scrollLeft = left;
                    if (top) element.scrollTop = top;
                } catch (_) {}
            });
        };
        restoreInnerScrollPositions();
        window.requestAnimationFrame?.(restoreInnerScrollPositions);

        record.listeners.forEach(({ target, type, listener, options }) => {
            try { target.addEventListener?.(type, listener, options); } catch (_) {}
        });
        window.__EHTW_PAGE_LISTENERS__ = record.listeners;
        window.__EHTW_PAGE_CLEANUP__ = record.cleanup;
        window['__EHTW_STYLE_050__'] = true;
        window.__EHTW_SPA_READY__ = true;
        return record;
    }

    function isSuspendedSpaPageCompatible(record, targetUrl) {
        if (!record || record.href !== targetUrl.href) return false;
        const classes = new Set(String(record.rootClass || '').split(/\s+/).filter(Boolean));
        const savedIsGalleryDetail = classes.has('ehtw-detail') ||
            !!record.shadow?.querySelector?.('#gmid');
        const targetIsGallery = /^\/g\/\d+\//i.test(targetUrl.pathname);
        if (isListLikePath(targetUrl.pathname) && savedIsGalleryDetail) return false;
        if (targetIsGallery && !savedIsGalleryDetail) return false;
        return true;
    }

    async function waitForSpaFetchRetry(targetHref, retryDelayMs, retryReason) {
        if (location.href !== targetHref) {
            if (navLogEnabled) navLog('navigate-fetch-retry-abandoned', {
                target: targetHref,
                reason: retryReason,
                activeHref: location.href,
                check: 'before-backoff'
            });
            const error = new Error('SPA fetch retry cancelled because the active history URL changed');
            error.name = 'AbortError';
            throw error;
        }
        if (navLogEnabled) navLog('navigate-fetch-retry-scheduled', {
            target: targetHref,
            retryDelayMs,
            reason: retryReason
        });
        await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
        if (location.href !== targetHref) {
            if (navLogEnabled) navLog('navigate-fetch-retry-abandoned', {
                target: targetHref,
                reason: retryReason,
                activeHref: location.href,
                check: 'after-backoff'
            });
            const error = new Error('SPA fetch retry cancelled because the active history URL changed');
            error.name = 'AbortError';
            throw error;
        }
        await new Promise((resolve) => {
            const raf = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
            raf(resolve);
        });
        if (location.href !== targetHref) {
            if (navLogEnabled) navLog('navigate-fetch-retry-abandoned', {
                target: targetHref,
                reason: retryReason,
                activeHref: location.href,
                check: 'after-animation-frame'
            });
            const error = new Error('SPA fetch retry cancelled after frame because the active history URL changed');
            error.name = 'AbortError';
            throw error;
        }
        if (navLogEnabled) navLog('navigate-fetch-retry-ready', { target: targetHref, reason: retryReason });
    }

    async function fetchSpaRouteResponse(targetHref) {
        const requestOptions = {
            credentials: 'same-origin',
            cache: 'default',
            redirect: 'manual'
        };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const response = await window.fetch(targetHref, requestOptions);
                if (
                    attempt === 0 &&
                    [502, 503, 504].includes(Number(response?.status))
                ) {
                    await waitForSpaFetchRetry(targetHref, 700, `http-${response.status}`);
                    continue;
                }
                return response;
            } catch (error) {
                if (attempt > 0 || error?.name !== 'TypeError') throw error;
                // Safari may abort a fetch during the edge-swipe snapshot. Give
                // the gesture/visibility transition a longer settling window,
                // then retry only if this history destination is still active.
                await waitForSpaFetchRetry(targetHref, 700, 'typeerror');
            }
        }
        return null;
    }

    async function navigateSpa(targetValue, options = {}) {
        let targetUrl;
        try {
            targetUrl = new URL(targetValue, location.href);
        } catch (_) {
            return false;
        }
        if (
            targetUrl.origin !== location.origin ||
            !isGallerySiteOrigin(location.origin)
        ) return false;
        if (spaNavigationInProgress) {
            const queuedMode = options.historyMode || 'push';
            if (navLogEnabled) navLog('navigate-queued', {
                target: targetUrl.href,
                mode: queuedMode,
                replacingPending: pendingSpaPop ? { ...pendingSpaPop } : null
            });
            if (queuedMode === 'pop') {
                if (navLogEnabled && pendingSpaPop) navLog('pendingSpaPop-superseded', {
                    previous: { href: pendingSpaPop.href, mode: pendingSpaPop.historyMode || null },
                    by: targetUrl.href,
                    input: 'pop'
                });
                pendingSpaPop = {
                    href: targetUrl.href,
                    scrollY: options.scrollY,
                    historyState: recoverSpaHistoryState(targetUrl.href, options.historyState || window.history.state),
                    historyMode: 'pop'
                };
                if (navLogEnabled) navLog('pendingSpaPop-queued', {
                    input: 'pop', pending: { href: pendingSpaPop.href, scrollY: pendingSpaPop.scrollY ?? null, mode: pendingSpaPop.historyMode }
                });
            } else if (queuedMode === 'push') {
                // Keep the in-flight push entry as the sole entry for a rapid
                // click burst. If a traversal happened first, pushing naturally
                // truncates the abandoned forward entry.
                const currentState = recoverSpaHistoryState(location.href, window.history.state);
                const afterTraversal = pendingSpaPop?.historyMode === 'pop' ||
                    spaNavigationHistoryMode === 'pop' ||
                    currentState.ehtwSpaRoute !== true;
                if (navLogEnabled && pendingSpaPop) navLog('pendingSpaPop-superseded', {
                    previous: { href: pendingSpaPop.href, mode: pendingSpaPop.historyMode || null },
                    by: targetUrl.href,
                    input: 'click'
                });
                const nextState = afterTraversal
                    ? {
                        ...currentState,
                        ehtwSpa: true,
                        ehtwSpaRoute: true,
                        ehtwSpaPreviousHref: location.href,
                        ehtwSpaReturnBackTarget: false,
                        ehtwEntryId: newSpaEntryId(),
                        ehtwSpaDepth: (readFiniteNumber(currentState.ehtwSpaDepth) ?? 0) + 1,
                        ehtwScrollY: 0
                    }
                    : {
                        ...currentState,
                        ehtwSpa: true,
                        ehtwSpaRoute: true,
                        ehtwSpaPreviousHref: currentState.ehtwSpaPreviousHref || spaRenderedHref,
                        ehtwEntryId: currentState.ehtwEntryId || newSpaEntryId(),
                        ehtwScrollY: 0
                    };
                if (afterTraversal) window.history.pushState(nextState, '', targetUrl.href);
                else safeReplaceHistoryState(window.history, nextState, '', targetUrl.href, 'queued-click-supersede');
                rememberSpaHistoryState(targetUrl.href, nextState);
                pendingSpaPop = {
                    href: targetUrl.href,
                    scrollY: 0,
                    historyState: nextState,
                    historyMode: 'push'
                };
                if (navLogEnabled) navLog('pendingSpaPop-queued', {
                    input: 'click', afterTraversal, pending: { href: pendingSpaPop.href, scrollY: 0, mode: pendingSpaPop.historyMode }
                });
            }
            return false;
        }
        if (!window.__EHTW_SPA_READY__) {
            if (options.historyMode === 'pop' && location.href !== spaRenderedHref) {
                pendingSpaPop = {
                    href: location.href,
                    scrollY: Number(options.scrollY) || getSavedSpaScroll(location.href),
                    historyState: recoverSpaHistoryState(location.href, options.historyState || window.history.state),
                    historyMode: 'pop'
                };
                if (navLogEnabled) navLog('pendingSpaPop-queued', {
                    input: 'pop-not-ready', pending: { href: pendingSpaPop.href, scrollY: pendingSpaPop.scrollY, mode: 'pop' }
                });
            }
            if (navLogEnabled) navLog('navigate-abandoned-not-ready', { target: targetUrl.href, mode: options.historyMode || 'push' });
            return false;
        }

        // document-start userscripts may be initialized before native body
        // scripts exist. Capture their bindings right before the first swap.
        rememberSpaInlineLexicalBindings();
        rememberSpaExternalScriptSources();
        const historyMode = options.historyMode || 'push';
        let renderedPathname = location.pathname;
        try { renderedPathname = new URL(spaRenderedHref, location.href).pathname; } catch (_) {}
        const leavingReaderRoute = /^\/s\//.test(renderedPathname);
        const enteringReaderRoute = /^\/s\//.test(targetUrl.pathname);
        if (leavingReaderRoute && !enteringReaderRoute) controlMainWorldReader('reader-leave');
        else if (!leavingReaderRoute && enteringReaderRoute) controlMainWorldReader('reader-enter');
        if (typeof controlMainWorldReader === 'function') controlMainWorldReader('route-leave');
        // Persist the current route's latest scroll before navigation begins.
        // This runs before the navigation lock, and the helper itself refuses
        // to call replaceState during edge gestures or restore quiet windows.
        cancelActiveSpaScrollRestore?.();
        if (historyMode !== 'pop') saveCurrentScrollForSpa('navigate-before', true);
        const leavingHref = location.href;
        const leavingState = recoverSpaHistoryState(leavingHref, window.history.state);
        const scrollAtStart = window.scrollY || 0;
        const leavingPathname = location.pathname;
        let leavingEntryIdUsed = leavingState.ehtwEntryId || null;
        let historyPrepared = false;
        let navigationOutcome = 'in-progress';
        const popHistoryState = historyMode === 'pop'
            ? recoverSpaHistoryState(targetUrl.href, options.historyState || window.history.state)
            : null;
        if (navLogEnabled) navLog('navigate-start', {
            target: targetUrl.href,
            mode: historyMode,
            options: { scrollY: options.scrollY ?? null, restoreScrollY: options.restoreScrollY ?? null },
            historyState: summarizeNavLogState(leavingState)
        });
        spaNavigationInProgress = true;
        spaNavigationHistoryMode = historyMode;
        window.__EHTW_SCROLL_SAVE_LOCK__ = true;
        let scrollRestoreOwnsLock = false;
        document.documentElement.classList.add('ehtw-navigation-pending');
        const queueActiveAddressIfStale = () => {
            if (location.href === targetUrl.href) return false;
            if (navLogEnabled && pendingSpaPop) navLog('pendingSpaPop-superseded', {
                previous: { href: pendingSpaPop.href, mode: pendingSpaPop.historyMode || null },
                by: location.href,
                input: 'stale-active-address'
            });
            if (navLogEnabled) navLog('navigate-abandoned-stale-address', {
                target: targetUrl.href,
                activeHref: location.href,
                activeState: summarizeNavLogState(window.history.state)
            });
            pendingSpaPop = {
                href: location.href,
                scrollY: Number(recoverSpaHistoryState(location.href, window.history.state).ehtwScrollY) || getSavedSpaScroll(location.href),
                historyState: recoverSpaHistoryState(location.href, window.history.state),
                historyMode: 'pop'
            };
            if (navLogEnabled) navLog('pendingSpaPop-queued', {
                input: 'stale-active-address', pending: { href: pendingSpaPop.href, scrollY: pendingSpaPop.scrollY, mode: pendingSpaPop.historyMode }
            });
            document.documentElement.classList.remove('ehtw-navigation-pending');
            window.clearTimeout?.(navigationResetTimer);
            navigationResetTimer = null;
            return true;
        };
        try {
            if (historyMode === 'pop') {
                const suspendedMatch = spaSuspendCacheEnabled ? Array.from(suspendedSpaPages.entries())
                    .find(([, record]) => record.href === targetUrl.href) : null;
                const entryId = spaSuspendCacheEnabled ? (popHistoryState.ehtwEntryId || suspendedMatch?.[0]) : null;
                if (entryId && suspendedSpaPages.has(entryId)) {
                    const resumed = await resumeSuspendedSpaPage(entryId, targetUrl);
                    if (resumed) {
                        spaRenderedHref = targetUrl.href;
                        const resumedHistoryState = recoverSpaHistoryState(targetUrl.href, resumed.historyState || popHistoryState);
                        const resumedScrollY = Number(resumed.scrollY) || Number(popHistoryState.ehtwScrollY) ||
                            Number(options.scrollY) || getSavedSpaScroll(targetUrl.href);
                        queueScrollHistoryStateWrite(targetUrl.href, resumedHistoryState, resumedScrollY, 'suspended-pop-state-repair');
                        scrollRestoreOwnsLock = true;
                        restoreSpaScrollPosition(
                            resumedScrollY,
                            'suspended-pop'
                        );
                        navigationOutcome = 'resumed-suspended-page';
                        window.__EHTW_CONTINUE_GALLERY_BACK_TRAVERSAL__?.();
                        return true;
                    }
                }
            }
            if (historyMode === 'replace') {
                const suspendedEntry = spaSuspendCacheEnabled ? Array.from(suspendedSpaPages.entries())
                    .find(([, record]) => record.href === targetUrl.href) : null;
                if (suspendedEntry) {
                    const [entryId] = suspendedEntry;
                    const resumed = await resumeSuspendedSpaPage(entryId, targetUrl);
                    if (resumed) {
                        const sourceState = resumed.historyState || {};
                        const resumedState = {
                            ...sourceState,
                            ehtwSpa: true,
                            ehtwSpaRoute: false,
                            ehtwSpaPreviousHref: options.returnBackHref || sourceState.ehtwSpaPreviousHref || '',
                            ehtwSpaReturnBackTarget: options.returnBackTarget === true,
                            ehtwEntryId: entryId,
                            ehtwSpaDepth: readFiniteNumber(sourceState.ehtwSpaDepth) ?? 0,
                            ehtwScrollY: Number(resumed.scrollY) || Number(options.restoreScrollY) || 0
                        };
                        if (safeReplaceHistoryState(window.history, resumedState, '', targetUrl.href, 'suspended-replace')) {
                            rememberSpaHistoryState(targetUrl.href, resumedState);
                        }
                        try {
                            window.sessionStorage?.removeItem(galleryBackTraversalStorageKey);
                        } catch (_) {}
                        scrollRestoreOwnsLock = true;
                        restoreSpaScrollPosition(
                            Number(resumed.scrollY) || Number(options.restoreScrollY) || 0,
                            'suspended-replace'
                        );
                        spaRenderedHref = targetUrl.href;
                        navigationOutcome = 'resumed-suspended-page';
                        return true;
                    }
                }
            }
            const previousScrollY = scrollAtStart || window.scrollY || 0;
            if (historyMode === 'push') {
                // Add the entry while the initiating click still has transient
                // user activation. Safari can skip async-created pushState items
                // during its native Back gesture.
                if (!/^\/s\//i.test(location.pathname)) saveSpaScroll(location.href, previousScrollY);
                const previousGalleryId = getGalleryIdFromUrl(location.href);
                const targetGalleryId = getGalleryIdFromUrl(targetUrl.href);
                const leavingDepth = readFiniteNumber(leavingState.ehtwSpaDepth) ?? 0;
                const leavingEntryId = leavingState.ehtwEntryId || newSpaEntryId();
                leavingEntryIdUsed = leavingEntryId;
                if (
                    targetGalleryId &&
                    targetGalleryId !== previousGalleryId &&
                    isListLikePath(leavingPathname)
                ) {
                    try {
                        window.sessionStorage?.setItem(
                            `ehtw-gallery-return-v1:${targetGalleryId}`,
                            leavingHref
                        );
                        window.sessionStorage?.setItem(
                            galleryReturnDepthKey(targetGalleryId),
                            String(leavingDepth)
                        );
                    } catch (_) {}
                }
                const state = {
                    ...leavingState,
                    ehtwSpa: true,
                    ehtwSpaRoute: true,
                    ehtwSpaPreviousHref: leavingHref,
                    ehtwSpaReturnBackTarget: false,
                    ehtwEntryId: newSpaEntryId(),
                    ehtwSpaDepth: leavingDepth + 1,
                    ehtwScrollY: 0
                };
                const preparedLeavingState = {
                    ...leavingState,
                    ehtwSpa: true,
                    ehtwEntryId: leavingEntryId,
                    ehtwSpaDepth: leavingDepth,
                    ehtwScrollY: previousScrollY
                };
                rememberSpaHistoryState(leavingHref, preparedLeavingState);
                window.history.pushState(state, '', targetUrl.href);
                rememberSpaHistoryState(targetUrl.href, state);
                historyPrepared = true;
                if (isListLikePath(targetUrl.pathname)) {
                    try {
                        window.sessionStorage?.setItem(
                            spaBackTargetStorageKey(targetUrl.href),
                            leavingHref
                        );
                    } catch (_) {}
                }
            }
            const response = await fetchSpaRouteResponse(targetUrl.href);
            if (!response?.ok) throw new Error(`SPA route request failed: ${response?.status || 'no response'}`);
            const pageText = await response.text();
            if ((historyPrepared || historyMode === 'pop') && queueActiveAddressIfStale()) {
                navigationOutcome = 'abandoned-stale-address';
                return false;
            }
            const nextDocument = new window.DOMParser().parseFromString(pageText, 'text/html');
            const nextPath = targetUrl.pathname;
            const isReaderTarget = /^\/s\//i.test(nextPath);
            const targetSupported = isReaderTarget
                ? !!(nextDocument.querySelector('#img') || nextDocument.querySelector('#i3 img'))
                : !!(
                    nextDocument.querySelector('#nb') ||
                    nextDocument.querySelector('table.itg.gltc, table.itg.gltm, table.itg.glte, div.itg.gld, #searchbox form') ||
                    nextDocument.querySelector('form[name="ipb_login_form"]') ||
                    /^\/g\/\d+\/[0-9a-f]+\/?$/i.test(nextPath)
                );
            if (!targetSupported) throw new Error('SPA target page is not supported');

            // E-Hentai can return a valid site shell for the wrong page type.
            // Never install gallery metadata into a list URL just because #nb exists.
            const responseIsGalleryDetail = !!nextDocument.querySelector('#gmid');
            const targetIsGalleryDetail = /^\/g\/\d+\//i.test(nextPath);
            if (
                (isListLikePath(nextPath) && responseIsGalleryDetail) ||
                (targetIsGalleryDetail && !responseIsGalleryDetail)
            ) {
                throw new Error('SPA response content does not match the target route');
            }

            // From here on the current DOM is being replaced by targetUrl.
            // Keep this marker pinned to the route whose content is in flight,
            // so a queued Back is replayed even if it returns to the old URL.
            spaRenderedHref = targetUrl.href;

            if (historyMode === 'replace') {
                const replacementState = {
                    ...(window.history.state || {}),
                    ehtwSpa: true,
                    ehtwSpaRoute: false,
                    ehtwSpaPreviousHref: options.returnBackHref || '',
                    ehtwSpaReturnBackTarget: options.returnBackTarget === true,
                    ehtwEntryId: newSpaEntryId(),
                    ehtwSpaDepth: 0,
                    ehtwScrollY: Number(options.restoreScrollY) || 0
                };
                if (safeReplaceHistoryState(window.history, replacementState, '', targetUrl.href, 'spa-route-replace')) {
                    rememberSpaHistoryState(targetUrl.href, replacementState);
                }
                historyPrepared = true;
            }

            const cleanup = window.__EHTW_PAGE_CLEANUP__;
            window.__EHTW_SPA_READY__ = false;
            window.__EHTW_PAGE_CLEANUP__ = null;
            const leavingIsListOrGalleryDetail = isListLikePath(leavingPathname) ||
                /^\/g\/\d+\//i.test(leavingPathname);
            const suspended = historyMode === 'push' &&
                leavingIsListOrGalleryDetail &&
                suspendCurrentSpaPage(leavingEntryIdUsed, cleanup, leavingHref, previousScrollY, leavingState);
            if (!suspended) cleanup?.();
            try {
                const traversalGalleryId = window.sessionStorage?.getItem('ehtw-gallery-back-traversal-v1');
                if (traversalGalleryId && getGalleryIdFromUrl(targetUrl.href) !== traversalGalleryId) {
                    window.sessionStorage?.removeItem('ehtw-gallery-back-traversal-v1');
                }
            } catch (_) {}

            const root = document.documentElement;
            const preserveTouchUi = hasTouchInput || root.classList.contains('ehtw-touch-ui');
            root.className = nextDocument.documentElement.className || '';
            if (preserveTouchUi) root.classList.add('ehtw-touch-ui');
            root.classList.add(isReaderTarget ? 'ehtw-reader-boot' : 'ehtw-page-boot');
            root.lang = nextDocument.documentElement.lang || root.lang || 'en';
            document.title = nextDocument.title || document.title;

            const earlyStyle = document.getElementById('ehtw-page-boot-style');
            Array.from(document.head.querySelectorAll('link[rel~="stylesheet"], style'))
                .filter((node) => node !== earlyStyle)
                .forEach((node) => node.remove());
            Array.from(nextDocument.head.querySelectorAll('link[rel~="stylesheet"], style'))
                .forEach((node) => document.head.appendChild(document.importNode(node, true)));
            const targetViewport = nextDocument.querySelector('meta[name="viewport"]');
            let viewport = document.querySelector('meta[name="viewport"]');
            if (targetViewport) {
                if (!viewport) {
                    viewport = document.createElement('meta');
                    viewport.name = 'viewport';
                    document.head.appendChild(viewport);
                }
                viewport.setAttribute('content', targetViewport.getAttribute('content') || 'width=device-width, initial-scale=1');
            }
            if (earlyStyle) document.head.appendChild(earlyStyle);

            const nextBody = nextDocument.body;
            const targetHeadScripts = Array.from(
                nextDocument.head.querySelectorAll('script[src]')
            );
            const targetBodyScripts = Array.from(nextBody.querySelectorAll('script'));
            // Scripts can leave document.scripts when a list is parked in its
            // shadow root. Keep a route-independent registry so native
            // top-level bindings (for example ehg_index.c.js's `matchyear`)
            // are not executed again in this Window.
            rememberSpaExternalScriptSources();
            const existingScriptSources = new Set(
                spaExecutedScriptSources
            );
            const inlineLexicalAliases = new Map();
            targetBodyScripts.forEach((script) => {
                if (!isExecutableInlineClassicScript(script)) return;
                collectInlineLexicalNames(script.textContent || '').forEach((name) => {
                    if (spaInlineLexicalBindings.has(name)) {
                        if (!inlineLexicalAliases.has(name)) {
                            spaInlineScriptSequence += 1;
                            inlineLexicalAliases.set(name, `${name}__ehtwSpa${spaInlineScriptSequence}`);
                        }
                    } else {
                        spaInlineLexicalBindings.add(name);
                    }
                });
            });
            Array.from(document.body.attributes).forEach((attribute) => {
                document.body.removeAttribute(attribute.name);
            });
            Array.from(nextBody.attributes).forEach((attribute) => {
                document.body.setAttribute(attribute.name, attribute.value);
            });
            const children = Array.from(nextBody.childNodes).map((node) =>
                document.importNode(node, true)
            );
            document.body.replaceChildren(...children);

            // Native inline body scripts may call helpers provided by scripts
            // in the target page's head. Load missing same-origin dependencies
            // before replaying those body scripts in this same-document route.
            if (typeof controlMainWorldReader === 'function') controlMainWorldReader('route-scripts-start');
            for (const inertScript of targetHeadScripts) {
                const sourceScriptUrl = new URL(
                    inertScript.getAttribute('src'),
                    targetUrl.href
                ).href;
                const sourceScriptKey = getSpaScriptSourceKey(sourceScriptUrl, targetUrl.href);
                if (
                    new URL(sourceScriptUrl).origin !== location.origin ||
                    existingScriptSources.has(sourceScriptKey)
                ) continue;

                const liveScript = document.createElement('script');
                Array.from(inertScript.attributes).forEach((attribute) =>
                    liveScript.setAttribute(attribute.name, attribute.value)
                );
                liveScript.async = false;
                liveScript.removeAttribute('defer');
                liveScript.src = sourceScriptUrl;
                existingScriptSources.add(sourceScriptKey);
                spaExecutedScriptSources.add(sourceScriptKey);
                await new Promise((resolve) => {
                    let finished = false;
                    let timeout = null;
                    const finish = () => {
                        if (finished) return;
                        finished = true;
                        if (timeout !== null) window.clearTimeout(timeout);
                        resolve();
                    };
                    liveScript.addEventListener('load', finish, { once: true });
                    liveScript.addEventListener('error', finish, { once: true });
                    timeout = window.setTimeout(finish, 2000);
                    document.head.appendChild(liveScript);
                });
            }

            // Recreate page-provided scripts so native inline behavior is present
            // before the userscript transforms the fetched page.
            const importedBodyScripts = Array.from(document.body.querySelectorAll('script'));
            for (let scriptIndex = 0; scriptIndex < targetBodyScripts.length; scriptIndex += 1) {
                const inertScript = targetBodyScripts[scriptIndex];
                const inertTarget = importedBodyScripts[scriptIndex];
                if (!inertTarget) continue;
                const sourceScriptUrl = inertScript.getAttribute('src')
                    ? new URL(inertScript.getAttribute('src'), targetUrl.href).href
                    : '';
                const sourceScriptKey = sourceScriptUrl
                    ? getSpaScriptSourceKey(sourceScriptUrl, targetUrl.href)
                    : '';
                if (sourceScriptUrl && existingScriptSources.has(sourceScriptKey)) {
                    inertTarget.remove();
                    continue;
                }
                const liveScript = document.createElement('script');
                Array.from(inertScript.attributes).forEach((attribute) =>
                    liveScript.setAttribute(attribute.name, attribute.value)
                );
                if (sourceScriptUrl) {
                    liveScript.removeAttribute('defer');
                    liveScript.async = false;
                    const loaded = new Promise((resolve) => {
                        let finished = false;
                        let timeout = null;
                        const finish = () => {
                            if (finished) return;
                            finished = true;
                            if (timeout !== null) window.clearTimeout(timeout);
                            resolve();
                        };
                        liveScript.addEventListener('load', finish, { once: true });
                        liveScript.addEventListener('error', finish, { once: true });
                        timeout = window.setTimeout(finish, 2000);
                    });
                    liveScript.src = sourceScriptUrl;
                    existingScriptSources.add(sourceScriptKey);
                    spaExecutedScriptSources.add(sourceScriptKey);
                    inertTarget.replaceWith(liveScript);
                    await loaded;
                    continue;
                } else {
                    liveScript.textContent = rewriteInlineLexicalNames(
                        inertScript.textContent || '',
                        inlineLexicalAliases
                    );
                }
                inertTarget.replaceWith(liveScript);
            }

            if (typeof controlMainWorldReader === 'function') controlMainWorldReader('route-scripts-end');

            if ((historyPrepared || historyMode === 'pop') && queueActiveAddressIfStale()) return false;
            document.documentElement.dataset.ehtwScriptVersion = '1.17.276';
            window[ '__EHTW_STYLE_050__' ] = false;
            window.__EHTW_SPA_READY__ = false;
            runMain();
            if (typeof controlMainWorldReader === 'function') controlMainWorldReader('route-snapshot');
            if (!window.__EHTW_SPA_READY__) {
                throw new Error('SPA route initialization did not finish');
            }
            if (historyMode === 'pop') {
                spaRenderedHref = location.href;
                const destinationHistoryState = recoverSpaHistoryState(
                    targetUrl.href,
                    window.history.state || popHistoryState
                );
                const destinationScrollY = Number(options.scrollY) ||
                    Number(destinationHistoryState.ehtwScrollY) ||
                    getSavedSpaScroll(targetUrl.href);
                rememberSpaHistoryState(targetUrl.href, destinationHistoryState);
                if (!window.history.state?.ehtwSpa || !window.history.state?.ehtwEntryId) {
                    queueScrollHistoryStateWrite(targetUrl.href, destinationHistoryState, destinationScrollY, 'pop-state-repair');
                }
                scrollRestoreOwnsLock = true;
                restoreSpaScrollPosition(destinationScrollY, 'popstate-or-reconcile');
                // SPA popstate does not emit pageshow. Continue the multi-entry
                // gallery-back traversal so Back reaches the source list.
                window.__EHTW_CONTINUE_GALLERY_BACK_TRAVERSAL__?.();
            } else if (Number(options.restoreScrollY) > 0) {
                scrollRestoreOwnsLock = true;
                restoreSpaScrollPosition(options.restoreScrollY, 'push-restore');
            } else {
                window.scrollTo?.(0, 0);
                if (historyMode === 'push') saveSpaScroll(location.href, 0);
            }
            spaRenderedHref = location.href;
            navigationOutcome = 'rendered';
            return true;
        } catch (error) {
            if ((historyPrepared || historyMode === 'pop') && location.href !== targetUrl.href) {
                queueActiveAddressIfStale();
                navigationOutcome = 'abandoned-after-error';
                return false;
            }
            navigationOutcome = 'document-fallback';
            if (navLogEnabled) navLog('navigate-fallback', {
                target: targetUrl.href,
                mode: historyMode,
                reason: String(error?.message || error),
                historyPrepared,
                fallbackScrollY: Number(options.scrollY) || Number(options.restoreScrollY) || Number(window.history.state?.ehtwScrollY) || getSavedSpaScroll(targetUrl.href)
            });
            console.warn('[EH Twitter Style] SPA navigation failed; falling back to document navigation', error);
            window.__EHTW_SPA_READY__ = false;
            const fallbackScrollY = Number(options.scrollY) ||
                Number(options.restoreScrollY) ||
                Number(window.history.state?.ehtwScrollY) ||
                getSavedSpaScroll(targetUrl.href);
            if (
                (historyMode === 'pop' || historyMode === 'replace') &&
                isListLikePath(targetUrl.pathname) &&
                fallbackScrollY > 0
            ) {
                try {
                    window.sessionStorage?.setItem(
                        spaScrollPageshowRestoreKey(targetUrl.href),
                        '1'
                    );
                } catch (_) {}
            }
            if (historyMode === 'replace' || historyMode === 'pop' || historyPrepared) {
                if (navLogEnabled) navLog('script-navigation-call', { method: 'location.replace', source: 'navigateSpa-fallback', targetPath: targetUrl.pathname, stack: navLogStack() });
                location.replace(targetUrl.href);
            } else {
                if (navLogEnabled) navLog('script-navigation-call', { method: 'location.assign', source: 'navigateSpa-fallback', targetPath: targetUrl.pathname, stack: navLogStack() });
                location.assign(targetUrl.href);
            }
            return false;
        } finally {
            if (navLogEnabled) navLog('navigate-finish', {
                target: targetUrl.href,
                mode: historyMode,
                outcome: navigationOutcome,
                activeHref: location.href,
                renderedHref: spaRenderedHref,
                historyPrepared
            });
            if (navLogEnabled) {
                try {
                    window.sessionStorage?.setItem(NAV_LOG_HEARTBEAT_KEY, JSON.stringify({
                        t: Date.now(),
                        href: location.href,
                        suspendedCount: suspendedSpaPages.size,
                        approxImageCount: document.images?.length || 0
                    }));
                } catch (_) {}
            }
            spaNavigationInProgress = false;
            spaNavigationHistoryMode = null;
            if (!scrollRestoreOwnsLock) window.__EHTW_SCROLL_SAVE_LOCK__ = false;
            if (pendingScrollHistoryStateWrite) flushPendingScrollHistoryStateWrite('navigation-finish');
            const pending = pendingSpaPop;
            pendingSpaPop = null;
            if (pending && location.href !== spaRenderedHref) {
                if (navLogEnabled) navLog('pending-pop-replay-scheduled', {
                    pending: { href: pending.href, scrollY: pending.scrollY ?? null, mode: pending.historyMode || null },
                    activeHref: location.href,
                    renderedHref: spaRenderedHref
                });
                window.setTimeout(() => {
                    const destinationHref = location.href;
                    if (navLogEnabled) navLog('pending-pop-replay', {
                        pending: { href: pending.href, scrollY: pending.scrollY ?? null, mode: pending.historyMode || null },
                        destinationHref,
                        historyState: summarizeNavLogState(window.history.state)
                    });
                    navigateSpa(destinationHref, {
                        historyMode: 'pop',
                        historyState: recoverSpaHistoryState(destinationHref, window.history.state || pending.historyState),
                        scrollY: Number(recoverSpaHistoryState(destinationHref, window.history.state || pending.historyState).ehtwScrollY) ||
                            (pending.href === destinationHref ? Number(pending.scrollY) : 0) ||
                            getSavedSpaScroll(destinationHref)
                    });
                }, 0);
            } else if (pending && navLogEnabled) {
                navLog('pending-pop-discarded-already-rendered', {
                    pending: { href: pending.href, mode: pending.historyMode || null },
                    renderedHref: spaRenderedHref
                });
            }
        }
    }

    function replayPendingSpaPopIfReady(source = 'ready') {
        if (!pendingSpaPop || pendingSpaPop.historyMode !== 'pop' ||
            spaNavigationInProgress || !window.__EHTW_SPA_READY__) return false;
        const pending = pendingSpaPop;
        const destinationHref = location.href;
        if (destinationHref === spaRenderedHref) {
            pendingSpaPop = null;
            if (navLogEnabled) navLog('pending-pop-discarded-already-rendered', {
                source,
                pending: { href: pending.href, mode: pending.historyMode },
                renderedHref: spaRenderedHref
            });
            return false;
        }
        pendingSpaPop = null;
        if (navLogEnabled) navLog('pending-pop-replay', {
            source,
            pending: { href: pending.href, scrollY: pending.scrollY ?? null, mode: pending.historyMode },
            destinationHref,
            historyState: summarizeNavLogState(window.history.state)
        });
        window.setTimeout(() => {
            const activeHref = location.href;
            navigateSpa(activeHref, {
                historyMode: 'pop',
                historyState: recoverSpaHistoryState(activeHref, window.history.state || pending.historyState),
                scrollY: Number(recoverSpaHistoryState(activeHref, window.history.state || pending.historyState).ehtwScrollY) ||
                    (pending.href === activeHref ? Number(pending.scrollY) : 0) ||
                    getSavedSpaScroll(activeHref)
            });
        }, 0);
        return true;
    }

    window.__EHTW_SPA_NAVIGATE__ = navigateSpa;

    // Safari can change the active same-document history URL during its edge
    // Back gesture without delivering popstate for some script-created entries.
    // Reconcile only when the router is idle and the URL differs from the DOM.
    setUserScriptInterval(() => {
        if (
            !isGallerySiteOrigin(location.origin) ||
            !window.__EHTW_SPA_READY__ ||
            location.href === spaRenderedHref
        ) return;
        if (spaNavigationInProgress) {
            if (navLogEnabled) navLog('reconcile-skipped', {
                reason: 'navigation-in-progress',
                currentState: summarizeNavLogState(window.history.state)
            });
            return;
        }
        if (navLogEnabled) navLog('reconcile-trigger', {
            reason: 'idle-url-differs-from-rendered-route',
            currentState: summarizeNavLogState(window.history.state)
        });
        navigateSpa(location.href, {
            historyMode: 'pop',
            scrollY: Number(window.history.state?.ehtwScrollY) ||
                getSavedSpaScroll(location.href)
        });
    }, 250);

    if (document.readyState === 'loading') {
        addUserScriptListener(document, 'DOMContentLoaded', () => {
            controlMainWorldReader('route-scripts-end');
            runMain();
        }, { once: true });
        if (navLogEnabled) addUserScriptListener(document, 'DOMContentLoaded', () => navLog('navigation-log-enabled', { version: document.documentElement.dataset.ehtwScriptVersion, suspendCache: spaSuspendCacheEnabled ? 'on' : 'off' }), { once: true });
        if (navLogPanelRequested) addUserScriptListener(document, 'DOMContentLoaded', showNavLogPanel, { once: true });
    } else {
        controlMainWorldReader('route-scripts-end');
        runMain();
        if (navLogEnabled) navLog('navigation-log-enabled', { version: document.documentElement.dataset.ehtwScriptVersion, suspendCache: spaSuspendCacheEnabled ? 'on' : 'off' });
        if (navLogPanelRequested) showNavLogPanel();
    }
})();
