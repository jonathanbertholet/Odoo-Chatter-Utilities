(() => {
  const U = globalThis.ChatterUtils;
  const $ = id => document.getElementById(id);
  const settings = { hideChatter: false, displayBelow: false, stretchFormWhenFolded: false, debugMode: false, stylishSupport: false, showDomains: true };
  const controls = { hideChatter: 'hideChatter', displayBelow: 'displayBelow', stretchFormWhenFolded: 'stretchFormWhenFolded',
    debugMode: 'debugMode', stylishSupportToggle: 'stylishSupport', showDomainsToggle: 'showDomains' };
  let currentTab;
  let draggedUrl;
  const revisions = {};
  let pinRender = 0;
  let recentRender = 0;
  let permissionRender = 0;

  function read(area, keys) {
    return new Promise((resolve, reject) => chrome.storage[area].get(keys, values => {
      const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); else resolve(values);
    }));
  }
  function write(area, values) {
    return new Promise((resolve, reject) => chrome.storage[area].set(values, () => {
      const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); else resolve();
    }));
  }
  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'The extension worker did not respond');
    return response;
  }
  function status(message, error = false) {
    const element = $('popupStatus'); element.hidden = !message; element.textContent = message || '';
    element.classList.toggle('is-error', error);
  }
  const failed = error => status(error.message || String(error), true);
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function validUrl(value) { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch (_) { return false; } }
  function displayDomain(value) {
    const hostname = new URL(value).hostname;
    return hostname === 'www.odoo.com' ? 'odoo.com' : hostname.replace(/\.odoo\.com$/, '');
  }
  function appName(value) {
    const url = new URL(value);
    if (url.pathname === '/web') return new URLSearchParams(url.hash.slice(1)).get('model') || 'Odoo';
    const name = url.pathname.split('/').filter(Boolean)[1] || 'Odoo';
    return name[0].toUpperCase() + name.slice(1);
  }
  async function openPage(url) {
    if (!validUrl(url) || !currentTab?.id) return;
    await chrome.tabs.update(currentTab.id, { url }); window.close();
  }
  function renderSettings() {
    for (const [id, key] of Object.entries(controls)) $(id).checked = !!settings[key];
    $('hideChatter').disabled = !!settings.displayBelow;
  }
  async function renderPins() {
    const revision = ++pinRender;
    const { pinnedPages = [] } = await read('local', 'pinnedPages');
    if (revision !== pinRender) return;
    const list = $('pinsList'); list.replaceChildren();
    for (const pin of Array.isArray(pinnedPages) ? pinnedPages : []) {
      if (!pin || !validUrl(pin.url)) continue;
      const item = element('div', 'pinned-button'); item.dataset.url = pin.url; item.title = pin.title || pin.url;
      item.tabIndex = 0; item.setAttribute('role', 'link'); item.draggable = true;
      item.append(element('div', 'pinned-app-name', pin.appName || appName(pin.url)), element('div', 'pinned-page-name', pin.title || pin.url));
      if (settings.showDomains) item.append(element('div', 'pinned-domain', displayDomain(pin.url)));
      const remove = element('button', 'remove-pin-button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Unpin ' + (pin.title || pin.url));
      remove.addEventListener('click', async event => {
        event.stopPropagation(); remove.disabled = true;
        try { await request({ action: 'updatePins', operation: 'remove', url: pin.url }); await renderPins(); }
        catch (error) { remove.disabled = false; failed(error); }
      });
      item.append(remove);
      item.addEventListener('click', () => openPage(pin.url).catch(failed));
      item.addEventListener('keydown', event => {
        if (event.target === item && event.key === 'Enter') { event.preventDefault(); openPage(pin.url).catch(failed); }
      });
      item.addEventListener('dragstart', event => { draggedUrl = pin.url; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', pin.url); });
      item.addEventListener('dragover', event => { if (draggedUrl) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
      item.addEventListener('drop', async event => {
        event.preventDefault();
        const dragged = [...list.children].find(child => child.dataset.url === draggedUrl);
        if (!dragged || dragged === item) return;
        const children = [...list.children];
        list.insertBefore(dragged, children.indexOf(dragged) < children.indexOf(item) ? item.nextSibling : item);
        try { await request({ action: 'updatePins', operation: 'reorder', urls: [...list.children].map(child => child.dataset.url) }); }
        catch (error) { failed(error); await renderPins(); }
      });
      item.addEventListener('dragend', () => { draggedUrl = null; }); list.append(item);
    }
  }
  async function renderRecent() {
    const revision = ++recentRender;
    const { recentViews = [] } = await read('local', 'recentViews');
    if (revision !== recentRender) return;
    const list = $('recentViewsList'); list.replaceChildren();
    const query = $('recentViewsSearch').value.trim().toLowerCase();
    const seen = new Set();
    for (const view of Array.isArray(recentViews) ? recentViews : []) {
      if (!view || !validUrl(view.url) || seen.has(view.url)) continue;
      seen.add(view.url);
      const title = String(view.title || view.url);
      if (query && !title.toLowerCase().includes(query) && !view.url.toLowerCase().includes(query)) continue;
      const item = element('div', 'recent-view-item'); item.tabIndex = 0; item.setAttribute('role', 'link'); item.title = title;
      const header = element('div', 'recent-view-header'); header.append(element('div', 'recent-view-title', title));
      if (Number.isFinite(view.timestamp)) {
        const hours = Math.max(0, Math.floor((Date.now() - view.timestamp) / 3600000));
        header.append(element('span', 'recent-view-timestamp', hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : new Date(view.timestamp).toLocaleDateString()));
      }
      item.append(header);
      if (settings.showDomains) item.append(element('div', 'recent-view-domain', displayDomain(view.url)));
      item.addEventListener('click', () => openPage(view.url).catch(failed));
      item.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); openPage(view.url).catch(failed); } });
      list.append(item);
    }
    if (!list.childElementCount) list.append(element('div', 'recent-view-empty', query ? 'No matching records' : 'No recently visited pages'));
  }
  async function renderPermissions() {
    const revision = ++permissionRender;
    const { origins = [] } = await chrome.permissions.getAll();
    if (revision !== permissionRender) return;
    const all = origins.includes('<all_urls>'); $('revokeAllUrls').disabled = !all;
    const patterns = origins.filter(pattern => /^(https?|\*):\/\//.test(pattern) && pattern !== U.BUILTIN_PATTERN);
    const list = $('whitelistList'); list.replaceChildren();
    if (!patterns.length) list.append(element('div', 'setting-description', all ? 'Access to all sites is enabled.' : 'No custom domains added yet.'));
    for (const pattern of patterns) {
      const row = element('div', 'whitelist-item'); row.append(element('div', 'whitelist-domain', pattern.replace(/\/\*$/, '')));
      const remove = element('button', 'remove-domain', 'Remove'); remove.type = 'button'; remove.disabled = all;
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          if (!await chrome.permissions.remove({ origins: [pattern] })) throw new Error('Could not remove permission for this site.');
          await request({ action: 'syncPermissions' }); await renderPermissions(); status('Site access removed.');
        } catch (error) { remove.disabled = false; failed(error); }
      });
      row.append(remove); list.append(row);
    }
  }
  function bind() {
    for (const [id, key] of Object.entries(controls)) $(id).addEventListener('change', async () => {
      const node = $(id); const before = settings[key]; const value = node.checked; node.disabled = true;
      try {
        await write(key === 'showDomains' ? 'local' : 'sync', { [key]: value });
        settings[key] = value; renderSettings(); status('');
        if (key === 'showDomains') await Promise.all([renderPins(), renderRecent()]);
      } catch (error) { settings[key] = before; renderSettings(); failed(error); }
      finally { if (id !== 'hideChatter' || !settings.displayBelow) node.disabled = false; }
    });
    $('pinPageButton').addEventListener('click', async () => {
      if (!currentTab || !validUrl(currentTab.url)) { status('Open an HTTP or HTTPS page to pin it.', true); return; }
      $('pinPageButton').disabled = true;
      try { await request({ action: 'updatePins', operation: 'add', page: { url: currentTab.url, title: currentTab.title || currentTab.url, appName: appName(currentTab.url) } }); await renderPins(); }
      catch (error) { failed(error); }
      finally { $('pinPageButton').disabled = false; }
    });
    $('settingsLink').addEventListener('click', () => {
      if (!currentTab || !validUrl(currentTab.url)) { status('Open your Odoo site first.', true); return; }
      const url = new URL(currentTab.url);
      // 17 uses hash actions; the Settings client action has a stable XML ID.
      const target = url.pathname.startsWith('/odoo') || url.pathname.startsWith('/scoped_app')
        ? `${url.origin}/odoo/settings?debug=1` : `${url.origin}/web?debug=1#action=base_setup.action_general_configuration`;
      chrome.tabs.create({ url: target }).then(() => window.close(), failed);
    });
    $('recentViewsSearch').addEventListener('input', () => renderRecent().catch(failed));
    $('addCurrentDomain').addEventListener('click', () => {
      if (!currentTab || !validUrl(currentTab.url)) { status('Open your Odoo site using HTTP or HTTPS first.', true); return; }
      const origin = new URL(currentTab.url).origin;
      // Request synchronously in the click gesture; tab metadata was loaded on popup open.
      chrome.permissions.request({ origins: [`${origin}/*`] }).then(async granted => {
        if (!granted) { status('Permission not granted for this site.', true); return; }
        await request({ action: 'syncPermissions' }); await renderPermissions();
        status('Site allowed. Refresh your Odoo page to activate the extension.');
      }).catch(failed);
    });
    $('revokeAllUrls').addEventListener('click', async () => {
      try {
        if (!await chrome.permissions.remove({ origins: ['<all_urls>'] })) throw new Error('Could not revoke access to all sites.');
        await request({ action: 'syncPermissions' }); await renderPermissions(); status('Access to all sites removed.');
      } catch (error) { failed(error); }
    });
    const header = $('settingsHeader'); header.tabIndex = 0; header.setAttribute('role', 'button');
    const collapse = () => {
      const collapsed = header.closest('.settings-section').classList.toggle('collapsed');
      header.setAttribute('aria-expanded', String(!collapsed)); write('local', { settingsCollapsed: collapsed }).catch(failed);
    };
    header.addEventListener('click', collapse);
    header.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); collapse(); } });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    for (const key of Object.keys(settings)) if (changes[key] && area === (key === 'showDomains' ? 'local' : 'sync')) {
      revisions[key] = (revisions[key] || 0) + 1;
      settings[key] = typeof changes[key].newValue === 'boolean' ? changes[key].newValue : key === 'showDomains';
    }
    if (!document.body) return;
    renderSettings();
    if (changes.pinnedPages || changes.showDomains) renderPins().catch(failed);
    if (changes.recentViews || changes.showDomains) renderRecent().catch(failed);
  });
  document.addEventListener('DOMContentLoaded', async () => {
    bind(); $('addCurrentDomain').disabled = true; $('pinPageButton').disabled = true; $('settingsLink').disabled = true;
    const before = { ...revisions };
    try {
      const [sync, local, tabs] = await Promise.all([read('sync', Object.values(controls).filter(key => key !== 'showDomains')),
        read('local', ['showDomains', 'settingsCollapsed']), chrome.tabs.query({ active: true, currentWindow: true })]);
      for (const key of Object.keys(settings)) if (before[key] === revisions[key]) {
        const value = key === 'showDomains' ? local[key] : sync[key];
        if (typeof value === 'boolean') settings[key] = value;
      }
      currentTab = tabs[0]; renderSettings();
      $('settingsHeader').closest('.settings-section').classList.toggle('collapsed', !!local.settingsCollapsed);
      $('settingsHeader').setAttribute('aria-expanded', String(!local.settingsCollapsed));
      await Promise.all([renderPins(), renderRecent(), renderPermissions()]); $('recentViewsSearch').focus();
    } catch (error) { failed(error); }
    finally { $('addCurrentDomain').disabled = false; $('pinPageButton').disabled = false; $('settingsLink').disabled = false; }
  });
})();
