// The worker owns read/modify/write operations so concurrent tabs cannot lose data.
importScripts('shared.js');
const U = globalThis.ChatterUtils;
const SCRIPT_ID = 'dynamic-chatter-content';
let registrationQueue = Promise.resolve();
let dataQueue = Promise.resolve();
let debugQueue = Promise.resolve();

function serialized(queue, operation, assign) {
  const result = queue.then(operation);
  assign(result.catch(() => {}));
  return result;
}

async function revokeRunningScripts(origins) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id && /^https?:/.test(tab.url || '')
    && !origins.some(pattern => U.matchesPattern(tab.url, pattern))).map(tab =>
    chrome.tabs.sendMessage(tab.id, { action: 'deactivate' }).catch(() => {})));
}

function reconcileFromPermissions() {
  return serialized(registrationQueue, async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = [...new Set(origins.flatMap(pattern => {
      if (pattern === U.BUILTIN_PATTERN) return [];
      if (pattern === '<all_urls>') return ['http://*/*', 'https://*/*'];
      return /^(https?|\*):\/\//.test(pattern) ? [pattern] : [];
    }))].sort();
    const [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (!matches.length) {
      if (current) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } else {
      const registration = {
        id: SCRIPT_ID, matches, excludeMatches: [U.BUILTIN_PATTERN],
        js: ['shared.js', 'content.js'], css: ['styles.css'], runAt: 'document_idle',
      };
      if (current) await chrome.scripting.updateContentScripts([registration]);
      else await chrome.scripting.registerContentScripts([registration]);
    }
    await revokeRunningScripts(origins);
    return { ok: true };
  }, next => { registrationQueue = next; });
}

function validPage(value) {
  try {
    return !!value && typeof value.url === 'string' && value.url.length <= 16384
      && ['http:', 'https:'].includes(new URL(value.url).protocol) && typeof value.title === 'string';
  } catch (_) { return false; }
}

function updateData(operation) {
  return serialized(dataQueue, operation, next => { dataQueue = next; });
}

function trackRecentView(view, sender) {
  if (!sender.tab || sender.frameId !== 0 || !validPage(view)
      || new URL(view.url).origin !== new URL(sender.url).origin) throw new Error('Invalid recent view');
  return updateData(async () => {
    const { recentViews = [] } = await chrome.storage.local.get('recentViews');
    const identity = U.recordIdentity(view.url);
    const next = [{ title: view.title.slice(0, 512), url: view.url, timestamp: Date.now() },
      ...(Array.isArray(recentViews) ? recentViews : []).filter(item => validPage(item) && U.recordIdentity(item.url) !== identity)].slice(0, 50);
    await chrome.storage.local.set({ recentViews: next });
    return { ok: true };
  });
}

function updatePins(message) {
  return updateData(async () => {
    const stored = await chrome.storage.local.get('pinnedPages');
    let pins = (Array.isArray(stored.pinnedPages) ? stored.pinnedPages : []).filter(validPage);
    if (message.operation === 'add') {
      if (!validPage(message.page)) throw new Error('Only HTTP(S) pages can be pinned');
      if (!pins.some(pin => pin.url === message.page.url)) {
        pins.push({ url: message.page.url, title: message.page.title.slice(0, 512), appName: String(message.page.appName || 'App').slice(0, 80) });
      }
    } else if (message.operation === 'remove') {
      pins = pins.filter(pin => pin.url !== message.url);
    } else if (message.operation === 'reorder' && Array.isArray(message.urls)) {
      const order = new Map(message.urls.map((url, index) => [url, index]));
      pins.sort((a, b) => (order.get(a.url) ?? Infinity) - (order.get(b.url) ?? Infinity));
    } else throw new Error('Invalid pin operation');
    await chrome.storage.local.set({ pinnedPages: pins });
    return { ok: true };
  });
}

// Read only the public bootstrap values emitted by web.layout in Odoo 17–19.
// Target the sending document, never a newer page that reused the same tab.
async function getOdooContext(sender) {
  if (!sender.tab || sender.frameId !== 0) throw new Error('A top-level page is required');
  const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
    : { tabId: sender.tab.id, frameIds: [0] };
  const [result] = await chrome.scripting.executeScript({
    target, world: 'MAIN', func: () => {
      const odoo = globalThis.odoo;
      return { href: location.href, isOdoo: !!odoo && typeof odoo.debug === 'string',
        debug: typeof odoo?.debug === 'string' ? odoo.debug : null,
        version: odoo?.__session_info__?.server_version_info?.[0] ?? null };
    },
  });
  return { ok: true, context: result?.result ?? null };
}

function authorizeDebugReload(message, sender) {
  if (!sender.tab || sender.frameId !== 0 || typeof message.mode !== 'string') throw new Error('Invalid debug request');
  const mode = U.normalizeDebug(message.mode) || '0';
  return serialized(debugQueue, async () => {
    const key = `debugGuard:${sender.tab.id}:${new URL(sender.url).origin}`;
    const stored = await chrome.storage.session.get(key);
    const guard = message.explicit ? null : stored[key];
    if (guard?.blocked || (guard?.mode === mode && Date.now() - guard.at < 15000)) {
      await chrome.storage.session.set({ [key]: { blocked: true, mode } });
      return { ok: true, allowed: false };
    }
    await chrome.storage.session.set({ [key]: { mode, at: Date.now() } });
    return { ok: true, allowed: true };
  }, next => { debugQueue = next; });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  let operation;
  try {
    switch (message?.action) {
      case 'getOdooContext': operation = getOdooContext(sender); break;
      case 'authorizeDebugReload': operation = authorizeDebugReload(message, sender); break;
      case 'trackRecentView': operation = trackRecentView(message.view, sender); break;
      case 'updatePins': operation = updatePins(message); break;
      case 'syncPermissions': operation = reconcileFromPermissions(); break;
      default: return;
    }
  } catch (error) { respond({ ok: false, error: error.message }); return; }
  Promise.resolve(operation).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-chatter') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { action: 'toggleChatter' }).catch(() => {});
  } catch (error) { console.warn('[Chatter Utilities] Shortcut:', error.message); }
});

async function showUpdateChangelog() {
  const version = chrome.runtime.getManifest().version;
  const { lastUpdateNotifyVersion } = await chrome.storage.local.get('lastUpdateNotifyVersion');
  if (lastUpdateNotifyVersion === version) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });
  await chrome.storage.local.set({ lastUpdateNotifyVersion: version });
}
const report = error => console.error('[Chatter Utilities]', error);
chrome.runtime.onStartup.addListener(() => { reconcileFromPermissions().catch(report); });
chrome.runtime.onInstalled.addListener(details => {
  reconcileFromPermissions().catch(report);
  if (details.reason === 'update') showUpdateChangelog().catch(report);
});
chrome.permissions.onAdded.addListener(() => { reconcileFromPermissions().catch(report); });
chrome.permissions.onRemoved.addListener(() => { reconcileFromPermissions().catch(report); });
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.get(null).then(values => chrome.storage.session.remove(
    Object.keys(values).filter(key => key.startsWith(`debugGuard:${tabId}:`)))).catch(report);
});
