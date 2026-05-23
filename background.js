// background.js
// Purpose: Dynamically register/unregister content scripts for custom origins requested by the user.

const SCRIPT_ID = 'dynamic-chatter-content';

async function ensureRegisteredForPatterns(patterns) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
    const current = Array.isArray(existing) ? existing.find(s => s.id === SCRIPT_ID) : null;
    if (current) {
      const merged = Array.from(new Set([...(current.matches || []), ...patterns]));
      await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches: merged }]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          matches: patterns,
          js: ['content.js'],
          css: ['styles.css'],
          runAt: 'document_idle'
        }
      ]);
    }
  } catch (e) {
    console.error('[BG] ensureRegisteredForPatterns failed:', e);
  }
}

async function removePatterns(patterns) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
    const current = Array.isArray(existing) ? existing.find(s => s.id === SCRIPT_ID) : null;
    if (!current) return;
    const next = (current.matches || []).filter(m => !patterns.includes(m));
    if (next.length === 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } else {
      await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches: next }]);
    }
  } catch (e) {
    console.error('[BG] removePatterns failed:', e);
  }
}

// Reconcile on startup/install so content scripts match granted permissions
async function reconcileFromPermissions() {
  chrome.permissions.getAll(async (perms) => {
    const origins = (perms && perms.origins) ? perms.origins : [];
    const custom = origins.filter((o) => o.startsWith('http') && !o.includes('*.odoo.com'));
    if (custom.length > 0) {
      await ensureRegisteredForPatterns(custom);
    }
  });
}

// Relay manifest keyboard commands to the active tab's content script
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-chatter') return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: 'toggleChatter' }).catch(() => {
      // Content script may not be injected on this page yet
    });
  });
});

/**
 * Opens the changelog tab once per extension update.
 */
async function showUpdateChangelog() {
  const version = chrome.runtime.getManifest().version;
  const storageKey = 'lastUpdateNotifyVersion';

  try {
    const stored = await chrome.storage.local.get(storageKey);
    // Avoid duplicate tabs if onInstalled fires more than once for the same version
    if (stored[storageKey] === version) return;

    await chrome.storage.local.set({ [storageKey]: version });
    await chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });
  } catch (error) {
    console.error('[BG] showUpdateChangelog failed:', error);
  }
}

chrome.runtime.onStartup.addListener(reconcileFromPermissions);

chrome.runtime.onInstalled.addListener(async (details) => {
  await reconcileFromPermissions();

  // Show release notes when the extension is updated (not on first install)
  if (details.reason === 'update') {
    await showUpdateChangelog();
  }
});

// Listen to permission changes to keep script registration in sync
chrome.permissions.onAdded.addListener((perms) => {
  const patterns = (perms && perms.origins) ? perms.origins.filter((o) => o.startsWith('http') && !o.includes('*.odoo.com')) : [];
  if (patterns.length) ensureRegisteredForPatterns(patterns);
});

chrome.permissions.onRemoved.addListener((perms) => {
  const patterns = (perms && perms.origins) ? perms.origins.filter((o) => o.startsWith('http') && !o.includes('*.odoo.com')) : [];
  if (patterns.length) removePatterns(patterns);
});


