# AGENTS.md

## Cursor Cloud specific instructions

### What this is
This repository is **Odoo Chatter Utilities**, a vanilla JavaScript **Chrome extension (Manifest V3)**. There is no build system, package manager, bundler, transpiler, dependency, or automated test suite. The source files (`manifest.json`, `background.js`, `content.js`, `popup.html`/`popup.js`/`popup.css`, `update.html`/`update.js`, `styles.css`) are loaded directly by Chrome.

Because there are no dependencies, the startup update script is intentionally a no-op. Do not add `package.json`/`node_modules` unless the task explicitly introduces tooling (`.gitignore` already anticipates this as optional/future).

### Lint / test / build / run
- **Lint:** there is no linter configured. As a lightweight syntax check, run `node --check <file>.js` on the JS files (all of `background.js`, `content.js`, `popup.js`, `update.js` should pass).
- **Test:** there are no automated tests.
- **Build:** none. The extension runs unbuilt.
- **Run:** load the repository root as an unpacked extension in Chrome:
  1. Open `chrome://extensions/`
  2. Enable **Developer mode** (top-right toggle)
  3. Click **Load unpacked** and select the repository root (`/workspace`)
  4. Open the extension popup from the toolbar (puzzle-piece menu) to use the UI.

### Non-obvious caveats
- **Popup UI is testable without Odoo.** The popup Settings toggles, Pins, and Recent Views persist via `chrome.storage`, so the core popup flow can be exercised standalone.
- **Content-script features require a live Odoo page.** `content.js` only injects on `*://*.odoo.com/*` (plus any user-whitelisted domains), so testing chatter hide/resize/debug behavior end-to-end requires signing into an Odoo instance.
- **After editing extension files, reload the extension** from `chrome://extensions/` (click the reload icon). Chrome does not hot-reload unpacked extensions; the service worker (`background.js`) and content scripts pick up changes only after a reload (and content scripts additionally require reloading the target Odoo tab).
