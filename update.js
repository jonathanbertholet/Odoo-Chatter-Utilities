// update.js — populate version and close the changelog tab
(() => {
  const versionEl = document.getElementById('version');
  const closeBtn = document.getElementById('closeBtn');

  // Show the installed extension version from the manifest
  if (versionEl) {
    versionEl.textContent = `Version ${chrome.runtime.getManifest().version}`;
  }

  // Close this tab when the user is done reading the changelog
  if (closeBtn) {
    closeBtn.addEventListener('click', () => window.close());
  }
})();
