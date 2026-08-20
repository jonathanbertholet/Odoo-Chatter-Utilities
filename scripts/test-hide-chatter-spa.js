/**
 * Focused regression checks for the SPA hide-chatter fix (no Chrome runtime required).
 * Run: node scripts/test-hide-chatter-spa.js
 */
'use strict';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
}

// --- getRecordKey (mirrors content.js; excludes search) ---
function getRecordKey(loc) {
  return loc.pathname + loc.hash;
}

console.log('getRecordKey');
assert(
  getRecordKey({ pathname: '/odoo/purchase.order/42', hash: '', search: '?debug=1' }) ===
    '/odoo/purchase.order/42',
  'ignores search/debug param churn'
);
assert(
  getRecordKey({ pathname: '/odoo/purchase.order/42', hash: '', search: '' }) !==
    getRecordKey({ pathname: '/odoo/purchase.order/43', hash: '', search: '' }),
  'different records produce different keys'
);
assert(
  getRecordKey({ pathname: '/web', hash: '#id=1&model=sale.order', search: '' }) !==
    getRecordKey({ pathname: '/web', hash: '#id=2&model=sale.order', search: '' }),
  'hash-router record changes produce different keys'
);

// --- Deferred insertToggleButton guard (mirrors fixed condition) ---
function shouldBailDeferredSetup({ topbarEl, chatterConnected, currentRail, rail }) {
  // Mirror content.js if-condition; coerce so null from (currentRail && ...) counts as "do not bail"
  return Boolean(!topbarEl || !chatterConnected || (currentRail && currentRail !== rail));
}

const railA = { id: 'a' };
const railB = { id: 'b' };

console.log('insertToggleButton deferred guard');
assert(
  shouldBailDeferredSetup({
    topbarEl: { ok: true },
    chatterConnected: true,
    currentRail: null,
    rail: railA
  }) === false,
  'allows setup when rail is still detached (currentRail null) — the SPA path'
);
assert(
  shouldBailDeferredSetup({
    topbarEl: { ok: true },
    chatterConnected: true,
    currentRail: railA,
    rail: railA
  }) === false,
  'allows setup when currentRail is the same instance'
);
assert(
  shouldBailDeferredSetup({
    topbarEl: { ok: true },
    chatterConnected: true,
    currentRail: railB,
    rail: railA
  }) === true,
  'bails when a different rail was registered'
);
assert(
  shouldBailDeferredSetup({
    topbarEl: null,
    chatterConnected: true,
    currentRail: null,
    rail: railA
  }) === true,
  'bails when topbar never appeared'
);
assert(
  shouldBailDeferredSetup({
    topbarEl: { ok: true },
    chatterConnected: false,
    currentRail: null,
    rail: railA
  }) === true,
  'bails when chatter was disconnected'
);

// Old buggy guard: getChatterRail() !== rail with null currentRail always bailed
function oldBuggyGuard({ topbarEl, currentRail, rail }) {
  return !topbarEl || currentRail !== rail;
}
assert(
  oldBuggyGuard({ topbarEl: { ok: true }, currentRail: null, rail: railA }) === true,
  'documents old bug: null !== rail always skipped initialize()'
);

// --- Record-key re-apply decision ---
function shouldReapplyHideDefault(railRecordKey, nextKey) {
  return railRecordKey !== nextKey;
}

console.log('syncLayoutModeIfChanged record-key branch');
assert(
  shouldReapplyHideDefault('/odoo/po/1', '/odoo/po/2') === true,
  're-applies hideChatter when record changes'
);
assert(
  shouldReapplyHideDefault('/odoo/po/1', '/odoo/po/1') === false,
  'preserves fold state on same-record DOM mutations'
);
assert(
  shouldReapplyHideDefault(undefined, '/odoo/po/1') === true,
  're-applies when stamp missing (recovery after skipped setup)'
);

// --- Source presence checks ---
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'content.js'), 'utf8');

console.log('content.js patch presence');
assert(src.includes('function getRecordKey()'), 'defines getRecordKey');
assert(src.includes('rail.__recordKey = getRecordKey()'), 'stamps __recordKey in setupChatterRail');
assert(src.includes('rail.__recordKey !== recordKey'), 'checks __recordKey in syncLayoutModeIfChanged');
assert(
  src.includes('(currentRail && currentRail !== rail)'),
  'uses fixed deferred guard (allows null currentRail)'
);
assert(src.includes("addEventListener('hashchange', reinit)"), 'listens for hashchange');
assert(
  !src.includes('if (!topbarEl || this.getChatterRail() !== rail) return;'),
  'old unreachable guard removed'
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
