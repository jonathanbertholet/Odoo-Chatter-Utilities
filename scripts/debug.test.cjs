const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, createWorker, source } = require('./harness.cjs');

for (const debug of ['1', 'assets', 'assets,tests']) test(`explicit debug off clears the server session (${debug}) even when the URL has no debug parameter`, async () => {
  const f = await fixture({ runtimeDebug: debug, settings: { debugMode: true } });
  try {
    assert.equal(f.reloads, 0);
    f.w.history.replaceState({ nextState: { action: 'sales', resId: 1 } }, '', '/odoo/sales/1');
    await f.setting({ debugMode: false });
    assert.equal(f.reloads, 1); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '0');
    assert.equal(f.w.history.state.nextState.resId, 1);
  } finally { f.close(); }
});

test('URL debug is not mistaken for an active Odoo runtime mode', async () => {
  const f = await fixture({ url: 'https://tenant.odoo.com/odoo/sales/1?debug=assets', runtimeDebug: '', settings: { debugMode: true } });
  try { assert.equal(f.reloads, 1); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '1'); }
  finally { f.close(); }
});

for (const pathname of ['/help', '/fr_BE/help/ticket', '/my/databases/7', '/slides/course', '/odoo/website', '/odoo/knowledge/1']) {
  test(`excluded page disables an inherited debug session: ${pathname}`, async () => {
    const f = await fixture({ url: 'https://www.odoo.com' + pathname, settings: { debugMode: true }, runtimeDebug: 'assets' });
    try { assert.equal(f.reloads, 1); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '0'); }
    finally { f.close(); }
  });
}

for (const [url, isOdoo] of [['https://www.odoo.com/pricing', true], ['https://erp.example.com/odoo', false], ['https://tenant.odoo.com/web/login', true]]) {
  test(`automatic debug only activates in a recognized Odoo backend: ${url}`, async () => {
    const f = await fixture({ url, isOdoo, settings: { debugMode: true } });
    try { assert.equal(f.reloads, 0); assert.equal(new URL(f.w.location.href).searchParams.has('debug'), false); }
    finally { f.close(); }
  });
}

test('a delayed context response cannot reload a newer SPA route or override an explicit off preference', async () => {
  const worker = createWorker({ sync: { debugMode: true } }); let release; let started;
  const waiting = new Promise(resolve => { started = resolve; });
  worker.executeHook = async () => { started(); await new Promise(resolve => { release = resolve; }); };
  const f = await fixture({ worker, runtimeDebug: '' });
  try {
    await waiting; assert.equal(f.reloads, 0);
    f.w.history.pushState({}, '', '/odoo/purchase/2'); await f.setting({ debugMode: false });
    worker.executeHook = null; release(); await f.advance();
    assert.equal(f.reloads, 0); assert.equal(f.w.location.pathname, '/odoo/purchase/2');
    assert.equal(new URL(f.w.location.href).searchParams.has('debug'), false);
  } finally { worker.executeHook = null; release?.(); f.close(); }
});

test('an explicit off request survives another navigation before its debounce expires', async () => {
  const f = await fixture({ runtimeDebug: 'assets', settings: { debugMode: true } });
  try {
    await f.entry.chrome.storage.sync.set({ debugMode: false });
    f.w.history.pushState({}, '', '/odoo/sales/2'); f.w.dispatchEvent(new f.w.PopStateEvent('popstate'));
    await f.advance(); assert.equal(f.reloads, 1); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '0');
  } finally { f.close(); }
});

test('MAIN-world context reads target the sending document and expose only bootstrap scalars', async () => {
  const f = await fixture({ runtimeDebug: 'assets', beforeLoad(w) { w.odoo.csrf_token = 'do-not-expose'; } });
  try {
    const response = await f.entry.chrome.runtime.sendMessage({ action: 'getOdooContext' });
    assert.deepEqual(Object.keys(response.context).sort(), ['debug', 'href', 'isOdoo', 'version']);
    assert.equal(response.context.debug, 'assets');
    const call = f.worker.scriptCalls.at(-1); assert.equal(call.world, 'MAIN');
    assert.deepEqual(Array.from(call.target.documentIds), [f.entry.documentId]);
    assert.equal(JSON.stringify(response).includes('do-not-expose'), false);
    // Old documents must not inspect a newer page that reused their tab ID.
    const documentId = f.entry.documentId; f.entry.documentId = 'new-document';
    const failed = await f.worker.from({ action: 'getOdooContext' }, { frameId: 0, tab: { id: f.id }, documentId, url: f.w.location.href });
    assert.equal(failed.ok, false); assert.match(failed.error, /Document was replaced/);
  } finally { f.close(); }
});

test('worker debug guards persist across content reinjection and are cleared when the tab closes', async () => {
  const f = await fixture({ settings: { debugMode: true } });
  try {
    assert.equal(f.reloads, 1); f.w.__chatterUtilities.destroy();
    f.w.eval(source('content.js').replaceAll('window.location.reload()', 'window.__reload()')); await f.advance();
    assert.equal(f.reloads, 1); assert.equal(f.state.session[`debugGuard:${f.id}:https://tenant.odoo.com`].blocked, true);
    await f.worker.onTabRemoved.emit(f.id); await f.worker.flush(); assert.equal(Object.keys(f.state.session).length, 0);
  } finally { f.close(); }
});

test('blocked guards survive a worker restart and allow an explicit setting change', async () => {
  const key = 'debugGuard:1:https://tenant.odoo.com';
  const worker = createWorker({ sync: { debugMode: true }, session: { [key]: { blocked: true, mode: '1' } } });
  const f = await fixture({ worker });
  try {
    assert.equal(f.reloads, 0); await f.setting({ debugMode: false }); await f.setting({ debugMode: true });
    assert.equal(f.reloads, 1);
  } finally { f.close(); }
});

test('debug normalization and identities follow the Odoo 17–19 URL contracts', async () => {
  const f = await fixture();
  try {
    const u = f.w.ChatterUtils;
    for (const value of [null, '', '0', 'false', 'off', 'no', 'n', 'f']) assert.equal(u.normalizeDebug(value), '');
    assert.equal(u.normalizeDebug('assets,tests,assets'), 'assets,tests'); assert.equal(u.normalizeDebug('yes'), '1');
    assert.equal(u.recordIdentity('https://db.odoo.com/web?debug=assets#id=9&model=sale.order&view_type=form'), u.recordIdentity('https://db.odoo.com/web#model=sale.order&id=9&cids=2'));
    assert.notEqual(u.recordIdentity('https://db.odoo.com/web#id=9&model=sale.order'), u.recordIdentity('https://db.odoo.com/web#id=9&model=purchase.order'));
    assert.equal(u.recordIdentity('https://db.odoo.com/odoo/sales/9?debug=1#hi'), u.recordIdentity('https://db.odoo.com/odoo/sales/9?cids=3'));
    assert.notEqual(u.recordIdentity('https://db.odoo.com/scoped_app/sales/9'), u.recordIdentity('https://db.odoo.com/scoped_app/sales/10'));
    assert.equal(u.isRecordSave('https://db.odoo.com/odoo/sales/new', 'https://db.odoo.com/odoo/purchase/9'), false);
    assert.equal(u.isRecordSave('https://db.odoo.com/odoo/sales/new', 'https://other.odoo.com/odoo/sales/9'), false);
    assert.equal(u.isRecordSave('https://db.odoo.com/web#model=sale.order', 'https://db.odoo.com/web#model=purchase.order&id=9'), false);
  } finally { f.close(); }
});
