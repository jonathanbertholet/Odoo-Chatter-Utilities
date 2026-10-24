// Shared harness; it never starts or controls a browser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => structuredClone(value);
const tick = () => new Promise(setImmediate);
function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => Promise.all([...listeners].map(fn => fn(...args))), listeners };
}
function dispatch(bus, message, sender) {
  return new Promise((resolve, reject) => {
    let waiting = false;
    try {
      for (const listener of bus.listeners) {
        const result = listener(clone(message), sender, value => resolve(value));
        if (result === true) waiting = true;
      }
      if (!waiting) resolve(undefined);
    } catch (error) { reject(error); }
  });
}

function createWorker({ origins = ['*://*.odoo.com/*'], sync = {}, local = {}, session = {} } = {}) {
  const env = { now: 100000, origins: [...origins], values: { sync: clone(sync), local: clone(local), session: clone(session) },
    docs: new Map(), nextTab: 1, registrations: new Map(), changes: [], errors: [], requests: [],
    onChanged: event(), onAdded: event(), onRemoved: event(), onStartup: event(), onInstalled: event(), onTabRemoved: event(), onCommand: event(), onMessage: event(),
    getHook: null, executeHook: null, failNextSet: null, scriptCalls: [] };
  function storage(area, runtime) {
    const api = {};
    for (const operation of ['get', 'set', 'remove']) api[operation] = (argument, callback) => {
      const work = Promise.resolve().then(async () => {
        if (operation === 'get') {
          const keys = argument === null ? Object.keys(env.values[area]) : typeof argument === 'string' ? [argument] : argument;
          const result = clone(Object.fromEntries(keys.filter(key => key in env.values[area]).map(key => [key, env.values[area][key]])));
          return env.getHook ? await env.getHook(area, argument, result) : result;
        }
        if (env.failNextSet === area) { env.failNextSet = null; throw new Error('Mock storage quota error'); }
        const changes = {};
        if (operation === 'set') for (const [key, value] of Object.entries(argument)) {
          const oldValue = env.values[area][key]; env.values[area][key] = clone(value);
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) changes[key] = { oldValue, newValue: clone(value) };
        }
        if (operation === 'remove') for (const key of typeof argument === 'string' ? [argument] : argument) {
          if (key in env.values[area]) { changes[key] = { oldValue: env.values[area][key] }; delete env.values[area][key]; }
        }
        if (Object.keys(changes).length) await env.onChanged.emit(changes, area);
      });
      if (callback) { work.then(callback, error => { runtime.lastError = { message: error.message }; callback(); runtime.lastError = null; }); return; }
      return work;
    };
    return api;
  }
  function chromeFor(doc) {
    const runtime = { id: 'test-extension', lastError: null, onMessage: doc ? event() : env.onMessage,
      onStartup: env.onStartup, onInstalled: env.onInstalled,
      getManifest: () => ({ version: '2.1.0' }), getURL: file => `chrome-extension://test-extension/${file}` };
    runtime.sendMessage = message => dispatch(env.onMessage, message,
      doc ? { id: runtime.id, frameId: 0, documentId: doc.documentId, tab: { id: doc.id }, url: doc.w.location.href }
        : { id: runtime.id, url: runtime.getURL('popup.html') });
    const api = { runtime, storage: { onChanged: env.onChanged },
      permissions: { getAll: () => Promise.resolve({ origins: clone(env.origins) }), onAdded: env.onAdded, onRemoved: env.onRemoved,
        request: async request => { env.requests.push(clone(request)); env.origins.push(...request.origins); await env.onAdded.emit(); return true; },
        remove: async request => { env.origins = env.origins.filter(pattern => !request.origins.includes(pattern)); await env.onRemoved.emit(); return true; } },
      tabs: { onRemoved: env.onTabRemoved,
        query: async query => [...env.docs.values()].filter(item => !query.active || item.active).map(item => ({ id: item.id, url: item.w.location.href, title: item.w.document.title })),
        sendMessage: async (id, message) => {
          const entry = env.docs.get(id); if (!entry) throw new Error('No receiving document');
          return dispatch(entry.chrome.runtime.onMessage, message, { id: runtime.id });
        },
        create: async properties => { env.requests.push(clone(properties)); return { id: 999 }; },
        update: async (id, properties) => { env.requests.push({ id, ...clone(properties) }); return { id }; },
      }, commands: { onCommand: env.onCommand },
      scripting: {
        getRegisteredContentScripts: async ({ ids }) => ids.flatMap(id => env.registrations.has(id) ? [clone(env.registrations.get(id))] : []),
        registerContentScripts: async scripts => { scripts.forEach(script => env.registrations.set(script.id, clone(script))); env.changes.push('register'); },
        updateContentScripts: async scripts => { scripts.forEach(script => env.registrations.set(script.id, clone(script))); env.changes.push('update'); },
        unregisterContentScripts: async ({ ids }) => { ids.forEach(id => env.registrations.delete(id)); env.changes.push('remove'); },
        executeScript: async request => {
          env.scriptCalls.push(request);
          const entry = env.docs.get(request.target.tabId);
          if (!entry || (request.target.documentIds && !request.target.documentIds.includes(entry.documentId))) throw new Error('Document was replaced');
          const result = entry.w.eval(`(${request.func.toString()})()`);
          if (env.executeHook) await env.executeHook(result);
          return [{ result, documentId: entry.documentId }];
        },
      },
    };
    for (const area of ['sync', 'local', 'session']) api.storage[area] = storage(area, runtime);
    return api;
  }
  env.chromeFor = chromeFor;
  const chrome = chromeFor(null); env.chrome = chrome;
  const context = vm.createContext({ chrome, URL, URLSearchParams, console: { error: (...args) => env.errors.push(args.map(String).join(' ')), warn: () => {} },
    Date: class extends Date { static now() { return env.now; } } });
  context.importScripts = file => vm.runInContext(source(file), context);
  vm.runInContext(source('background.js'), context);
  env.flush = async () => { for (let index = 0; index < 12; index++) await tick(); };
  env.message = (message, id) => chrome.runtime.sendMessage(message);
  env.from = (message, sender) => dispatch(env.onMessage, message, { id: chrome.runtime.id, ...sender });
  env.removeOrigins = async patterns => { env.origins = env.origins.filter(origin => !patterns.includes(origin)); await env.onRemoved.emit(); await env.flush(); };
  return env;
}

const topbar = '<div class="o-mail-Chatter-topbar"><button class="o-mail-Chatter-sendMessage">Message</button><button class="o-mail-Chatter-logNote">Note</button><button class="o-mail-Chatter-activity">Activity</button></div>';
const chatter = (bar = topbar, classes = 'o-aside') => `<div class="o-mail-ChatterContainer o-mail-Form-chatter ${classes}"><div class="o-mail-Chatter">${bar}</div></div>`;
const form = (panel = chatter()) => `<div class="o_form_view"><div class="o_form_renderer"><div class="o_form_sheet_bg"><div class="o_form_sheet">Record</div></div>${panel}</div></div>`;

async function fixture({ url = 'https://tenant.odoo.com/odoo/sales/1', markup = form(), settings = {}, worker = createWorker({ sync: settings }),
  runtimeDebug, isOdoo = true, beforeLoad, title = 'Sales order - Odoo', version = 19, guard } = {}) {
  const dom = new JSDOM(`<html><head><title>${title}</title><style>${source('styles.css')}</style></head><body class="o_web_client"><div class="o_action_manager"><div class="o_content">${markup}</div></div></body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const timers = new Map(); const errors = []; const warnings = [];
  let now = worker.now; let timerId = 0; let reloads = 0; let resizes = 0;
  const entry = { w, id: worker.nextTab++, documentId: `doc-${worker.nextTab}`, active: worker.docs.size === 0 };
  const chrome = worker.chromeFor(entry); entry.chrome = chrome; worker.docs.set(entry.id, entry);
  if (guard) worker.values.session[`debugGuard:${entry.id}:${new URL(url).origin}`] = { mode: '1', ...guard };
  w.chrome = chrome;
  w.console.error = (...args) => errors.push(args.map(String).join(' '));
  w.console.warn = (...args) => warnings.push(args.map(String).join(' '));
  w.addEventListener('error', error => errors.push(String(error.error)));
  w.Date.now = () => now;
  w.__reload = () => { reloads++; };
  w.addEventListener('resize', () => { resizes++; });
  w.setTimeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay, interval: delay }); return id; };
  w.clearInterval = w.clearTimeout;
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return Number(this.dataset.testWidth) || (this.classList.contains('o_form_renderer') ? 1400 : 1200); } });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.closest('[hidden], .d-none, .hidden, .chatter-ext-hidden');
    const width = hidden ? 0 : Number(this.dataset.testWidth) || parseFloat(this.style.getPropertyValue('--chatter-panel-width')) || 530;
    return { x: 0, y: 0, top: 0, left: 0, right: this.classList.contains('o_form_renderer') ? this.clientWidth : 1400, bottom: 700, width, height: hidden ? 0 : 700 };
  };
  w.eval(source('shared.js'));
  if (isOdoo) w.odoo = { debug: runtimeDebug ?? w.ChatterUtils.normalizeDebug(new URL(url).searchParams.get('debug')), __session_info__: { server_version_info: [version] } };
  beforeLoad?.(w, worker);
  w.eval(source('content.js').replaceAll('window.location.reload()', 'window.__reload()'));
  await worker.flush();
  async function advance(ms = 1000) {
    const end = now + ms;
    for (let count = 0; ; count++) {
      await worker.flush();
      const next = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (count >= 500) throw new Error('Timer/observer loop did not settle');
      const [id, task] = next; now = task.at; worker.now = now; timers.delete(id);
      if (task.interval) timers.set(id, { ...task, at: now + task.interval });
      task.fn();
    }
    now = end; worker.now = now; await worker.flush();
    if (errors.length || worker.errors.length) throw new Error([...errors, ...worker.errors].join('\n'));
  }
  await advance();
  return { w, worker, id: entry.id, entry, advance, errors, warnings,
    state: worker.values, get reloads() { return reloads; }, get resizes() { return resizes; },
    async setting(values) { await chrome.storage.sync.set(values); await advance(); },
    async message(value) { return worker.chrome.tabs.sendMessage(entry.id, value); },
    close() { w.__chatterUtilities?.destroy(); worker.docs.delete(entry.id); w.close(); },
  };
}

async function popupFixture(origins = ['*://*.odoo.com/*'], tabUrl = 'https://erp.example.com/odoo', options = {}) {
  const worker = options.worker || createWorker({ origins, sync: options.settings || {}, local: options.local || {} });
  const tab = await fixture({ worker, url: tabUrl.startsWith('chrome:') ? 'https://placeholder.example/' : tabUrl });
  if (tabUrl.startsWith('chrome:')) worker.chrome.tabs.query = async () => [{ id: tab.id, url: tabUrl, title: 'Extensions' }];
  const dom = new JSDOM(source('popup.html'), { url: 'https://extension.example/popup.html', runScripts: 'outside-only' });
  const w = dom.window; w.chrome = worker.chromeFor(null); const errors = [];
  const closePopup = w.close.bind(w); const storageListeners = new Set();
  w.chrome.storage.onChanged = {
    addListener(listener) { storageListeners.add(listener); worker.onChanged.addListener(listener); },
    removeListener(listener) { storageListeners.delete(listener); worker.onChanged.removeListener(listener); },
  };
  if (tabUrl.startsWith('chrome:')) w.chrome.tabs.query = worker.chrome.tabs.query;
  w.console.error = (...args) => errors.push(args.map(String).join(' '));
  w.addEventListener('error', error => errors.push(String(error.error)));
  w.close = () => {};
  w.eval(source('shared.js')); w.eval(source('popup.js')); await worker.flush();
  return { w, worker, tab, errors, requests: worker.requests, close() {
    tab.close(); storageListeners.forEach(listener => worker.onChanged.removeListener(listener)); closePopup();
  } };
}

function backgroundFixture(origins) {
  const worker = createWorker({ origins });
  const state = { get origins() { return worker.origins; }, set origins(value) { worker.origins = value; },
    get current() { return worker.registrations.get('dynamic-chatter-content') || null; },
    set current(value) { worker.registrations.set('dynamic-chatter-content', value); }, changes: worker.changes };
  const emit = name => async () => { await worker[name].emit(); await worker.flush(); };
  return { state, worker, events: { startup: emit('onStartup'), added: emit('onAdded'), removed: emit('onRemoved') } };
}
module.exports = { fixture, popupFixture, backgroundFixture, createWorker, form, chatter, topbar, source, tick };
