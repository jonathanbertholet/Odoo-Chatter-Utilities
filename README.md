# Odoo Chatter Utilities

A Chrome extension for folding and resizing Odoo chatter, opening native chatter actions, keeping debug enabled, and saving pins and recent records.

Version 2.1 targets **Odoo 17, 18 and 19**, with Chrome 106 or later. Odoo 16 compatibility is outside this release’s scope.

## Chatter

- Fold side chatter with its chevron or the configured Chrome shortcut: **⌘⇧X** on macOS, **Alt+Shift+C** on Windows/Linux.
- Drag the divider to resize. Drag below the minimum width to fold; drag from the folded rail to reopen. Canceling a drag restores the previous width.
- Use the folded rail to send a message, log a note, open WhatsApp, or schedule an activity. Actions appear only when Odoo makes them available and invoke Odoo’s own handlers.
- Choose **Hide chatter by default**, **Display chatter below**, or **Stretch form when folded** in the popup.

Controls follow app switches, record navigation, dialogs, delayed rendering, and replacement chatter nodes. Studio suppresses the controls. Native bottom chatter and invoice/PDF layouts keep their native placement and sizing. Audit and Documents keep their own panel widths; resizing and forced stacking apply to standard form splits.

Hide-by-default applies to side chatter when opening a different record. Opening chatter manually survives rerenders on that record. Choosing Display chatter below retains the saved side visibility preference.

## Debug, pins and recent records

Permanent debug reads Odoo’s running debug state. It preserves assets/tests modes across SPA navigation and avoids reloading an already enabled session. Switching the preference off explicitly clears Odoo’s server debug session with `debug=0`; leaving the default off preserves debug enabled elsewhere.

Automatic debug is excluded from public Odoo Help, My Databases, slides, Website and Knowledge routes. Repeated conflicting reloads pause until the preference is toggled again.

Pin any HTTP(S) page from the popup and drag pins to reorder. Recent records are searchable and capped at 50. Both lists update through the service worker so concurrent tabs do not overwrite one another. Record history and pins stay in Chrome’s local extension storage; preferences use Chrome sync storage. There are no analytics or remote tracking requests.

The optional employee support-page styling adds a table of contents while retaining native menus, forms and event handlers. Turning it off removes the enhancement.

## Installation and custom domains

Install the current store version from the [Chrome Web Store](https://chromewebstore.google.com/detail/odoo-chatter-utilities/jnlkgngeodbbhjhfifdkameknejjgkdl), or download the extension ZIP from the [latest GitHub release](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/releases/latest). For manual installation, extract the ZIP first, or use this checkout:

1. Open `chrome://extensions/` and enable Developer mode.
2. Choose **Load unpacked** and select the extracted extension folder or this repository folder. If already loaded, use its **Reload** button.
3. Refresh the Odoo page.

Odoo domains are included by default. For a custom domain, open its Odoo page, expand the popup’s Settings, choose **Add Current Site**, grant access, and refresh the page. Removing a custom grant stops the extension in already open tabs unless another grant still covers them.

## Development and checks

The extension has no build step or runtime npm dependencies. `shared.js` provides URL contracts to the content script, popup and service worker. Each mounted chatter has its own controller; all listeners, observers and drag handlers have explicit cleanup.

The regression suite executes the shipped JavaScript in jsdom with asynchronous Chrome API doubles. Install the test dependency outside the extension:

```sh
npm install --prefix /tmp/chatter-regression --no-audit --no-fund --ignore-scripts jsdom@30.1.3
NODE_PATH=/tmp/chatter-regression/node_modules node --test scripts/*.test.cjs
```

Use Node.js 24 or later. **89 tests pass** for lifecycle transitions, native layouts, dialog selection, access-right changes, drag cancellation, debug/session handling, storage races, popup failures and permission revocation. JavaScript syntax and packaged asset references are also checked. These checks do not run a browser or a signed-in Odoo server, and do not establish pixel-level layout compatibility with every customization.

See the [reliability review](docs/reliability-review.md) for findings, the nine reported issues, Odoo source references and validation limits. GitHub reports remain unchanged. Version 2.1 has not yet been released to the Chrome Web Store.

- [Repository](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities)
- [Bug reports](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues)
- [Release notes](releasenotes.md)
