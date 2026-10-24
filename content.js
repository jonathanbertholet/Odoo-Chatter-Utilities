(() => {
  if (globalThis.__chatterUtilities) return;
  const U = globalThis.ChatterUtils;
  if (!U) return;

  const SHELL = '.o-mail-Form-chatter, .o-mail-ChatterContainer';
  const DIALOG = '.modal, [role="dialog"], .o_dialog';
  const STUDIO = '.o_studio, .o_studio_view_editor, .o_Studio_ChatterContainer';
  const UI = '.chatter-toggle, .chatter-collapsed-rail, .chatter-resize-handle, .chatter-support-controls, .chatter-toc';
  const ROOTS = `${SHELL}, .o-mail-Chatter, .o-mail-Chatter-topbar, .o_form_view, .o_action_manager, ${DIALOG}, ${STUDIO}`;
  const DEFAULTS = Object.freeze({ hideChatter: false, displayBelow: false, stretchFormWhenFolded: false,
    debugMode: false, stylishSupport: false, chatterWidth: 530 });
  const MIN_PANEL = 380;
  const MIN_FORM = 360;
  let nextPanelId = 0;
  const svg = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
  const ACTIONS = [
    { id: 'message', label: 'Send message', selector: '.o-mail-Chatter-sendMessage', icon: svg('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z') },
    { id: 'note', label: 'Log note', selector: '.o-mail-Chatter-logNote', icon: svg('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z') },
    { id: 'whatsapp', label: 'WhatsApp', selector: 'button[data-hotkey="shift+w"]', icon: svg('M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12zm0-4H6V8h12z') },
    { id: 'activity', label: 'Schedule activity', selector: '.o-mail-Chatter-activity', keepCollapsed: true, icon: svg('M17 12h-5v5h5zM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1zm3 18H5V8h14z') },
  ];
  const ACTION_SELECTOR = ACTIONS.map(action => action.selector).join(', ');

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(keys, values => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(values);
      });
    });
  }
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'The extension worker did not respond');
    return result;
  }
  function cleanClasses(value) { return (value || '').split(/\s+/).filter(name => name && !name.startsWith('chatter-')).sort().join(' '); }
  function cleanStyle(value) { return (value || '').split(';').filter(rule => !/^\s*--chatter-/.test(rule)).join(';'); }
  function setVariable(element, key, value) {
    if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
  }
  function isStudio() {
    return /(?:^|\/)studio(?:\/|$)/.test(location.pathname)
      || new URLSearchParams(location.hash.slice(1)).get('studio') === '1' || !!document.querySelector(STUDIO);
  }
  function dialogOf(element) { return element.closest('.modal, [role="dialog"]') || element.closest('.o_dialog'); }
  function visible(element, ownFold = false) {
    if (!element?.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true'
          || node.matches('.d-none, .hidden, .o_inactive_modal, .o_account_report_chatter_hidden')) return false;
      const style = getComputedStyle(node);
      const foldedByUs = ownFold && node.classList.contains('chatter-ext-hidden');
      if ((!foldedByUs && style.display === 'none') || ['hidden', 'collapse'].includes(style.visibility)) return false;
      if (foldedByUs && node.style.display === 'none') return false;
    }
    return true;
  }
  function normalizeShell(element) {
    return element.closest('.o-mail-Form-chatter') || element.closest('.o-mail-ChatterContainer');
  }
  function resolveWidth(value, available = innerWidth) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
    return Math.round(available * ({ standard: 0.335, medium: 0.415, large: 0.5 }[value] || 0)) || 530;
  }
  function button(className, label, markup) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = className; element.title = label;
    element.setAttribute('aria-label', label); element.innerHTML = markup;
    return element;
  }

  class PanelController {
    constructor(app, host) {
      this.app = app; this.host = host; this.parent = host.parentElement;
      this.scope = host.closest('.o_form_view') || dialogOf(host) || this.parent;
      this.dialog = dialogOf(host); this.mode = null; this.drag = null;
      this.ownedId = !host.id ? `chatter-ext-panel-${++nextPanelId}` : null;
      if (this.ownedId) host.id = this.ownedId;
      this.lastParentWidth = this.parent.clientWidth;
      if (globalThis.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          const width = this.parent.clientWidth;
          if (width !== this.lastParentWidth) { this.lastParentWidth = width; app.schedule(); }
        });
        this.resizeObserver.observe(this.parent);
      }
    }
    identity() {
      // Dialog records do not alter the background action URL in Odoo 17.
      return this.dialog ? `dialog:${this.host.dataset.resModel || ''}:${this.host.dataset.resId || ''}` : U.recordIdentity(location.href);
    }
    state() {
      const identity = this.identity();
      let state = this.app.panelStates.get(this.scope);
      if (!state || state.identity !== identity) {
        this.cancelDrag(false);
        // Odoo saves a draft in the same mounted form before opening its composer.
        // Assigning that record its first ID must not fold the newly opened composer.
        state = state && !this.dialog && U.isRecordSave(state.href, location.href) ? { ...state, identity, href: location.href }
          : { identity, href: location.href, hidden: this.app.settings.hideChatter, width: resolveWidth(this.app.settings.chatterWidth) };
        this.app.panelStates.set(this.scope, state);
      }
      return state;
    }
    nativeBelow() { return !this.host.classList.contains('o-aside'); }
    standardSplit() {
      return this.host.matches('.o-mail-Form-chatter.o-aside') && !!this.host.closest('.o_form_view')
        && !!this.parent.querySelector(':scope > .o_form_sheet_bg');
    }
    layoutMode() {
      if (this.nativeBelow()) return 'native-below';
      // Reflow only a standard sheet/chatter split; specialized app panels own their layout.
      return this.standardSplit() && this.app.settings.displayBelow ? 'below' : 'side';
    }
    limits() {
      const width = this.parent.clientWidth;
      const max = Math.floor(Math.min(width - MIN_FORM, width * 0.75));
      return max >= MIN_PANEL ? { min: MIN_PANEL, max } : null;
    }
    resizable() { return this.standardSplit() && this.limits(); }
    createUi() {
      if (this.rail) {
        if (this.rail.parentElement !== this.parent) this.parent.append(this.rail);
        return;
      }
      this.uiAbort = new AbortController();
      const options = { signal: this.uiAbort.signal };
      this.toggle = button('chatter-toggle btn btn-link text-action', 'Toggle chatter',
        '<svg class="chatter-toggle-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M11 14L7 10L11 6"/></svg>');
      this.toggle.setAttribute('aria-controls', this.host.id);
      this.rail = document.createElement('div'); this.rail.className = 'chatter-collapsed-rail';
      this.railBody = document.createElement('div'); this.railBody.className = 'chatter-rail-body';
      this.actions = document.createElement('div'); this.actions.className = 'chatter-collapsed-actions';
      this.actions.setAttribute('role', 'toolbar'); this.actions.setAttribute('aria-label', 'Chatter quick actions');
      this.railBody.append(this.toggle, this.actions); this.rail.append(this.railBody); this.parent.append(this.rail);
      this.toggle.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); this.setHidden(!this.state().hidden);
      }, options);
      this.actions.addEventListener('click', event => {
        const element = event.target.closest('[data-chatter-action]');
        if (!element || !this.actions.contains(element)) return;
        event.preventDefault(); event.stopPropagation();
        const action = ACTIONS.find(item => item.id === element.dataset.chatterAction);
        const native = this.host.querySelector('.o-mail-Chatter-topbar')?.querySelector(action.selector);
        if (!native || native.matches(':disabled') || native.getAttribute('aria-disabled') === 'true' || !visible(native, true)) return;
        if (!action.keepCollapsed) this.setHidden(false);
        // Odoo's native handlers own saving new records, composer focus and dialogs.
        native.click();
      }, options);
    }
    refreshActions(topbar) {
      const available = ACTIONS.filter(action => {
        const native = topbar.querySelector(action.selector);
        return native && !native.matches(':disabled') && native.getAttribute('aria-disabled') !== 'true' && visible(native, true);
      });
      const key = available.map(action => action.id).join(',');
      if (key === this.actionKey) return;
      this.actionKey = key;
      this.actions.replaceChildren(...available.map(action => {
        const element = button('chatter-collapsed-action', action.label, action.icon);
        element.dataset.chatterAction = action.id;
        return element;
      }));
    }
    clearUi() {
      this.cancelDrag(false); this.uiAbort?.abort();
      this.toggle?.remove(); this.rail?.remove(); this.handle?.remove();
      this.toggle = this.rail = this.railBody = this.handle = this.actions = null; this.actionKey = null;
    }
    clearLayout() {
      this.host.classList.remove('chatter-ext-hidden', 'chatter-width-managed', 'chatter-ext-below-panel');
      this.parent.classList.remove('chatter-ext-host', 'chatter-ext-collapsed', 'chatter-ext-stretch', 'chatter-ext-below');
      this.host.style.removeProperty('--chatter-panel-width'); this.parent.style.removeProperty('--chatter-panel-width');
    }
    setHidden(value) { this.state().hidden = value; this.sync(); }
    sync() {
      const state = this.state();
      const mode = this.layoutMode();
      const topbar = this.host.querySelector('.o-mail-Chatter-topbar');
      if (mode !== this.mode) { this.cancelDrag(false); this.clearLayout(); this.mode = mode; }
      if (mode !== 'side' || !topbar) {
        this.clearUi(); this.clearLayout();
        // Native below/PDF layouts stay fully native; hideChatter is a side-only setting.
        if (mode === 'below') {
          this.parent.classList.add('chatter-ext-host', 'chatter-ext-below');
          this.parent.classList.toggle('chatter-ext-stretch', this.app.settings.stretchFormWhenFolded);
          this.host.classList.add('chatter-ext-below-panel');
        }
        return;
      }
      this.createUi();
      this.parent.classList.add('chatter-ext-host');
      this.parent.classList.toggle('chatter-ext-collapsed', state.hidden);
      this.parent.classList.toggle('chatter-ext-stretch', state.hidden && this.app.settings.stretchFormWhenFolded);
      this.host.classList.toggle('chatter-ext-hidden', state.hidden);
      this.rail.classList.toggle('is-collapsed', state.hidden);
      this.toggle.classList.toggle('collapsed-mode', state.hidden);
      this.toggle.classList.toggle('topbar-mode', !state.hidden);
      this.toggle.setAttribute('aria-expanded', String(!state.hidden));
      this.toggle.setAttribute('aria-label', state.hidden ? 'Open chatter' : 'Fold chatter');
      this.toggle.title = state.hidden ? 'Open chatter' : 'Fold chatter';
      this.rail.hidden = !state.hidden;
      const destination = state.hidden ? this.railBody : topbar;
      if (this.toggle.parentElement !== destination) destination.prepend(this.toggle);
      this.refreshActions(topbar);
      if (this.resizable()) {
        if (!this.handle) {
          this.handle = document.createElement('div'); this.handle.className = 'chatter-resize-handle';
          this.handle.setAttribute('role', 'separator'); this.handle.setAttribute('aria-orientation', 'vertical');
          this.handle.addEventListener('pointerdown', event => this.startDrag(event), { signal: this.uiAbort.signal });
        }
        const handleParent = state.hidden ? this.rail : this.parent;
        if (this.handle.parentElement !== handleParent) handleParent.prepend(this.handle);
        this.handle.classList.toggle('in-rail', state.hidden);
        this.handle.title = state.hidden ? 'Drag to open chatter' : 'Drag to resize chatter';
        this.handle.setAttribute('aria-label', this.handle.title);
        if (!state.hidden) this.applyWidth(state.width);
      } else {
        this.cancelDrag(false);
        this.handle?.remove(); this.handle = null;
        this.host.classList.remove('chatter-width-managed');
        this.host.style.removeProperty('--chatter-panel-width'); this.parent.style.removeProperty('--chatter-panel-width');
      }
    }
    applyWidth(width) {
      const limits = this.limits();
      if (!limits || this.mode !== 'side' || this.state().hidden) return;
      const px = Math.min(limits.max, Math.max(limits.min, width));
      this.host.classList.add('chatter-width-managed');
      setVariable(this.host, '--chatter-panel-width', `${px}px`); setVariable(this.parent, '--chatter-panel-width', `${px}px`);
      this.handle?.setAttribute('aria-valuenow', String(Math.round(px)));
    }
    startDrag(event) {
      if (event.button !== 0 || event.isPrimary === false || !this.resizable() || this.mode !== 'side') return;
      event.preventDefault(); event.stopPropagation(); this.app.cancelDrags();
      const state = this.state();
      const start = { width: state.width, hidden: state.hidden };
      const abort = new AbortController();
      const id = event.pointerId;
      const rtl = getComputedStyle(this.parent).direction === 'rtl';
      this.drag = { abort, start, state };
      document.body.classList.add('chatter-resize-active'); this.handle.classList.add('is-dragging');
      const move = event => {
        if (event.pointerId !== id || !this.drag) return;
        if (!this.host.isConnected || this.layoutMode() !== 'side') { this.cancelDrag(false); return; }
        const rect = this.parent.getBoundingClientRect();
        const width = rtl ? event.clientX - rect.left : rect.right - event.clientX;
        const limits = this.limits();
        if (!limits) { this.cancelDrag(false); return; }
        if (width < limits.min) { if (!state.hidden) { state.hidden = true; this.sync(); } return; }
        state.hidden = false; state.width = Math.min(limits.max, width); this.sync();
        // Moving a grip between rail and split can invalidate pointer capture.
        try { this.handle?.setPointerCapture?.(id); } catch (_) {}
      };
      const finish = event => { if (event.pointerId === id) this.cancelDrag(event.type === 'pointerup'); };
      window.addEventListener('pointermove', move, { signal: abort.signal });
      window.addEventListener('pointerup', finish, { signal: abort.signal });
      window.addEventListener('pointercancel', finish, { signal: abort.signal });
      window.addEventListener('blur', () => this.cancelDrag(false), { signal: abort.signal });
      try { this.handle.setPointerCapture?.(id); } catch (_) {}
    }
    cancelDrag(commit) {
      if (!this.drag) return;
      const { abort, start, state } = this.drag; this.drag = null; abort.abort();
      document.body.classList.remove('chatter-resize-active'); this.handle?.classList.remove('is-dragging');
      if (!commit) { state.width = start.width; state.hidden = start.hidden; }
      else {
        // Folding keeps the last visible width, rather than persisting a tiny panel.
        if (state.hidden) state.width = start.width;
        this.app.settings.chatterWidth = Math.round(state.width);
        chrome.storage.sync.set({ chatterWidth: Math.round(state.width) }, () => {
          if (chrome.runtime.lastError) console.warn('[Chatter Utilities] Could not save width:', chrome.runtime.lastError.message);
        });
      }
      if (this.host.isConnected && commit) this.sync();
      this.app.schedule();
    }
    destroy() {
      this.clearUi(); this.clearLayout(); this.resizeObserver?.disconnect();
      if (this.ownedId && this.host.id === this.ownedId) this.host.removeAttribute('id');
    }
  }

  class SupportEnhancer {
    constructor() { this.headings = []; }
    sync(enabled) {
      if (!enabled || !location.pathname.includes('/_odoo/support')) { this.clear(); return; }
      if (!this.link) {
        this.link = document.createElement('link'); this.link.rel = 'stylesheet';
        this.link.href = chrome.runtime.getURL('support.css'); document.head.append(this.link);
        this.abort = new AbortController();
        window.addEventListener('scroll', () => this.navbar?.classList.toggle('chatter-ext-scrolled', scrollY > 20), { passive: true, signal: this.abort.signal });
      }
      const navbar = document.querySelector('#support-nav');
      if (this.navbar !== navbar) this.navbar?.classList.remove('chatter-ext-scrolled');
      this.navbar = navbar;
      this.navbar?.classList.toggle('chatter-ext-scrolled', scrollY > 20);
      if (!this.link.isConnected) document.head.append(this.link);
      // Leave native forms and navbar nodes in place, including delegated Odoo listeners.
      const headings = [...document.querySelectorAll('h2')];
      const labels = headings.map(heading => heading.textContent);
      if (this.toc?.isConnected && headings.length === this.headings.length
          && headings.every((heading, i) => heading === this.headings[i] && labels[i] === this.labels[i])) return;
      this.clearToc(); this.tocAbort = new AbortController(); this.headings = headings;
      this.labels = labels;
      if (!headings.length) return;
      this.toc = document.createElement('nav'); this.toc.className = 'chatter-toc toc-container'; this.toc.setAttribute('aria-label', 'Table of contents');
      const title = document.createElement('div'); title.className = 'toc-title'; title.textContent = 'Table of Contents';
      const list = document.createElement('ul'); list.className = 'toc-list'; this.links = new Map();
      headings.forEach(heading => {
        const item = document.createElement('li'); item.className = 'toc-item';
        const link = document.createElement('a'); link.className = 'toc-link'; link.href = '#'; link.textContent = heading.textContent;
        link.addEventListener('click', event => {
          event.preventDefault();
          heading.scrollIntoView({ behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          this.activate(heading);
        }, { signal: this.tocAbort.signal });
        this.links.set(heading, link); item.append(link); list.append(item);
      });
      this.toc.append(title, list); document.body.append(this.toc);
      if (globalThis.IntersectionObserver) {
        this.spy = new IntersectionObserver(entries => {
          const entry = entries.find(item => item.isIntersecting); if (entry) this.activate(entry.target);
        }, { rootMargin: '-10% 0px -65% 0px' });
        headings.forEach(heading => this.spy.observe(heading));
      }
    }
    activate(heading) { this.links?.forEach((link, current) => link.classList.toggle('active', current === heading)); }
    clearToc() {
      this.tocAbort?.abort(); this.spy?.disconnect(); this.toc?.remove();
      this.tocAbort = this.spy = this.toc = this.links = null; this.headings = []; this.labels = [];
    }
    clear() {
      this.clearToc(); this.abort?.abort(); this.navbar?.classList.remove('chatter-ext-scrolled');
      this.link?.remove(); this.link = this.abort = this.navbar = null;
    }
  }

  class DebugManager {
    constructor(app) { this.app = app; this.revision = 0; this.navigating = false; }
    schedule(explicit = false) {
      this.explicit = this.explicit || explicit;
      clearTimeout(this.timer); const revision = ++this.revision;
      if (this.app.destroyed || this.app.suspended || !this.app.started) return;
      this.timer = setTimeout(() => this.check(revision).catch(error => console.warn('[Chatter Utilities] Debug:', error.message)), 100);
    }
    async check(revision) {
      if (this.app.destroyed || this.app.suspended || this.navigating) return;
      if (!this.explicit && !this.app.settings.debugMode) return;
      const href = location.href;
      const { context } = await send({ action: 'getOdooContext' });
      if (this.app.destroyed || revision !== this.revision || location.href !== href || context?.href !== href) return;
      if (!context.isOdoo) { this.explicit = false; return; }
      const explicit = this.explicit;
      const actual = U.normalizeDebug(context.debug);
      const excluded = U.isDebugExcluded(href);
      let target = null;
      if (explicit && !this.app.settings.debugMode) { if (actual) target = '0'; }
      else if (this.app.settings.debugMode && excluded) { if (actual) target = '0'; }
      else if (this.app.settings.debugMode && U.isBackendUrl(href)) {
        if (!actual) target = '1';
        else if (!U.normalizeDebug(new URL(href).searchParams.get('debug'))) {
          const url = new URL(href); url.searchParams.set('debug', actual);
          history.replaceState(history.state, '', url.href);
        }
      }
      if (target === null) { this.explicit = false; return; }
      const { allowed } = await send({ action: 'authorizeDebugReload', mode: target, explicit });
      if (this.app.destroyed || this.app.suspended || revision !== this.revision || location.href !== href) return;
      this.explicit = false;
      if (!allowed) return;
      this.navigating = true;
      const url = new URL(href); url.searchParams.set('debug', target);
      history.replaceState(history.state, '', url.href);
      window.location.reload();
      // A beforeunload prompt may cancel navigation. The worker guard prevents retry loops.
      this.reset = setTimeout(() => { this.navigating = false; if (this.explicit) this.schedule(); }, 1500);
    }
    pause() { ++this.revision; clearTimeout(this.timer); clearTimeout(this.reset); this.navigating = false; }
    destroy() { this.pause(); }
  }

  class ChatterApp {
    constructor() {
      this.settings = { ...DEFAULTS }; this.panels = new Map(); this.panelStates = new WeakMap();
      this.abort = new AbortController(); this.support = new SupportEnhancer(); this.debug = new DebugManager(this);
      this.settingRevisions = {}; this.themeBefore = new Map(); this.themeWritten = new Map(); this.lastUrl = location.href;
      this.onStorage = (changes, area) => {
        if (area !== 'sync' || this.destroyed) return;
        for (const key of Object.keys(DEFAULTS)) if (changes[key]) {
          this.settingRevisions[key] = (this.settingRevisions[key] || 0) + 1;
          this.settings[key] = key === 'chatterWidth' ? changes[key].newValue ?? DEFAULTS[key]
            : typeof changes[key].newValue === 'boolean' ? changes[key].newValue : DEFAULTS[key];
        }
        for (const controller of this.panels.values()) {
          if (changes.hideChatter) controller.state().hidden = !!this.settings.hideChatter;
          if (changes.chatterWidth && !controller.drag) controller.state().width = resolveWidth(this.settings.chatterWidth);
        }
        if (changes.debugMode) this.debug.schedule(true);
        this.schedule();
      };
      this.onMessage = (message, sender, respond) => {
        if (sender.id !== chrome.runtime.id) return;
        if (message?.action === 'deactivate') { this.destroy(); respond({ ok: true }); }
        else if (message?.action === 'toggleChatter') {
          const controller = this.activePanel();
          if (controller?.mode === 'side' && controller.toggle) controller.setHidden(!controller.state().hidden);
          respond({ ok: true, toggled: !!controller?.toggle });
        } else if (message?.action === 'getPanelStatus') {
          respond({ ok: true, active: !this.destroyed, hasPanel: !!this.activePanel() });
        }
      };
      chrome.storage.onChanged.addListener(this.onStorage); chrome.runtime.onMessage.addListener(this.onMessage);
      this.ready = this.start();
    }
    async start() {
      // One settings snapshot, then synchronous updates from storage events. Never read during interactions.
      const revision = { ...this.settingRevisions };
      try {
        const saved = await storageGet('sync', Object.keys(DEFAULTS));
        for (const key of Object.keys(DEFAULTS)) if (this.settingRevisions[key] === revision[key]) {
          this.settings[key] = key === 'chatterWidth' ? saved[key] ?? DEFAULTS[key]
            : typeof saved[key] === 'boolean' ? saved[key] : DEFAULTS[key];
        }
      } catch (error) { console.warn('[Chatter Utilities] Settings unavailable:', error.message); }
      if (this.destroyed) return;
      this.started = true;
      this.observer = new MutationObserver(mutations => this.onMutations(mutations)); this.observe();
      const options = { signal: this.abort.signal };
      window.addEventListener('resize', () => this.schedule(), options);
      window.addEventListener('popstate', () => this.navigation(), options);
      window.addEventListener('hashchange', () => this.navigation(), options);
      window.addEventListener('pagehide', () => {
        this.suspended = true; this.cancelDrags(); this.observer.disconnect(); this.debug.pause();
        clearInterval(this.poll); clearTimeout(this.pending); this.pending = null;
        clearTimeout(this.recentTimer); this.recentPending = null;
      }, options);
      window.addEventListener('pageshow', () => {
        this.suspended = false; this.observe(); this.startPoll(); this.navigation(); this.schedule(); this.debug.schedule();
      }, options);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.navigation(); this.schedule(); } }, options);
      this.startPoll(); this.sync(); this.debug.schedule();
    }
    startPoll() { clearInterval(this.poll); this.poll = setInterval(() => { if (!document.hidden) this.navigation(); }, 500); }
    observe() {
      this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'dir', 'hidden', 'aria-hidden', 'disabled', 'aria-disabled'] });
    }
    navigation() {
      if (location.href === this.lastUrl || this.destroyed || this.suspended) return;
      if (U.recordIdentity(location.href) !== U.recordIdentity(this.lastUrl)) { this.cancelDrags(); this.lastRecent = null; }
      this.lastUrl = location.href; this.schedule(); this.debug.schedule(); this.trackRecentSoon();
    }
    onMutations(mutations) {
      let relevant = false;
      for (const mutation of mutations) {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (!target || target.closest(UI)) continue;
        if (target.closest('title')) { this.trackRecentSoon(); continue; }
        if (this.support.link && target.closest('h2')) relevant = true;
        if (mutation.type === 'attributes') {
          if (mutation.attributeName === 'class' && cleanClasses(mutation.oldValue) === cleanClasses(target.getAttribute('class'))) continue;
          if (mutation.attributeName === 'style' && cleanStyle(mutation.oldValue) === cleanStyle(target.getAttribute('style'))) continue;
          if (target.matches(`${ROOTS}, .o_form_renderer, .o_web_client, html, body, ${ACTION_SELECTOR}`)
              || [...this.panels.values()].some(controller => target.contains(controller.host))) relevant = true;
        } else if (mutation.type === 'childList') {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes].filter(node => node.nodeType === Node.ELEMENT_NODE && !node.matches(UI));
          if (target.matches('.o-mail-Chatter-topbar') || nodes.some(node => node.matches(`${ROOTS}, h2, #support-nav, .o_database_list, ${ACTION_SELECTOR}`)
              || node.querySelector(`${ROOTS}, h2, #support-nav, .o_database_list`))) relevant = true;
          if (nodes.some(node => node.matches('link[rel="stylesheet"], style'))) relevant = true;
          // OWL may replace a parent's children without replacing the chatter itself.
          // Only repair controls still owned by a live controller, never our own cleanup.
          if ([...mutation.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && !node.isConnected
              && [...this.panels.values()].some(controller => [controller.rail, controller.toggle, controller.handle].includes(node)))) relevant = true;
          if (this.support.toc && !this.support.toc.isConnected) relevant = true;
        }
      }
      if (relevant) this.schedule();
    }
    schedule() {
      if (this.destroyed || this.suspended || !this.started || this.pending) return;
      this.pending = setTimeout(() => { this.pending = null; this.sync(); }, 40);
    }
    sync() {
      if (this.destroyed || this.suspended || !document.body) return;
      const candidates = isStudio() ? [] : [...new Set([...document.querySelectorAll(SHELL)].map(normalizeShell))]
        .filter(host => visible(host, true) && !host.closest(STUDIO));
      for (const [host, controller] of this.panels) {
        if (!candidates.includes(host) || controller.parent !== host.parentElement || controller.dialog !== dialogOf(host)
            || controller.scope !== (host.closest('.o_form_view') || dialogOf(host) || host.parentElement)) {
          controller.destroy(); this.panels.delete(host);
        }
      }
      for (const host of candidates) {
        if (!this.panels.has(host)) this.panels.set(host, new PanelController(this, host));
        this.panels.get(host).sync();
      }
      this.support.sync(this.settings.stylishSupport); this.syncTheme(); this.trackRecentSoon();
    }
    activePanel() {
      if (isStudio()) return null;
      const dialogs = [...document.querySelectorAll(DIALOG)].filter(element => visible(element));
      // The innermost last visible dialog owns interaction, including dialogs without chatter.
      const activeDialog = dialogs.at(-1);
      const candidates = [...this.panels.values()].filter(controller => visible(controller.host, true)
        && (activeDialog ? activeDialog.contains(controller.host) : !controller.dialog));
      const focused = candidates.filter(controller => controller.scope.contains(document.activeElement))
        .sort((a, b) => a.scope.contains(b.scope) ? 1 : -1)[0];
      return focused || candidates[0] || null;
    }
    trackRecentSoon() {
      if (this.destroyed || this.suspended) return;
      const title = document.title.split(' - ').slice(0, -1).join(' - ') || document.title || 'Odoo';
      const url = new URL(location.href); url.searchParams.delete('debug');
      const key = U.recordIdentity(url.href) + '\n' + title;
      if (key === this.lastRecent || key === this.recentPending) return;
      clearTimeout(this.recentTimer);
      this.recentPending = key;
      this.recentTimer = setTimeout(() => {
        this.recentPending = null;
        if (this.destroyed || !U.isBackendUrl(location.href) || isStudio()) return;
        const form = [...document.querySelectorAll('.o_action_manager .o_form_view')].find(element => !dialogOf(element) && visible(element));
        if (!form) return;
        if (key !== U.recordIdentity(location.href) + '\n' + (document.title.split(' - ').slice(0, -1).join(' - ') || document.title || 'Odoo')) {
          this.trackRecentSoon(); return;
        }
        if (key === this.lastRecent) return;
        this.lastRecent = key;
        send({ action: 'trackRecentView', view: { url: url.href, title } }).catch(error => {
          if (this.lastRecent === key) this.lastRecent = null;
          console.warn('[Chatter Utilities] Recent view:', error.message);
        });
      }, 400);
    }
    syncTheme() {
      const root = document.documentElement; const style = getComputedStyle(root);
      const bodyStyle = getComputedStyle(document.body);
      const scheme = style.getPropertyValue('--o-webclient-color-scheme').trim();
      const dark = scheme === 'dark' || bodyStyle.colorScheme === 'dark';
      if (root.dataset.chatterExtTheme !== (dark ? 'dark' : 'light')) {
        if (this.themeAttributeBefore === undefined) this.themeAttributeBefore = root.getAttribute('data-chatter-ext-theme');
        root.dataset.chatterExtTheme = dark ? 'dark' : 'light';
      }
      const values = {
        '--chatter-ext-surface-solid': bodyStyle.getPropertyValue('--body-bg').trim() || style.getPropertyValue('--body-bg').trim(),
        '--chatter-ext-border': bodyStyle.getPropertyValue('--border-color').trim() || style.getPropertyValue('--border-color').trim(),
        '--chatter-ext-text-muted': bodyStyle.getPropertyValue('--secondary-color').trim() || style.getPropertyValue('--secondary-color').trim(),
      };
      for (const [key, value] of Object.entries(values)) {
        if (!value) {
          if (this.themeWritten.has(key) && root.style.getPropertyValue(key) === this.themeWritten.get(key)) {
            const before = this.themeBefore.get(key);
            if (before) root.style.setProperty(key, before); else root.style.removeProperty(key);
          }
          this.themeWritten.delete(key); continue;
        }
        if (!this.themeBefore.has(key)) this.themeBefore.set(key, root.style.getPropertyValue(key));
        setVariable(root, key, value); this.themeWritten.set(key, value);
      }
    }
    cancelDrags() { this.panels.forEach(controller => controller.cancelDrag(false)); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true; this.debug.destroy(); this.abort.abort(); this.observer?.disconnect();
      clearInterval(this.poll); clearTimeout(this.pending); clearTimeout(this.recentTimer);
      this.panels.forEach(controller => controller.destroy()); this.panels.clear(); this.support.clear();
      chrome.storage.onChanged.removeListener(this.onStorage); chrome.runtime.onMessage.removeListener(this.onMessage);
      for (const [key, before] of this.themeBefore) {
        if (document.documentElement.style.getPropertyValue(key) !== this.themeWritten.get(key)) continue;
        if (before) document.documentElement.style.setProperty(key, before); else document.documentElement.style.removeProperty(key);
      }
      if (this.themeAttributeBefore !== undefined) {
        if (this.themeAttributeBefore === null) delete document.documentElement.dataset.chatterExtTheme;
        else document.documentElement.setAttribute('data-chatter-ext-theme', this.themeAttributeBefore);
      }
      delete globalThis.__chatterUtilities;
    }
  }

  globalThis.__chatterUtilities = new ChatterApp();
})();
