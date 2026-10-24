# Reliability review — 2.1.0

Reviewed the entire shipped extension: content script, service worker, popup, shared URL helpers, styles, manifest, update page and support enhancement. Scope is Odoo 17–19. Odoo 16 is intentionally excluded. The implementation is a refactor of the existing extension, retaining its settings keys and locally saved pins/history.

## Findings addressed

| Finding | Resulting behavior |
| --- | --- |
| Global chatter state and stale DOM references | Each live panel has a controller. A WeakMap stores state per form; dialogs remain independent. Removal, reparenting, native hiding, Studio and app changes dispose of controls and listeners. |
| Repeated initialization and mutation/resize loops | Updates are bounded and idempotent. Extension-owned mutations are filtered. Parent ResizeObservers compare widths. No synthetic window resize events are sent. |
| Stale asynchronous width reads | Settings load once before mounting, with revision checks for intervening changes. Drag state is synchronous; cross-tab width events cannot override a live drag. |
| Fold state reset by unrelated URL changes | Identity follows the record/action URL rather than debug, company, view type, message highlights or anchors. Changing records reapplies the default; replacing chatter on the same form retains manual state. A draft acquiring its first ID in the same mounted form preserves the opened composer. |
| Native PDF/bottom layout interference | Missing `o-aside` means passive native placement. Forced stacking and width changes require the standard direct sheet/chatter split. Specialized side panels keep their widths. |
| Shortcuts targeting background forms | The active visible dialog owns interaction, even when it has no chatter. Otherwise the focused form owns it. Chrome’s configured command is the sole global toggle shortcut. |
| Stale folded quick actions | Availability follows native button insertion/removal, visibility and disabled/ARIA state. Clicks recheck the current button and delegate once to Odoo. |
| Incomplete drag cleanup | Pointer cancellation, blur, navigation, disappearing panels, layout changes and pagehide restore the starting state and remove global drag handlers. Only completed drags persist widths. RTL and narrow splits are handled. |
| Deleting `debug` did not turn debug off | An explicit off preference sends `debug=0`, clearing the server session. Default off leaves manually enabled debug intact. |
| Debug reloads based only on URL text | The worker reads only bootstrap href/debug/version from the sending document in MAIN world. The content script checks revision and current URL before using the result. Already active assets/tests modes do not need a reload. |
| Reload conflicts survive reinjection | A serialized guard in session storage survives worker/content restarts, pauses repeated attempts and resets on explicit preference changes. Closing the tab clears its guard. |
| Lost recents and pins across tabs/popups | The service worker serializes storage read/modify/write operations. Reorders preserve pins added concurrently. Invalid/corrupt entries are discarded. |
| Revoking a grant left scripts active | Registrations reconcile against current grants and uncovered running tabs receive teardown. Overlapping wildcard and builtin grants remain effective. Future activation after a new grant requires a page refresh. |
| Support styling destroyed native behavior | Native forms and navbar nodes are neither cloned, moved nor replaced. Styles, TOC, observers and extension classes are removable. TOC headings retain native IDs. |
| Popup failures and stale UI | Storage errors restore controls and show status. Search survives storage refreshes; labels render as text. Permission requests start inside the click gesture. Pin drops can move an item to the end. |
| Resource retention | Controllers release observers/listeners, support TOCs release heading references, and pagehide suspends pending work. Teardown restores owned theme values and permits reinjection. |

## Report coverage

All nine reports and their discussion were reviewed, including closed reports. Issues have not been commented on or closed by this work.

| Report | Fix |
| --- | --- |
| [#1 — Toggle reliability](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/1) | Delayed topbars, replacement controls, same-record rerenders, app close/reopen, record defaults and cleanup. |
| [#2 — Help debug errors](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/2) | Localized public Help exclusions also clear inherited debug sessions. |
| [#3 — Studio controls](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/3) | Entering Studio removes extension controls and layout; shortcuts stay inactive there. |
| [#4 — Permanent debug](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/4) | Read actual bootstrap debug, preserve modes and router history, clear sessions explicitly, reject stale responses and guard reload conflicts. |
| [#5 — Custom domains](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/5) | Gesture-bound permission requests, serialized registrations, wildcard/port coverage and live teardown after revocation. |
| [#6 — Invoice preview width](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/6) | Native COMBO/PDF/bottom placement is passive; form overrides require a standard side split. |
| [#7 — Analytic distribution](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/7) | No synthetic resize events or width → resize feedback loop. |
| [#8 — My Databases debug error](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/8) | Exclude public My Databases, including localized/detail routes, and clear inherited debug. |
| [#9 — Audit/Documents folding loop](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/issues/9) | Stable per-panel state, controls outside hidden chatter, native specialized widths, native hidden-state detection and mutation filtering. |

The navigation/rail changes overlap the existing draft [PR #10](https://github.com/jonathanbertholet/Odoo-Chatter-Utilities/pull/10); that PR was used as context and was not modified.

## Odoo contracts used

These integration choices are derived from source inspection. The DOM fixtures model those contracts; they do not execute Odoo’s compiler, OWL renderer or server.

- **Placement and dialogs:** The [17.0 mail form compiler](https://github.com/odoo/odoo/blob/17.0/addons/mail/static/src/views/web/form/form_compiler.js) uses modern chatter wrappers and may render them in dialogs. The [18.0](https://github.com/odoo/odoo/blob/18.0/addons/mail/static/src/chatter/web/form_compiler.js) and [19.0](https://github.com/odoo/odoo/blob/19.0/addons/mail/static/src/chatter/web/form_compiler.js) compilers suppress ordinary form chatter in dialogs. They distinguish side placement, native bottom placement and chatter nested in the sheet beside a PDF preview. The [19.0 renderer](https://github.com/odoo/odoo/blob/19.0/addons/mail/static/src/chatter/web/form_renderer.js) also handles external attachment windows. The extension uses native `o-aside` placement rather than guessing from viewport width.
- **Form geometry:** The [web form compiler](https://github.com/odoo/odoo/blob/19.0/addons/web/static/src/views/form/form_compiler.js) creates the direct sheet/chatter split. Its [styles](https://github.com/odoo/odoo/blob/19.0/addons/web/static/src/views/form/form_controller.scss) own form and preview sizing. Extension overrides are restricted to recognized splits and extension classes; native classes and nodes are retained.
- **Native actions:** [Chatter’s template](https://github.com/odoo/odoo/blob/19.0/addons/mail/static/src/chatter/web/chatter.xml) changes its buttons as thread permissions and search state change. The [native handlers](https://github.com/odoo/odoo/blob/19.0/addons/mail/static/src/chatter/web/chatter_patch.js) handle unsaved records, composer focus and activity dialogs. Quick actions invoke those buttons rather than duplicating their business logic.
- **Dialog/app ownership:** The [dialog template](https://github.com/odoo/odoo/blob/19.0/addons/web/static/src/core/dialog/dialog.xml) marks inactive stacked dialogs. The [action container](https://github.com/odoo/odoo/blob/19.0/addons/web/static/src/webclient/actions/action_container.js) replaces action components. Controllers observe mounts/removals and choose the active dialog without falling through to a background form.
- **Dropdown stability:** [Analytic distribution](https://github.com/odoo/odoo/blob/19.0/addons/analytic/static/src/components/analytic_distribution/analytic_distribution.js) closes its popup on window resize. Extension layout updates never dispatch that event.
- **Routing:** [17.0 routing](https://github.com/odoo/odoo/blob/17.0/addons/web/static/src/core/browser/router_service.js) uses hash parameters. Its [form controller](https://github.com/odoo/odoo/blob/17.0/addons/web/static/src/views/form/form_controller.js) adds the record ID after saving. [19.0 routing](https://github.com/odoo/odoo/blob/19.0/addons/web/static/src/core/browser/router.js) encodes the action stack/record in the path, including the draft `new` marker, and stores router state in history. The extension treats the same-form draft → saved URL transition as the same record. URL correction retains `history.state`. A lightweight URL poll observes SPA changes across Chrome’s isolated worlds without patching Odoo’s history methods.
- **Debug sessions:** [Server debug handling](https://github.com/odoo/odoo/blob/19.0/addons/web/models/ir_http.py) updates the session only when the request includes `debug`. [Web bootstrap](https://github.com/odoo/odoo/blob/19.0/addons/web/views/webclient_templates.xml) emits the current debug string. The worker reads scalar values from that bootstrap, targeting the sender’s document ID; it does not read credentials or component internals.
- **Specialized panels:** The local Odoo enterprise checkout’s Documents right-panel template and account report/audit templates were also inspected. Documents nests details with chatter and owns its panel width; audit can retain a natively hidden container. The extension preserves those widths and respects native hiding. These private source files are not copied into this repository.

Chrome references: [isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#isolated_world), [match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns), [permission gestures](https://developer.chrome.com/docs/extensions/reference/api/permissions#implement_optional_permissions), and [script unregistration](https://developer.chrome.com/docs/extensions/reference/api/scripting#examples). Unregistering a script affects future injection; explicit teardown handles documents already running it.

## Validation and limits

**89 regression cases pass** on Node.js 24 with jsdom 30.1.3. The suite executes the real extension scripts with asynchronous storage, worker messaging, permission events and a shared service-worker queue. It covers the nine reports, opening/closing apps and forms, dialogs, delayed controls, native layout transitions, quick-action permission changes, drag cancellation, debug races, concurrent storage updates, revocation and reversible support styling. JavaScript syntax, manifest/HTML asset references and Git whitespace checks pass.

No browser automation, authenticated Odoo interaction or live Odoo server test was performed. jsdom does not calculate real flex layout, pointer capture, scrolling, browser permission prompts or OWL rendering. Actual preview dimensions, scroll/focus behavior, enterprise variants and third-party customizations therefore remain integration limits. Version 2.1 has not yet been released to the Chrome Web Store; a passing fixture suite is not a claim that every customized Odoo installation has been exercised.
