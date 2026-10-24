Release notes :

V2.1.0 — Reliability rewrite for Odoo 17–19
- Rebuild chatter control around per-panel lifecycle ownership for Odoo 17–19; Odoo 16 is out of scope
- Follow app/form open and close, dialogs, delayed topbars, native layout changes and replacement nodes without duplicate controls or reset loops (#1, #9)
- Preserve native invoice/PDF/bottom layouts and specialized Audit/Documents widths; leave Studio controls inactive (#3, #6)
- Stop synthetic resize events from closing analytic-distribution dropdowns (#7)
- Refresh folded quick actions when native access rights or available actions change, using Odoo's own handlers
- Keep drag width synchronous, respect RTL, and restore state after canceled/interrupted drags
- Read Odoo's actual debug bootstrap; preserve assets/tests modes, clear server debug with debug=0 on explicit off, and guard reload conflicts (#4)
- Clear inherited debug on excluded public Help and My Databases routes, including localized URLs (#2, #8)
- Reconcile custom grants and stop already injected scripts on revocation (#5)
- Serialize recents/pins updates so tabs and popups cannot overwrite one another; retain search and report storage failures
- Preserve native support forms, menus and listeners; remove support enhancements cleanly when disabled
- Keep toolbar buttons at their natural height with a compact chevron; remove the purple strip from the folded rail while retaining drag-to-open
- Add 89 passing DOM/Chrome-API regression cases; signed-in Odoo and real browser layout have not been exercised

Rewrite details:
- Replace the global chatter manager with a controller for each mounted panel and form-scoped state, including independent dialog handling
- Centralize URL identity, draft-to-saved transitions, debug normalization and host-permission matching in shared.js
- Load settings before mounting controls, then apply storage events synchronously with revision guards for stale reads
- Give controls, drags, observers and support enhancements explicit cleanup; suspend work on pagehide and resume on pageshow
- Filter extension-owned DOM mutations and scope CSS to managed layouts, retaining Odoo's native nodes, classes and action handlers
- Move concurrent recents/pins updates and debug reload protection into serialized service-worker operations
- Read only public Odoo bootstrap scalars in MAIN world, targeting the sending document rather than whichever page currently occupies the tab
- Add an asynchronous Chrome-API/jsdom harness covering lifecycle transitions, races, failures and teardown; no runtime npm dependencies or build step

See docs/reliability-review.md for the full issue mapping, Odoo source references and validation limits. The GitHub release is separate from publication to the Chrome Web Store.

V2.0.3
- Fix chevron missing in folded mode after native below-chatter detection
- Fix drag-to-unfold snapping closed immediately (layout refresh no longer resets fold state)
- Layout sync only re-inits rail when Odoo switches between side-aside and below placement

V2.0.2
- Extension stays passive when Odoo natively stacks chatter below the form (narrow windows, COMBO, invoice PDF layouts)
- Toggle, chevron, and resize handle no longer appear when Odoo uses BOTTOM_CHATTER instead of side-aside placement
- Layout re-syncs automatically on viewport resize when Odoo flips between side and below chatter

V2.0
- Chatter toggle moved into the Odoo chatter top bar
- Drag handle to resize form/chatter split; auto-folds when too narrow
- Quick-action icons when chatter is folded (message, note, WhatsApp, activity)
- Stretch form to full width when folded or when chatter is displayed below
- More reliable chatter detection across Odoo views and SPA navigation
- Custom Odoo domains via optional host permissions
- Chevron hidden when chatter is displayed below
- Update changelog tab on extension update

V1.4.1 
- Form view list view width fixed. 

V1.4.0
- Pin pages to the popup & drag to reorganize
- Search through your recently visited links 
- Choose how large the chatter should be on screen! 
- Hide / unhide settings menu
- General extension menu redesign

Fixed : 
- Chatter was narrower than expected when the extension was present
- Major code cleanup : structure, comments, removed some deprecated items (still underway!)

V1.3.2
- Shortcut fix for linux computers : now Alt+Shift+C
- Toggle to show domain in recently opened list
 
V1.3.1 
- Improved toggle descriptions : debug mode conflicts with Odoo Debug extension. 

V1.3
- Rewrite of chatter detection code, for toggle display reliability improvements
- Excluded a few other links from the permanent debug to avoid issues
- Now not possible to display the chatter below AND toggle the hide by default state of the side chatter
- Added a link for issue reporting

V1.1.1
- Bugfix : /slides/ now stops refreshing continuously
- Optimized DOMs & event listeners, code refactor

V.1.1 
- Recent views feature
- Redesigned control panel
- Stylish support mode

V1.0 Initial release : 
- Display below & Fold/Unfold chatter
- Permanent debug mode
