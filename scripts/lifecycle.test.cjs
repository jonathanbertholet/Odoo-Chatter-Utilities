const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, form, chatter, topbar, source } = require('./harness.cjs');
const host = f => f.w.document.querySelector('.o-mail-Form-chatter');
const toggle = f => f.w.document.querySelector('.chatter-toggle');
const folded = node => node.classList.contains('chatter-ext-hidden');
const width = node => node.style.getPropertyValue('--chatter-panel-width');
const pointer = (f, node, type, clientX = 0, id = 1) => {
  const event = new f.w.MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: id }); node.dispatchEvent(event);
};
const dialog = body => `<div class="o_dialog"><div role="dialog" class="modal d-block"><div class="modal-dialog"><main class="modal-body">${body}</main></div></div></div>`;

for (const version of [17, 18, 19]) test(`Odoo ${version}: app close, list view and new form mount cleanly`, async () => {
  const legacy = version === 17;
  const f = await fixture({ version, url: `https://tenant.odoo.com/${legacy ? 'web#id=1&model=sale.order' : 'odoo/sales/1'}`,
    settings: { hideChatter: true, stretchFormWhenFolded: true } });
  try {
    const previous = host(f); const manager = f.w.document.querySelector('.o_action_manager');
    toggle(f).click(); assert.equal(folded(previous), false);
    manager.innerHTML = '<div class="o_list_view">List</div>';
    f.w.history.pushState({}, '', legacy ? '/web#action=purchase&view_type=list' : '/odoo/purchase'); await f.advance();
    assert.equal(f.w.__chatterUtilities.panels.size, 0);
    assert.equal(previous.querySelector('.chatter-toggle'), null);
    assert.equal(previous.classList.contains('chatter-width-managed'), false);
    assert.equal(previous.id, '');
    manager.innerHTML = `<div class="o_content">${form()}</div>`;
    f.w.history.pushState({}, '', legacy ? '/web#id=42&model=purchase.order' : '/odoo/purchase/42'); await f.advance();
    assert.equal(folded(host(f)), true);
    assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
    assert.equal(f.w.__chatterUtilities.panels.size, 1);
    await f.advance(20000); assert.equal(f.resizes, 0);
  } finally { f.close(); }
});

test('replacing the entire action container and body does not lose observation', async () => {
  const f = await fixture();
  try {
    f.w.document.querySelector('.o_action_manager').outerHTML = `<div class="o_action_manager">${form()}</div>`;
    await f.advance(); assert.ok(toggle(f)); assert.equal(f.w.__chatterUtilities.panels.size, 1);
    f.w.document.body.outerHTML = `<body class="o_web_client"><div class="o_action_manager">${form()}</div></body>`;
    await f.advance(); assert.ok(toggle(f)); assert.equal(f.w.__chatterUtilities.panels.size, 1);
    toggle(f).click(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('OWL may replace or remove the rail, topbar and handle independently', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    f.w.document.querySelector('.chatter-collapsed-rail').remove(); await f.advance();
    assert.equal(f.w.document.querySelectorAll('.chatter-collapsed-rail').length, 1);
    toggle(f).click();
    host(f).querySelector('.o-mail-Chatter-topbar').outerHTML = topbar; await f.advance();
    assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
    f.w.document.querySelector('.chatter-resize-handle').remove(); await f.advance();
    assert.equal(f.w.document.querySelectorAll('.chatter-resize-handle').length, 1);
    toggle(f).click(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('chatter can arrive much later than the form and lose/recover its topbar', async () => {
  const f = await fixture({ markup: form('') });
  try {
    await f.advance(30000); assert.equal(toggle(f), null);
    f.w.document.querySelector('.o_form_renderer').insertAdjacentHTML('beforeend', chatter(''));
    await f.advance(10000); assert.equal(toggle(f), null);
    host(f).querySelector('.o-mail-Chatter').innerHTML = topbar; await f.advance(); assert.ok(toggle(f));
    toggle(f).click(); host(f).querySelector('.o-mail-Chatter-topbar').remove(); await f.advance();
    assert.equal(toggle(f), null); assert.equal(folded(host(f)), false);
    host(f).querySelector('.o-mail-Chatter').innerHTML = topbar; await f.advance(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('same record keeps its state across highlights, anchors, company and debug changes', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    toggle(f).click();
    for (const suffix of ['?highlight_message_id=17', '?cids=2', '?debug=assets', '#section', '?view_type=form']) {
      f.w.history.pushState({}, '', '/odoo/sales/1' + suffix); await f.advance();
      assert.equal(folded(host(f)), false, suffix);
    }
    f.w.history.pushState({}, '', '/odoo/sales/2'); await f.advance(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

for (const legacy of [true, false]) test(`saving a draft retains the opened composer state in the ${legacy ? 'Odoo 17 hash' : 'Odoo 18/19 path'} router`, async () => {
  const initial = legacy ? '/web#action=123&model=sale.order&view_type=form' : '/odoo/sales/new';
  const saved = legacy ? '/web#action=123&model=sale.order&id=42&view_type=form' : '/odoo/sales/42';
  const other = legacy ? '/web#action=123&model=sale.order&id=43&view_type=form' : '/odoo/sales/43';
  const f = await fixture({ url: 'https://tenant.odoo.com' + initial, settings: { hideChatter: true } });
  try {
    host(f).querySelector('.o-mail-Chatter-sendMessage').addEventListener('click', () => {
      f.w.history.pushState({}, '', saved);
      host(f).querySelector('.o-mail-Chatter-topbar').insertAdjacentHTML('afterend', '<textarea class="native-composer"></textarea>');
    });
    f.w.document.querySelector('[data-chatter-action="message"]').click(); await f.advance();
    assert.equal(folded(host(f)), false); assert.ok(host(f).querySelector('.native-composer'));
    host(f).outerHTML = chatter(); await f.advance(); assert.equal(folded(host(f)), false);
    f.w.history.pushState({}, '', other); await f.advance(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('native side → bottom → side keeps the side state without hiding bottom chatter', async () => {
  const f = await fixture({ settings: { hideChatter: true, stretchFormWhenFolded: true } });
  try {
    host(f).classList.remove('o-aside'); await f.advance();
    assert.equal(folded(host(f)), false); assert.equal(toggle(f), null); assert.equal(width(host(f)), '');
    host(f).classList.add('native-rerender'); await f.advance(); assert.equal(folded(host(f)), false);
    host(f).classList.add('o-aside'); await f.advance(); assert.equal(folded(host(f)), true);
    assert.ok(toggle(f)); assert.equal(f.w.document.querySelectorAll('.chatter-collapsed-rail').length, 1);
  } finally { f.close(); }
});

test('Odoo COMBO invoice keeps the PDF and chatter inside sheet background at native sizes', async () => {
  const combo = `<div class="o_form_view o_xxl_form_view"><div class="o_form_renderer d-flex h-100"><div class="o_form_sheet_bg"><div class="o_form_sheet">Invoice</div>${chatter(topbar, 'o-isInFormSheetBg w-auto')}</div><div class="o_attachment_preview" style="width: 800px">PDF</div></div></div>`;
  const f = await fixture({ markup: combo, settings: { displayBelow: true, hideChatter: true, stretchFormWhenFolded: true } });
  try {
    assert.equal(toggle(f), null); assert.equal(folded(host(f)), false); assert.equal(width(host(f)), '');
    assert.equal(f.w.document.querySelector('.o_attachment_preview').style.width, '800px');
    assert.equal(f.w.document.querySelector('.chatter-ext-host'), null);
    assert.equal(f.w.getComputedStyle(f.w.document.querySelector('.o_content')).overflowY, 'visible');
    await f.advance(6000); assert.equal(f.resizes, 0);
  } finally { f.close(); }
});

test('forced below is reversible and preserves native classes and the side preference', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    await f.setting({ displayBelow: true, stretchFormWhenFolded: true });
    assert.equal(toggle(f), null); assert.equal(folded(host(f)), false);
    assert.equal(host(f).classList.contains('o-aside'), true);
    assert.equal(host(f).parentElement.classList.contains('chatter-ext-below'), true);
    assert.equal(f.state.sync.hideChatter, true);
    await f.setting({ displayBelow: false }); assert.equal(folded(host(f)), true);
    assert.equal(host(f).parentElement.classList.contains('chatter-ext-below'), false);
  } finally { f.close(); }
});

test('Documents mobile and custom embedded chatter remain native', async () => {
  for (const markup of [chatter(topbar, 'o_document_chatter_container mt-2'), form(chatter(topbar, ''))]) {
    const f = await fixture({ markup, settings: { hideChatter: true, displayBelow: true } });
    try { assert.equal(toggle(f), null); assert.equal(f.w.document.querySelector('.chatter-ext-hidden'), null); }
    finally { f.close(); }
  }
});

test('hidden Audit chatter restores its native state and can reopen reliably', async () => {
  const f = await fixture({ markup: chatter(topbar, 'o-aside o_account_report_chatter o_account_report_chatter_hidden') });
  try {
    const native = host(f); assert.equal(toggle(f), null);
    native.classList.remove('o_account_report_chatter_hidden'); await f.advance(); assert.ok(toggle(f));
    toggle(f).click(); native.classList.add('o_account_report_chatter_hidden'); await f.advance();
    assert.equal(folded(native), false); assert.equal(toggle(f), null);
    native.classList.remove('o_account_report_chatter_hidden'); await f.advance(); assert.equal(folded(native), true);
  } finally { f.close(); }
});

test('Odoo 17 modal chatter and nested dialogs own the shortcut independently', async () => {
  const f = await fixture({ version: 17 });
  try {
    const main = host(f); f.w.document.body.insertAdjacentHTML('beforeend', dialog(form())); await f.advance();
    const outer = f.w.document.querySelector('.o_dialog'); const modal = outer.querySelector('.o-mail-Form-chatter');
    await f.message({ action: 'toggleChatter' }); assert.equal(folded(modal), true); assert.equal(folded(main), false);
    f.w.document.body.insertAdjacentHTML('beforeend', dialog('<input id="wizard">')); outer.classList.add('o_inactive_modal');
    await f.advance(); await f.message({ action: 'toggleChatter' }); assert.equal(folded(main), false);
    f.w.document.querySelectorAll('.o_dialog')[1].remove(); outer.classList.remove('o_inactive_modal'); await f.advance();
    assert.equal(folded(modal), true); await f.message({ action: 'toggleChatter' }); assert.equal(folded(modal), false);
    outer.remove(); await f.advance(); await f.message({ action: 'toggleChatter' }); assert.equal(folded(main), true);
  } finally { f.close(); }
});

test('Odoo 18/19 dialogs without chatter never toggle the background form', async () => {
  const f = await fixture();
  try {
    f.w.document.body.insertAdjacentHTML('beforeend', dialog(form(''))); await f.advance();
    const result = await f.message({ action: 'toggleChatter' });
    assert.equal(result.toggled, false); assert.equal(folded(host(f)), false);
    f.w.document.querySelector('.o_dialog').remove(); await f.advance();
    await f.worker.onCommand.emit('toggle-chatter'); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('folded quick actions follow asynchronous permissions and native button replacement', async () => {
  const disabled = topbar.replaceAll('>Message', ' disabled>Message').replaceAll('>Note', ' aria-disabled="true">Note');
  const f = await fixture({ markup: form(chatter(disabled)), settings: { hideChatter: true } });
  try {
    const actions = () => [...f.w.document.querySelectorAll('[data-chatter-action]')].map(node => node.dataset.chatterAction);
    assert.deepEqual(actions(), ['activity']);
    host(f).querySelector('.o-mail-Chatter-sendMessage').disabled = false;
    host(f).querySelector('.o-mail-Chatter-logNote').removeAttribute('aria-disabled'); await f.advance();
    assert.deepEqual(actions(), ['message', 'note', 'activity']);
    host(f).querySelector('.o-mail-Chatter-sendMessage').classList.add('d-none'); await f.advance();
    assert.deepEqual(actions(), ['note', 'activity']);
    host(f).querySelector('.o-mail-Chatter-topbar').innerHTML = '<button data-hotkey="shift+w">WhatsApp</button>';
    await f.advance(); assert.deepEqual(actions(), ['whatsapp']); assert.ok(toggle(f));
  } finally { f.close(); }
});

test('quick actions invoke native handlers once and respect disabled buttons at click time', async () => {
  const f = await fixture({ settings: { hideChatter: true } });
  try {
    const clicks = [];
    host(f).querySelector('.o-mail-Chatter-sendMessage').addEventListener('click', () => clicks.push('message'));
    host(f).querySelector('.o-mail-Chatter-logNote').addEventListener('click', () => clicks.push('note'));
    host(f).querySelector('.o-mail-Chatter-activity').addEventListener('click', () => clicks.push('activity'));
    f.w.document.querySelector('[data-chatter-action="activity"]').click(); assert.equal(folded(host(f)), true);
    f.w.document.querySelector('[data-chatter-action="note"]').click(); assert.equal(folded(host(f)), false);
    toggle(f).click();
    const message = f.w.document.querySelector('[data-chatter-action="message"]');
    host(f).querySelector('.o-mail-Chatter-sendMessage').setAttribute('aria-disabled', 'true'); message.click();
    assert.deepEqual(clicks, ['activity', 'note']); assert.equal(folded(host(f)), true);
    host(f).querySelector('.o-mail-Chatter-sendMessage').removeAttribute('aria-disabled'); message.click();
    assert.deepEqual(clicks, ['activity', 'note', 'message']); assert.equal(folded(host(f)), false);
  } finally { f.close(); }
});

test('width updates arriving during a drag cannot override the live width', async () => {
  const f = await fixture();
  try {
    pointer(f, f.w.document.querySelector('.chatter-resize-handle'), 'pointerdown', 870);
    pointer(f, f.w, 'pointermove', 750); assert.equal(width(host(f)), '650px');
    await f.setting({ chatterWidth: 400 }); assert.equal(width(host(f)), '650px');
    host(f).classList.add('o-rerendered'); await f.advance(); assert.equal(width(host(f)), '650px');
    pointer(f, f.w, 'pointerup'); await f.advance(); assert.equal(f.state.sync.chatterWidth, 650);
  } finally { f.close(); }
});

for (const ending of ['pointercancel', 'blur', 'navigate', 'detach']) test(`drag cleanup on ${ending} restores state without persisting partial changes`, async () => {
  const f = await fixture();
  try {
    const native = host(f); pointer(f, f.w.document.querySelector('.chatter-resize-handle'), 'pointerdown', 870);
    pointer(f, f.w, 'pointermove', 800); assert.equal(width(native), '600px');
    if (ending === 'navigate') f.w.history.pushState({}, '', '/odoo/sales/2');
    else if (ending === 'detach') native.remove();
    else pointer(f, f.w, ending);
    await f.advance(); assert.equal(f.w.document.body.classList.contains('chatter-resize-active'), false);
    assert.equal(f.state.sync.chatterWidth, undefined);
    if (native.isConnected) assert.equal(width(native), '530px');
  } finally { f.close(); }
});

test('drag clamping, wrong pointer IDs and RTL use the native split bounds', async () => {
  const f = await fixture();
  try {
    const renderer = host(f).parentElement; renderer.style.direction = 'rtl'; await f.advance();
    pointer(f, f.w.document.querySelector('.chatter-resize-handle'), 'pointerdown', 530, 7);
    pointer(f, f.w, 'pointermove', 650, 8); assert.equal(width(host(f)), '530px');
    pointer(f, f.w, 'pointermove', 650, 7); assert.equal(width(host(f)), '650px');
    pointer(f, f.w, 'pointermove', 2000, 7); assert.equal(width(host(f)), '1040px');
    pointer(f, f.w, 'pointerup', 0, 7); await f.advance(); assert.equal(f.state.sync.chatterWidth, 1040);
    renderer.dataset.testWidth = '700'; f.w.dispatchEvent(new f.w.Event('resize')); await f.advance();
    assert.equal(f.w.document.querySelector('.chatter-resize-handle'), null); assert.equal(width(host(f)), '');
  } finally { f.close(); }
});

test('pagehide suspends pending work and pageshow reattaches one set of controls', async () => {
  const f = await fixture();
  try {
    pointer(f, f.w.document.querySelector('.chatter-resize-handle'), 'pointerdown', 870);
    f.w.dispatchEvent(new f.w.Event('pagehide'));
    f.w.document.querySelector('.o_action_manager').innerHTML = form();
    await f.advance(5000); assert.equal(toggle(f), null);
    assert.equal(f.w.document.body.classList.contains('chatter-resize-active'), false);
    f.w.dispatchEvent(new f.w.Event('pageshow')); await f.advance();
    assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
    toggle(f).click(); assert.equal(folded(host(f)), true);
  } finally { f.close(); }
});

test('recent tracking is not starved by continuous native rerenders', async () => {
  const f = await fixture();
  try {
    f.w.history.pushState({}, '', '/odoo/sales/2');
    for (let index = 0; index < 20; index++) { host(f).classList.toggle('o-odoo-busy'); await f.advance(100); }
    assert.equal(f.state.local.recentViews[0].url, 'https://tenant.odoo.com/odoo/sales/2');
    assert.equal(f.state.local.recentViews.length, 2);
  } finally { f.close(); }
});

test('returning from a list refreshes the recent record timestamp', async () => {
  const f = await fixture();
  try {
    const timestamp = f.state.local.recentViews[0].timestamp;
    f.w.history.pushState({}, '', '/odoo/sales');
    f.w.document.querySelector('.o_action_manager').innerHTML = '<div class="o_list_view">List</div>'; await f.advance(5000);
    f.w.history.pushState({}, '', '/odoo/sales/1');
    f.w.document.querySelector('.o_action_manager').innerHTML = form(); await f.advance();
    assert.equal(f.state.local.recentViews.length, 1); assert.ok(f.state.local.recentViews[0].timestamp > timestamp);
  } finally { f.close(); }
});

test('moving a retained form into a dialog updates the active panel scope', async () => {
  const f = await fixture({ version: 17 });
  try {
    const retained = f.w.document.querySelector('.o_form_view');
    f.w.document.body.insertAdjacentHTML('beforeend', dialog(''));
    f.w.document.querySelector('.modal-body').append(retained); await f.advance();
    assert.ok(f.w.__chatterUtilities.activePanel().dialog);
    await f.message({ action: 'toggleChatter' }); assert.equal(folded(host(f)), true);
    f.w.document.querySelector('.o_content').append(retained); f.w.document.querySelector('.o_dialog').remove(); await f.advance();
    assert.equal(f.w.__chatterUtilities.activePanel().dialog, null); assert.ok(toggle(f));
  } finally { f.close(); }
});

test('theme tokens follow native colors and restore when removed or deactivated', async () => {
  const f = await fixture({ beforeLoad(w) { w.document.documentElement.style.setProperty('--chatter-ext-border', '#123456'); } });
  try {
    const root = f.w.document.documentElement;
    root.style.setProperty('--border-color', '#abcdef'); root.style.setProperty('--o-webclient-color-scheme', 'dark'); await f.advance();
    assert.equal(root.style.getPropertyValue('--chatter-ext-border'), '#abcdef'); assert.equal(root.dataset.chatterExtTheme, 'dark');
    root.style.removeProperty('--border-color'); await f.advance();
    assert.equal(root.style.getPropertyValue('--chatter-ext-border'), '#123456');
    await f.message({ action: 'deactivate' }); assert.equal(root.dataset.chatterExtTheme, undefined);
    assert.equal(root.style.getPropertyValue('--chatter-ext-border'), '#123456');
  } finally { f.close(); }
});

test('support styling preserves native nodes, listeners and forms and reverses completely', async () => {
  const markup = '<div id="support-nav"><div class="container-fluid"><a id="menu" href="#">Menu</a></div></div><div id="native-controls"><form id="native-form"><select><option>Database</option></select><button>Submit</button></form></div><h2>Overview</h2><h2 id="database">Database</h2>';
  const f = await fixture({ url: 'https://www.odoo.com/_odoo/support', markup });
  try {
    const navbar = f.w.document.querySelector('#support-nav'); const nativeForm = f.w.document.querySelector('form'); const parent = nativeForm.parentElement;
    let direct = 0; let delegated = 0;
    nativeForm.addEventListener('submit', event => { event.preventDefault(); direct++; });
    parent.addEventListener('submit', () => delegated++);
    await f.setting({ stylishSupport: true }); assert.equal(f.w.document.querySelectorAll('.chatter-toc').length, 1);
    assert.equal(f.w.document.querySelector('#support-nav'), navbar); assert.ok(navbar.querySelector('#menu'));
    assert.equal(nativeForm.parentElement, parent); assert.equal(f.w.document.querySelector('form'), nativeForm);
    nativeForm.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true })); assert.equal(direct, 1); assert.equal(delegated, 1);
    const heading = f.w.document.querySelector('h2'); assert.equal(heading.hasAttribute('id'), false);
    heading.firstChild.data = 'New heading'; await f.advance(); assert.equal(f.w.document.querySelector('.toc-link').textContent, 'New heading');
    f.w.document.querySelector('.chatter-toc').remove(); await f.advance(); assert.ok(f.w.document.querySelector('.chatter-toc'));
    await f.setting({ stylishSupport: false }); assert.equal(f.w.document.querySelector('.chatter-toc'), null);
    assert.equal(f.w.document.querySelector('link[href$="support.css"]'), null); assert.ok(navbar.querySelector('#menu'));
    assert.equal(f.w.document.querySelector('h2[id]')?.id, 'database');
  } finally { f.close(); }
});

test('singleton prevents duplicate injection and teardown permits clean reinjection', async () => {
  const f = await fixture();
  try {
    const app = f.w.__chatterUtilities; f.w.eval(source('content.js')); await f.advance();
    assert.equal(f.w.__chatterUtilities, app); assert.equal(f.w.document.querySelectorAll('.chatter-toggle').length, 1);
    await f.message({ action: 'deactivate' }); assert.equal(f.w.__chatterUtilities, undefined);
    assert.equal(toggle(f), null); assert.equal(f.w.document.querySelector('[data-chatter-ext-theme]'), null);
    f.w.eval(source('content.js')); await f.advance(); assert.ok(toggle(f)); assert.notEqual(f.w.__chatterUtilities, app);
  } finally { f.close(); }
});
