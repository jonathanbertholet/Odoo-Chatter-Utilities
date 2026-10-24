// Executes the shipped scripts with asynchronous Chrome APIs and source-backed DOM fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, popupFixture, backgroundFixture, form, chatter, topbar } = require('./harness.cjs');

function panel(f) { return f.w.document.querySelector('.o-mail-ChatterContainer'); }
function toggle(f) { return f.w.document.querySelector('.chatter-toggle'); }
function folded(f) { return panel(f).classList.contains('chatter-ext-hidden'); }

// #7 and #9: Odoo closes analytic distribution on window resize.
test('ordinary chatter updates leave an open analytic dropdown alone and settle', async () => {
  const f = await fixture();
  try {
    let open = true;
    f.w.addEventListener('resize', () => { open = false; });
    const initialWidth = panel(f).style.getPropertyValue('--chatter-panel-width');
    const child = f.w.document.createElement('div');
    child.className = 'o-mail-Chatter-topbar';
    panel(f).append(child);
    await f.advance(4000);
    assert.equal(open, true);
    assert.equal(f.resizes, 0);
    assert.equal(panel(f).style.getPropertyValue('--chatter-panel-width'), initialWidth);
    assert.equal(f.w.document.querySelectorAll('.chatter-collapsed-rail').length, 1);
  } finally { f.close(); }
});

test('hide-by-default follows SPA record changes and preserves manual same-record changes', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    assert.equal(folded(f), true);
    toggle(f).click();
    await f.advance();
    assert.equal(folded(f), false);
    panel(f).classList.add('odoo-patched');
    await f.advance();
    assert.equal(folded(f), false);
    f.w.history.pushState({}, '', '/odoo/sales/2');
    await f.advance();
    assert.equal(folded(f), true);
  } finally { f.close(); }
});

test('same-record chatter replacement keeps the selected fold state', async () => {
  const f = await fixture();
  try {
    toggle(f).click();
    assert.equal(folded(f), true);
    panel(f).outerHTML = chatter();
    await f.advance();
    assert.equal(folded(f), true);
    assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
  } finally { f.close(); }
});

test('hash-routed record navigation reapplies hide-by-default', async () => {
  const f = await fixture({ url: 'https://tenant.odoo.com/web#id=1&model=sale.order', settings: { hideChatter: true } });
  try {
    toggle(f).click();
    await f.advance();
    assert.equal(folded(f), false);
    f.w.history.pushState({}, '', '/web#id=2&model=sale.order');
    await f.advance();
    assert.equal(folded(f), true);
  } finally { f.close(); }
});

test('delayed topbar mounts exactly one working toggle', async () => {
  const f = await fixture({ markup: form(chatter('')) });
  try {
    assert.equal(f.w.document.querySelector('.o-mail-Chatter-topbar .chatter-toggle'), null);
    panel(f).querySelector('.o-mail-Chatter').innerHTML = topbar;
    await f.advance();
    assert.ok(f.w.document.querySelector('.o-mail-Chatter-topbar .chatter-toggle'));
    assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
    toggle(f).click();
    assert.equal(folded(f), true);
  } finally { f.close(); }
});

test('Studio entry removes controls and restores extension layout changes', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    f.w.history.pushState({}, '', '/odoo/sales/1/studio?mode=editor');
    await f.advance();
    assert.equal(toggle(f), null);
    assert.equal(folded(f), false);
    assert.equal(f.w.document.querySelector('.chatter-form-managed'), null);
    f.w.history.pushState({}, '', '/odoo/sales/1');
    await f.advance();
    assert.ok(toggle(f));
  } finally { f.close(); }
});

test('native PDF/below layouts keep their width and native hidden state', async () => {
  const f = await fixture({ markup: form(chatter(topbar, 'o-isInFormSheetBg hidden')), settings: { stretchFormWhenFolded: true } });
  try {
    assert.equal(panel(f).classList.contains('chatter-width-managed'), false);
    assert.equal(panel(f).classList.contains('hidden'), true);
    assert.equal(f.w.document.querySelector('.chatter-resize-handle'), null);
    assert.equal(f.w.document.querySelector('.stretch-form'), null);
    assert.equal(f.w.getComputedStyle(f.w.document.querySelector('.o_content')).overflowY, 'visible');
  } finally { f.close(); }
});

test('Audit/Documents controls anchor to the parent and preserve native panel width', async () => {
  const f = await fixture({ markup: chatter() });
  try {
    const rail = f.w.document.querySelector('.chatter-collapsed-rail');
    assert.equal(rail.parentElement, panel(f).parentElement);
    assert.equal(panel(f).classList.contains('chatter-width-managed'), false);
    assert.equal(f.w.document.querySelector('.chatter-resize-handle'), null);
    await f.advance(4000);
    assert.equal(f.resizes, 0);
  } finally { f.close(); }
});

test('a rail first mounted below gets working interactions when switched to the side', async () => {
  const f = await fixture({ settings: { displayBelow: true } });
  try {
    await f.setting({ displayBelow: false });
    toggle(f).click();
    assert.equal(folded(f), true);
  } finally { f.close(); }
});

for (const pathname of ['/my/databases', '/my/databases/123', '/en_US/my/databases', '/help', '/fr/help/ticket']) {
  test(`debug is excluded on public Odoo ${pathname}`, async () => {
    const f = await fixture({ url: `https://www.odoo.com${pathname}`, settings: { debugMode: true } });
    try { assert.equal(f.reloads, 0); assert.equal(new URL(f.w.location.href).searchParams.has('debug'), false); }
    finally { f.close(); }
  });
}

test('debug=0 triggers a guarded enable and keeps the record hash', async () => {
  const f = await fixture({ url: 'https://tenant.odoo.com/web?debug=0#id=7&model=sale.order', settings: { debugMode: true } });
  try { assert.equal(f.reloads, 1); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '1'); assert.equal(f.w.location.hash, '#id=7&model=sale.order'); }
  finally { f.close(); }
});

test('off/default preference leaves manually enabled debug intact', async () => {
  const f = await fixture({ url: 'https://tenant.odoo.com/odoo/sales/1?debug=1' });
  try { assert.equal(f.reloads, 0); assert.equal(new URL(f.w.location.href).searchParams.get('debug'), '1'); }
  finally { f.close(); }
});

test('SPA navigation restores assets debug without a reload or loss of router state', async () => {
  const f = await fixture({ url: 'https://tenant.odoo.com/odoo/sales/1?debug=assets', settings: { debugMode: true } });
  try {
    f.w.history.pushState({ routerToken: 42 }, '', '/odoo/sales/2');
    await f.advance();
    assert.equal(f.reloads, 0);
    assert.equal(new URL(f.w.location.href).searchParams.get('debug'), 'assets');
    assert.equal(f.w.history.state.routerToken, 42);
  } finally { f.close(); }
});

test('conflicting debug reloads pause until an explicit preference change', async () => {
  const f = await fixture({ settings: { debugMode: true }, guard: { at: 99999 } });
  try {
    assert.equal(f.reloads, 0);
    assert.equal(f.worker.values.session[`debugGuard:${f.id}:https://tenant.odoo.com`].blocked, true);
    f.w.history.pushState({}, '', '/odoo/sales/2');
    await f.advance(30000);
    assert.equal(f.reloads, 0);
    await f.setting({ debugMode: false });
    await f.setting({ debugMode: true });
    assert.equal(f.reloads, 1);
  } finally { f.close(); }
});

test('custom wildcard registrations reconcile additions, revocations and stale startup state', async () => {
  const { state, events } = backgroundFixture(['*://*.odoo.com/*', '*://erp.example.com/*']);
  await events.startup();
  assert.deepEqual(Array.from(state.current.matches), ['*://erp.example.com/*']);
  assert.deepEqual(Array.from(state.current.excludeMatches), ['*://*.odoo.com/*']);
  state.origins.push('https://other.example.com/*');
  await Promise.all([events.added(), events.added()]);
  assert.equal(state.current.matches.length, 2);
  state.origins = ['*://*.odoo.com/*'];
  await events.removed();
  assert.equal(state.current, null);
  state.current = { id: 'dynamic-chatter-content', matches: ['https://stale.example.com/*'] };
  await events.startup();
  assert.equal(state.current, null);
});

test('previous all-sites grants register HTTP(S) while excluding duplicate Odoo injection', async () => {
  const { state, events } = backgroundFixture(['*://*.odoo.com/*', '<all_urls>']);
  await events.startup();
  assert.deepEqual(Array.from(state.current.matches), ['http://*/*', 'https://*/*']);
  assert.deepEqual(Array.from(state.current.excludeMatches), ['*://*.odoo.com/*']);
});

test('dragging folded chatter open preserves the live width through observer updates', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    const handle = f.w.document.querySelector('.chatter-resize-handle');
    handle.dispatchEvent(new f.w.MouseEvent('pointerdown', { bubbles: true, clientX: 1390 }));
    f.w.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 900 }));
    assert.equal(folded(f), false);
    f.w.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 800 }));
    panel(f).classList.add('odoo-drag-render');
    await f.advance();
    assert.equal(panel(f).style.getPropertyValue('--chatter-panel-width'), '600px');
    f.w.dispatchEvent(new f.w.MouseEvent('pointerup'));
    await f.advance();
    assert.equal(folded(f), false);
    assert.equal(f.state.sync.chatterWidth, 600);
  } finally { f.close(); }
});

test('theme synchronization settles after writing extension CSS tokens', async () => {
  const f = await fixture();
  try {
    f.w.document.documentElement.style.setProperty('--body-bg', '#ffffff');
    await f.advance(4000);
    assert.equal(f.w.document.documentElement.style.getPropertyValue('--chatter-ext-surface-solid'), '#ffffff');
  } finally { f.close(); }
});

test('popup lists wildcard custom domains and disables removal under an all-sites grant', async () => {
  const f = await popupFixture(['*://*.odoo.com/*', '*://erp.example.com/*', '<all_urls>']);
  try {
    assert.equal(f.w.document.querySelector('.whitelist-domain').textContent, '*://erp.example.com');
    assert.equal(f.w.document.querySelector('.remove-domain').disabled, true);
  } finally { f.close(); }
});

test('popup rejects non-HTTP pages before requesting a host permission', async () => {
  const f = await popupFixture(['*://*.odoo.com/*'], 'chrome://extensions/');
  try {
    f.w.document.querySelector('#addCurrentDomain').click();
    await new Promise(setImmediate);
    assert.equal(f.requests.length, 0);
    assert.match(f.w.document.querySelector('#popupStatus').textContent, /HTTP or HTTPS/);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
