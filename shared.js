// Shared URL contracts for the popup, service worker and isolated content script.
// No Odoo internals or page credentials are exposed to the extension.
(() => {
  const BUILTIN_PATTERN = '*://*.odoo.com/*';
  const falseValues = new Set(['', '0', 'false', 'off', 'no', 'n', 'f']);

  function normalizeDebug(value) {
    return [...new Set(String(value ?? '').split(',').map(mode => mode.trim().toLowerCase())
      .map(mode => falseValues.has(mode) ? '' : ['assets', 'tests'].includes(mode) ? mode : '1')
      .filter(Boolean))].join(',');
  }

  function isBackendUrl(value) {
    const url = new URL(value);
    return /^\/(odoo|scoped_app)(\/|$)/.test(url.pathname) || /^\/web\/?$/.test(url.pathname);
  }

  function isDebugExcluded(value) {
    const url = new URL(value);
    const publicSite = ['odoo.com', 'www.odoo.com'].includes(url.hostname);
    return (publicSite && /^\/(?:[a-z]{2}(?:[_-][a-z]{2})?\/)?(?:help|my\/databases)(\/|$)/i.test(url.pathname))
      || /(?:^|\/)slides(\/|$)/.test(url.pathname)
      || /\/odoo\/(?:website|knowledge)(\/|$)/.test(url.pathname);
  }

  function recordIdentity(value) {
    const url = new URL(value);
    const legacy = /^\/web\/?$/.test(url.pathname);
    const params = legacy ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
    const identity = [url.origin, url.searchParams.get('db') || '', legacy ? '/web' : url.pathname.replace(/\/$/, '')];
    // Odoo 17 routes in the hash; 18–19 encode the action stack/resId in the path.
    // Anchors, company selection, debug, view type and message highlights are not records.
    for (const key of ['action', 'model', 'id', 'resId', 'res_id', 'active_id', 'document_id']) {
      const current = params.get(key);
      if (current !== null) identity.push([key, current]);
    }
    return JSON.stringify(identity);
  }

  function isRecordSave(previous, current) {
    const before = new URL(previous); const after = new URL(current);
    if (/^\/web\/?$/.test(before.pathname) && /^\/web\/?$/.test(after.pathname)) {
      const draft = new URLSearchParams(before.hash.slice(1)); const saved = new URLSearchParams(after.hash.slice(1));
      if (draft.get('id') || !/^[1-9]\d*$/.test(saved.get('id') || '')) return false;
      saved.delete('id'); before.hash = draft.toString(); after.hash = saved.toString();
    } else {
      if (!isBackendUrl(previous) || !/\/new\/?$/.test(before.pathname) || !/\/[1-9]\d*\/?$/.test(after.pathname)) return false;
      before.pathname = before.pathname.replace(/\/new\/?$/, '');
      after.pathname = after.pathname.replace(/\/[1-9]\d*\/?$/, '');
    }
    return recordIdentity(before.href) === recordIdentity(after.href);
  }

  function matchesPattern(value, pattern) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      if (pattern === '<all_urls>') return true;
      const parts = /^(\*|https?):\/\/([^/]+)\/(.*)$/.exec(pattern);
      if (!parts || (parts[1] !== '*' && parts[1] + ':' !== url.protocol)) return false;
      const authority = /^(\[[^\]]+\]|[^:]+)(?::(\*|\d+))?$/.exec(parts[2]);
      if (!authority) return false;
      const host = authority[1].toLowerCase();
      const port = authority[2];
      if (port && port !== '*' && port !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false;
      const actual = url.hostname;
      const hostMatches = host === '*' || host === actual
        || (host.startsWith('*.') && (actual === host.slice(2) || actual.endsWith('.' + host.slice(2))));
      // Host permissions ignore the path; all registrations use /*.
      return hostMatches;
    } catch (_) { return false; }
  }

  globalThis.ChatterUtils = Object.freeze({ BUILTIN_PATTERN, normalizeDebug, isBackendUrl, isDebugExcluded, recordIdentity, isRecordSave, matchesPattern });
})();
