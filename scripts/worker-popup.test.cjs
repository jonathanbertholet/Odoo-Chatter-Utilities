const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, popupFixture, createWorker, source } = require('./harness.cjs');

test('concurrent recent-view writes from multiple tabs lose no records and deduplicate record identities', async () => {
  const worker = createWorker(); const first = await fixture({ worker }); const second = await fixture({ worker, url: 'https://other.odoo.com/odoo/purchase/2' });
  try {
    const jobs = [];
    for (let index = 1; index <= 20; index++) {
      jobs.push(first.entry.chrome.runtime.sendMessage({ action: 'trackRecentView', view: { url: `https://tenant.odoo.com/odoo/sales/${index}`, title: `Sale ${index}` } }));
      jobs.push(second.entry.chrome.runtime.sendMessage({ action: 'trackRecentView', view: { url: `https://other.odoo.com/odoo/purchase/${index}`, title: `Purchase ${index}` } }));
    }
    const results = await Promise.all(jobs); assert.equal(results.every(result => result.ok), true);
    assert.equal(worker.values.local.recentViews.length, 40);
    await first.entry.chrome.runtime.sendMessage({ action: 'trackRecentView', view: { url: 'https://tenant.odoo.com/odoo/sales/1?debug=assets#section', title: 'Sale 1 updated' } });
    assert.equal(worker.values.local.recentViews.length, 40); assert.equal(worker.values.local.recentViews[0].title, 'Sale 1 updated');
  } finally { first.close(); second.close(); }
});

test('recents cap at 50, discard corrupt entries and reject cross-origin and subframe messages', async () => {
  const worker = createWorker({ local: { recentViews: [null, {}, { url: 'javascript:alert(1)', title: 'Bad' }] } });
  const f = await fixture({ worker });
  try {
    const jobs = Array.from({ length: 65 }, (_, index) => f.entry.chrome.runtime.sendMessage({ action: 'trackRecentView', view: { url: `https://tenant.odoo.com/odoo/sales/${index}`, title: 'Sale' } }));
    await Promise.all(jobs); assert.equal(worker.values.local.recentViews.length, 50);
    assert.equal(worker.values.local.recentViews[0].url, 'https://tenant.odoo.com/odoo/sales/64');
    const other = await f.entry.chrome.runtime.sendMessage({ action: 'trackRecentView', view: { url: 'https://bad.example/odoo/1', title: 'Bad' } }); assert.equal(other.ok, false);
    const frame = await worker.from({ action: 'trackRecentView', view: { url: f.w.location.href, title: 'Frame' } }, { frameId: 1, tab: { id: f.id }, url: f.w.location.href }); assert.equal(frame.ok, false);
    assert.equal(worker.values.local.recentViews.length, 50);
  } finally { f.close(); }
});

test('pins add/remove/reorder serialize with other popups and preserve concurrently added pins', async () => {
  const worker = createWorker({ local: { pinnedPages: { corrupt: true } } });
  const page = name => ({ url: `https://${name}.odoo.com/odoo`, title: name });
  const send = message => worker.message({ action: 'updatePins', ...message });
  await Promise.all(['a', 'b', 'c'].map(name => send({ operation: 'add', page: page(name) })));
  await Promise.all([send({ operation: 'add', page: page('d') }), send({ operation: 'reorder', urls: [page('c').url, page('a').url, page('b').url] })]);
  assert.deepEqual(worker.values.local.pinnedPages.map(pin => pin.title), ['c', 'a', 'b', 'd']);
  await Promise.all([send({ operation: 'remove', url: page('a').url }), send({ operation: 'add', page: page('c') })]);
  assert.deepEqual(worker.values.local.pinnedPages.map(pin => pin.title), ['c', 'b', 'd']);
  assert.equal((await send({ operation: 'add', page: { url: 'file:///private/test', title: 'Bad' } })).ok, false);
});

test('data queues recover after storage failures and report the failure to the caller', async () => {
  const worker = createWorker(); worker.failNextSet = 'local';
  const first = await worker.message({ action: 'updatePins', operation: 'add', page: { url: 'https://a.odoo.com/', title: 'a' } });
  assert.equal(first.ok, false); assert.match(first.error, /quota/);
  const next = await worker.message({ action: 'updatePins', operation: 'add', page: { url: 'https://b.odoo.com/', title: 'b' } });
  assert.equal(next.ok, true); assert.equal(worker.values.local.pinnedPages[0].title, 'b');
});

test('custom site revocation tears down already running controllers, drags, timers and listeners', async () => {
  const worker = createWorker({ origins: ['*://*.odoo.com/*', 'https://erp.example.com/*'] });
  const f = await fixture({ worker, url: 'https://erp.example.com/odoo/sales/1' });
  try {
    const original = f.w.document.querySelector('.o-mail-Form-chatter'); assert.ok(f.w.document.querySelector('.chatter-toggle'));
    const storageListeners = worker.onChanged.listeners.size;
    f.w.document.querySelector('.chatter-toggle').click();
    f.w.document.querySelector('.chatter-resize-handle').dispatchEvent(new f.w.MouseEvent('pointerdown', { bubbles: true, clientX: 1390 }));
    f.w.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 900 }));
    assert.equal(f.w.document.body.classList.contains('chatter-resize-active'), true);
    await worker.removeOrigins(['https://erp.example.com/*']);
    assert.equal(f.w.__chatterUtilities, undefined); assert.equal(f.w.document.querySelector('.chatter-toggle'), null);
    assert.equal(original.classList.contains('chatter-ext-hidden'), false);
    assert.equal(original.classList.contains('chatter-width-managed'), false);
    assert.equal(f.w.document.body.classList.contains('chatter-resize-active'), false);
    assert.equal(worker.values.sync.chatterWidth, undefined);
    assert.equal(worker.onChanged.listeners.size, storageListeners - 1); assert.equal(f.entry.chrome.runtime.onMessage.listeners.size, 0);
    original.classList.add('odoo-updated'); await f.advance(10000); assert.equal(f.w.document.querySelector('.chatter-toggle'), null);
    worker.origins.push('https://erp.example.com/*'); await worker.onAdded.emit(); await worker.flush();
    f.w.eval(source('content.js')); await f.advance(); assert.ok(f.w.document.querySelector('.chatter-toggle'));
    assert.equal(worker.registrations.get('dynamic-chatter-content').js.join(','), 'shared.js,content.js');
  } finally { f.close(); }
});

test('revocation respects overlapping wildcard grants and builtin Odoo access', async () => {
  const worker = createWorker({ origins: ['*://*.odoo.com/*', 'https://erp.example.com/*', '*://*.example.com/*'] });
  const custom = await fixture({ worker, url: 'https://erp.example.com/odoo' }); const native = await fixture({ worker });
  try {
    await worker.removeOrigins(['https://erp.example.com/*']); assert.ok(custom.w.__chatterUtilities); assert.ok(native.w.__chatterUtilities);
    await worker.removeOrigins(['*://*.example.com/*']); assert.equal(custom.w.__chatterUtilities, undefined); assert.ok(native.w.__chatterUtilities);
  } finally { custom.close(); native.close(); }
});

test('host grants handle base domains, wildcard subdomains, ports and localhost correctly', async () => {
  const f = await fixture();
  try {
    const match = f.w.ChatterUtils.matchesPattern;
    for (const url of ['https://odoo.com/', 'http://a.odoo.com/web', 'https://a.b.odoo.com/odoo']) assert.equal(match(url, '*://*.odoo.com/*'), true);
    assert.equal(match('https://odoo.com.evil.example/', '*://*.odoo.com/*'), false);
    assert.equal(match('https://evilodoo.com/', '*://*.odoo.com/*'), false);
    assert.equal(match('https://erp.example.com:443/odoo', 'https://erp.example.com:443/*'), true);
    assert.equal(match('http://localhost:8069/odoo', 'http://localhost/*'), true);
    assert.equal(match('http://localhost:8069/odoo', 'http://localhost:*/*'), true);
    assert.equal(match('http://localhost:8070/odoo', 'http://localhost:8069/*'), false);
    assert.equal(match('http://[::1]:8069/odoo', 'http://[::1]:8069/*'), true);
    assert.equal(match('chrome://extensions/', '<all_urls>'), false);
  } finally { f.close(); }
});

test('an initial settings read cannot overwrite newer changes or create a partially configured panel', async () => {
  const worker = createWorker({ sync: { hideChatter: true, chatterWidth: 900 } }); let release;
  worker.getHook = (area, keys, snapshot) => area === 'sync' ? new Promise(resolve => { release = () => resolve(snapshot); }) : snapshot;
  const f = await fixture({ worker });
  try {
    assert.equal(f.w.document.querySelector('.chatter-toggle'), null);
    await f.entry.chrome.storage.sync.set({ chatterWidth: 600 }); await f.advance();
    assert.equal(f.w.document.querySelector('.chatter-toggle'), null);
    worker.getHook = null; release(); await f.advance();
    assert.equal(f.w.document.querySelector('.o-mail-Form-chatter').classList.contains('chatter-ext-hidden'), true);
    f.w.document.querySelector('.chatter-toggle').click();
    assert.equal(f.w.document.querySelector('.o-mail-Form-chatter').style.getPropertyValue('--chatter-panel-width'), '600px');
  } finally { release?.(); f.close(); }
});

test('popup preserves recent search while storage updates and safely displays untrusted/corrupt entries', async () => {
  const f = await popupFixture(undefined, undefined, { local: { recentViews: [null, { title: '<img src=x onerror=alert(1)>', url: 'https://tenant.odoo.com/odoo/sales/1' }], pinnedPages: [null, { title: '<b>Pin</b>', url: 'https://www.odoo.com/help' }] } });
  try {
    const search = f.w.document.querySelector('#recentViewsSearch'); search.value = 'needle'; search.dispatchEvent(new f.w.Event('input')); await f.worker.flush();
    assert.equal(f.w.document.querySelector('.recent-view-empty').textContent, 'No matching records');
    await f.worker.chrome.storage.local.set({ recentViews: [{ title: 'Needle order', url: 'https://tenant.odoo.com/odoo/sales/2' }] }); await f.worker.flush();
    assert.equal(search.value, 'needle'); assert.equal(f.w.document.querySelector('.recent-view-title').textContent, 'Needle order');
    assert.equal(f.w.document.querySelector('.pinned-page-name').textContent, '<b>Pin</b>'); assert.equal(f.w.document.querySelector('.pinned-page-name b'), null);
    assert.equal(f.w.document.querySelector('.pinned-domain').textContent, 'odoo.com'); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('popup setting failures restore the checkbox and surface the error', async () => {
  const f = await popupFixture();
  try {
    f.worker.failNextSet = 'sync'; const checkbox = f.w.document.querySelector('#debugMode'); checkbox.checked = true;
    checkbox.dispatchEvent(new f.w.Event('change')); await f.worker.flush();
    assert.equal(checkbox.checked, false); assert.equal(checkbox.disabled, false);
    assert.match(f.w.document.querySelector('#popupStatus').textContent, /quota/); assert.equal(f.worker.values.sync.debugMode, undefined);
  } finally { f.close(); }
});

test('popup toggling below retains the saved side hide setting', async () => {
  const worker = createWorker({ sync: { hideChatter: true } }); const f = await popupFixture(undefined, undefined, { worker });
  try {
    const below = f.w.document.querySelector('#displayBelow'); below.checked = true; below.dispatchEvent(new f.w.Event('change')); await worker.flush();
    assert.equal(worker.values.sync.hideChatter, true); assert.equal(f.w.document.querySelector('#hideChatter').disabled, true);
    below.checked = false; below.dispatchEvent(new f.w.Event('change')); await worker.flush();
    assert.equal(f.w.document.querySelector('#hideChatter').checked, true); assert.equal(f.w.document.querySelector('#hideChatter').disabled, false);
  } finally { f.close(); }
});

test('popup requests site access during the click gesture and removes access from the current document', async () => {
  const f = await popupFixture();
  try {
    let gesture = false; let withinGesture = false;
    const request = f.w.chrome.permissions.request;
    f.w.chrome.permissions.request = value => { withinGesture = gesture; return request(value); };
    gesture = true; f.w.document.querySelector('#addCurrentDomain').click(); gesture = false; await f.worker.flush();
    assert.equal(withinGesture, true); assert.ok(f.worker.origins.includes('https://erp.example.com/*'));
    assert.match(f.w.document.querySelector('#popupStatus').textContent, /Refresh/);
    f.w.document.querySelector('.remove-domain').click(); await f.worker.flush();
    assert.equal(f.tab.w.__chatterUtilities, undefined); assert.match(f.w.document.querySelector('#popupStatus').textContent, /removed/);
  } finally { f.close(); }
});

test('popup pin drag can move the first item after the last item', async () => {
  const pages = ['a', 'b', 'c'].map(name => ({ title: name, url: `https://${name}.odoo.com/odoo` }));
  const f = await popupFixture(undefined, undefined, { local: { pinnedPages: pages } });
  try {
    const items = f.w.document.querySelectorAll('.pinned-button');
    const drag = new f.w.Event('dragstart'); Object.defineProperty(drag, 'dataTransfer', { value: { setData() {} } }); items[0].dispatchEvent(drag);
    items[2].dispatchEvent(new f.w.Event('drop', { cancelable: true })); await f.worker.flush();
    assert.deepEqual(f.worker.values.local.pinnedPages.map(pin => pin.title), ['b', 'c', 'a']);
  } finally { f.close(); }
});

test('Odoo settings links use the current backend router', async () => {
  for (const [url, target] of [['https://erp.example.com/web#id=1&model=sale.order', '/web?debug=1#action=base_setup.action_general_configuration'], ['https://erp.example.com/odoo/sales/1', '/odoo/settings?debug=1']]) {
    const f = await popupFixture(undefined, url);
    try { f.w.document.querySelector('#settingsLink').click(); await f.worker.flush(); assert.equal(f.requests.at(-1).url, 'https://erp.example.com' + target); }
    finally { f.close(); }
  }
});

test('update notice opens once per extension version and retries after an opening failure', async () => {
  const worker = createWorker(); let attempts = 0; const original = worker.chrome.tabs.create;
  worker.chrome.tabs.create = async value => { attempts++; if (attempts === 1) throw new Error('Tab creation failed'); return original(value); };
  await worker.onInstalled.emit({ reason: 'update' }); await worker.flush();
  assert.equal(worker.values.local.lastUpdateNotifyVersion, undefined);
  await worker.onInstalled.emit({ reason: 'update' }); await worker.flush(); assert.equal(worker.values.local.lastUpdateNotifyVersion, '2.1.0');
  await worker.onInstalled.emit({ reason: 'update' }); await worker.flush(); assert.equal(attempts, 2);
});
