(function() {
  // Configuration constants
  const CONFIG = {
    DEBOUNCE_INTERVAL: 250,   // Delay for debouncing
    THROTTLE_INTERVAL: 150,   // Delay for throttling
    SUPPORT_NAVBAR_SCROLL_THRESHOLD: 20,  // Scroll threshold for support navbar
    RECENT_VIEWS_LIMIT: 50,   // Maximum number of recent views stored
    DEBUG_MODE_CHECK_INTERVAL: 10000, // Interval to check path changes for debug mode mismatch
    CHATTER_WIDTH: {
      DEFAULT: 530,
      MIN_VISIBLE: 380,
      FOLD_BELOW: 380,
      MIN_FORM: 360,
      MAX_RATIO: 0.75,
      LEGACY_RATIOS: { standard: 0.335, medium: 0.415, large: 0.5 },
    },
  };

  // Chatter detection selectors and scoring helpers
  const CHATTER = {
    CONTAINER_SELECTORS: [
      '.o-mail-ChatterContainer',
      '.o-mail-Form-chatter',
      '.o_mail_chattercontainer',
      '.oe_chatter',
    ],
    INNER_SELECTORS: [
      '.o-mail-Chatter',
      '.o-mail-Chatter-topbar',
      '.oe_chatter',
    ],
    OBSERVER_SELECTORS: [
      '.o-mail-ChatterContainer',
      '.o-mail-Form-chatter',
      '.o_mail_chattercontainer',
      '.o-mail-Chatter',
      '.o-mail-Chatter-topbar',
      '.o_form_view',
      '.oe_chatter',
    ],
    EXCLUDE_ANCESTORS: [
      '.o_Studio_ChatterContainer',
      '.o_studio_view_editor',
    ],
  };

  /**
   * Returns true when a DOM node is a chatter container or hosts chatter markup.
   * @param {Node} node
   * @returns {boolean}
   */
  function nodeMatchesChatter(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return CHATTER.OBSERVER_SELECTORS.some((selector) => node.matches?.(selector));
  }

  /**
   * Returns true when a node is chatter markup or contains it (for DOM insertions).
   * @param {Node} node
   * @returns {boolean}
   */
  function nodeAffectsChatter(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (nodeMatchesChatter(node)) return true;
    return CHATTER.OBSERVER_SELECTORS.some((selector) => node.querySelector?.(selector));
  }

  /**
   * Returns true when a class change can affect chatter mounting/layout.
   * @param {Element} node
   * @returns {boolean}
   */
  function nodeClassChangeAffectsChatter(node) {
    return node.matches?.([
      '.o-mail-ChatterContainer',
      '.o-mail-Form-chatter',
      '.o_mail_chattercontainer',
      '.o-mail-Chatter',
      '.o_form_view',
      '.o_content',
    ].join(', '));
  }

  // Tracks in-flight waitForChatter observers to avoid stacking them on list views
  let pendingWaitForChatter = null;
  // Avoid attaching duplicate support-page scroll listeners
  let supportNavbarScrollBound = false;
  /**
   * Debounce a function to prevent it from being called too quickly in succession.
   * @param {Function} func 
   * @param {number} wait 
   * @returns {Function}
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  // Utility: Throttle function
  /**
   * Throttle a function to ensure it doesn't get called more often than the limit specifies.
   * @param {Function} func 
   * @param {number} limit 
   * @returns {Function}
   */
  function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Utility: Chrome Storage Helpers (Promisified)
  /**
   * Gets a single setting from chrome storage.
   * @param {string} key - The storage key.
   * @param {('sync'|'local')} [area='sync'] - The chrome storage area.
   * @returns {Promise<any>}
   */
  function getSetting(key, area = 'sync') {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(key, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result[key]);
      });
    });
  }

  /**
   * Gets multiple settings from chrome storage.
   * @param {string[]} keys - The storage keys.
   * @param {('sync'|'local')} [area='sync'] - The chrome storage area.
   * @returns {Promise<Object>}
   */
  function getSettings(keys, area = 'sync') {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(keys, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });
  }

  /**
   * Sets a single setting in chrome storage.
   * @param {string} key - The storage key.
   * @param {any} value - The value to set.
   * @param {('sync'|'local')} [area='sync'] - The chrome storage area.
   * @returns {Promise<void>}
   */
  function setSetting(key, value, area = 'sync') {
    return new Promise((resolve, reject) => {
      chrome.storage[area].set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  // Utility: Trigger resize event
  /**
   * Triggers a window resize event.
   */
  function triggerResize() {
    window.dispatchEvent(new Event('resize'));
  }

  // Utility: Wait for element helper
  /**
   * Waits for an element matching the selector to appear under the given root.
   * Resolves early if the element already exists. Times out after the provided ms.
   * @param {string} selector
   * @param {ParentNode} [root=document]
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selector, root = document, timeoutMs = 3000) {
    return new Promise(resolve => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const found = root.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

      const timeout = setTimeout(() => {
        try { observer.disconnect(); } catch (e) {}
        resolve(null);
      }, timeoutMs);
    });
  }

  // Feature: Recent Views
  /**
   * Tracks the most recent view if on a form view. Inserts new views at the start of the list
   * and removes duplicates, keeping only the most recent 50.
   */
  function trackRecentView() {
    const formView = document.querySelector('.o_form_view');
    if (!formView) return;

    const title = document.title.split(' - ').slice(0, -1).join(' - ') || document.title;
    const url = window.location.href;

    getSetting('recentViews', 'local').then(recentViews => {
      recentViews = recentViews || [];

      if (recentViews[0]?.url === url) return;

      const newView = { title, url, timestamp: Date.now() };
      recentViews = recentViews.filter(view => view.url !== url);
      recentViews.unshift(newView);
      recentViews = recentViews.slice(0, CONFIG.RECENT_VIEWS_LIMIT);

      setSetting('recentViews', recentViews, 'local').catch(console.error);
    }).catch(console.error);
  }

  const debouncedTrackRecentView = debounce(trackRecentView, CONFIG.DEBOUNCE_INTERVAL);

  // Material-style icons used on the collapsed chatter rail
  const CHATTER_ACTION_ICONS = {
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v2z"/></svg>',
    activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>',
  };

  // Known chatter topbar actions mapped to native Odoo buttons
  const CHATTER_ACTION_DEFS = [
    { id: 'message', label: 'Send message', selector: '.o-mail-Chatter-sendMessage', icon: CHATTER_ACTION_ICONS.mail, keepCollapsed: false },
    { id: 'note', label: 'Log note', selector: '.o-mail-Chatter-logNote', icon: CHATTER_ACTION_ICONS.note, keepCollapsed: false },
    { id: 'whatsapp', label: 'WhatsApp', selector: 'button[data-hotkey="shift+w"]', icon: CHATTER_ACTION_ICONS.whatsapp, keepCollapsed: false },
    { id: 'activity', label: 'Schedule activity', selector: '.o-mail-Chatter-activity', icon: CHATTER_ACTION_ICONS.activity, keepCollapsed: true },
  ];

  // Feature: Chatter Management
  /**
   * Chatter Manager object to handle all chatter related functionalities.
   */
  const chatterManager = {
    /**
     * Search roots ordered from the most specific active form area to the whole page.
     * @returns {ParentNode[]}
     */
    getChatterSearchRoots: function() {
      const roots = [];
      const addRoot = (root) => {
        if (root && !roots.includes(root)) roots.push(root);
      };

      addRoot(document.querySelector('.o_action_manager .o_form_view'));
      addRoot(document.querySelector('.o_form_view'));
      addRoot(document.querySelector('.o_action_manager .o_content'));
      addRoot(document.querySelector('.o_content'));
      addRoot(document.querySelector('.o_action_manager'));
      addRoot(document.querySelector('.o_web_client'));
      addRoot(document);

      return roots;
    },

    /**
     * Normalizes mixed inner/container nodes to the outer chatter shell.
     * @param {HTMLElement} element
     * @returns {HTMLElement|null}
     */
    normalizeChatterContainer: function(element) {
      if (!element) return null;

      if (element.matches('.o-mail-ChatterContainer, .o-mail-Form-chatter, .o_mail_chattercontainer, .oe_chatter')) {
        return element;
      }

      return element.closest('.o-mail-ChatterContainer, .o-mail-Form-chatter, .o_mail_chattercontainer, .o-aside')
        || element.closest('.oe_chatter')
        || null;
    },

    /**
     * Validates that an element is a usable chatter target for the extension.
     * @param {HTMLElement} element
     * @returns {boolean}
     */
    isValidChatterContainer: function(element) {
      if (!element?.isConnected) return false;

      if (CHATTER.EXCLUDE_ANCESTORS.some((selector) => element.closest(selector))) {
        return false;
      }

      const hasInnerChatter = element.matches('.o-mail-Chatter, .oe_chatter')
        || element.querySelector(CHATTER.INNER_SELECTORS.join(', '));
      const hasTopbarActions = element.querySelector('.o-mail-Chatter-topbar, .o-mail-Chatter-sendMessage, .o-mail-Chatter-logNote');

      return !!(hasInnerChatter || hasTopbarActions || element.matches('.oe_chatter'));
    },

    /**
     * Scores chatter candidates so form-view aside panels win over incidental chatters.
     * @param {HTMLElement} element
     * @returns {number}
     */
    scoreChatterContainer: function(element) {
      let score = 0;

      if (element.closest('.o_form_view')) score += 100;
      if (element.classList.contains('o-mail-Form-chatter')) score += 50;
      if (element.querySelector('.o-mail-Chatter-topbar')) score += 40;
      if (element.querySelector('.o-mail-Chatter-sendMessage, .o-mail-Chatter-logNote')) score += 30;
      if (element.classList.contains('o-aside')) score += 20;

      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) score += 25;

      if (element.closest('.o_account_report, .o_bank_reconciliation_container, .o_document_view')) {
        score -= 40;
      }
      if (element.classList.contains('o_account_report_chatter_hidden')) {
        score -= 80;
      }

      return score;
    },

    /**
     * Collects and ranks chatter containers within scoped search roots.
     * @returns {HTMLElement[]}
     */
    findChatterContainers: function() {
      const seen = new Set();
      const candidates = [];

      const registerCandidate = (rawElement) => {
        const container = this.normalizeChatterContainer(rawElement);
        if (!container || seen.has(container)) return;
        seen.add(container);
        if (!this.isValidChatterContainer(container)) return;
        candidates.push(container);
      };

      this.getChatterSearchRoots().forEach((root) => {
        CHATTER.CONTAINER_SELECTORS.forEach((selector) => {
          root.querySelectorAll(selector).forEach(registerCandidate);
        });
        root.querySelectorAll('.o-mail-Chatter').forEach(registerCandidate);
      });

      return candidates.sort((a, b) => this.scoreChatterContainer(b) - this.scoreChatterContainer(a));
    },

    /**
     * Checks if the page is relevant by ensuring the chatter container exists.
     * @returns {boolean}
     */
    isRelevantPage: function() {
      return !!this.getChatterContainer();
    },

    /**
     * Retrieves the best chatter container across Odoo UI variants and modules.
     * @returns {HTMLElement|null}
     */
    getChatterContainer: function() {
      // Fast path: standard form layout keeps chatter beside the sheet
      const formRow = document.querySelector('.o_action_manager .o_content > div, .o_content > div');
      if (formRow) {
        for (const selector of CHATTER.CONTAINER_SELECTORS) {
          const candidate = formRow.querySelector(selector);
          if (candidate && this.isValidChatterContainer(candidate)) {
            return candidate;
          }
        }
      }

      return this.findChatterContainers()[0] || null;
    },

    /**
     * Waits for a ranked chatter container to appear after SPA navigation or lazy render.
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<HTMLElement|null>}
     */
    waitForChatter: function(timeoutMs = 5000) {
      const existing = this.getChatterContainer();
      if (existing) return Promise.resolve(existing);
      if (pendingWaitForChatter) return pendingWaitForChatter;

      pendingWaitForChatter = new Promise((resolve) => {
        const observerRoot = document.querySelector('.o_action_manager, .o_web_client') || document.body;
        let settled = false;

        const finish = (container) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timeout);
          pendingWaitForChatter = null;
          resolve(container);
        };

        const checkForChatter = throttle(() => {
          const found = this.getChatterContainer();
          if (found) finish(found);
        }, CONFIG.THROTTLE_INTERVAL);

        const observer = new MutationObserver(checkForChatter);

        observer.observe(observerRoot, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class'],
        });

        const timeout = setTimeout(() => {
          finish(this.getChatterContainer());
        }, timeoutMs);
      });

      return pendingWaitForChatter;
    },

    /**
     * Keeps the rail bound to the current chatter, re-creating it when Odoo swaps views.
     * @param {HTMLElement} chatterContainer
     */
    syncChatterRail: function(chatterContainer) {
      const formContainer = this.getFormContainer(chatterContainer);
      if (!formContainer) return;

      const rail = this.getChatterRail();
      const toggleButton = rail ? this.getRailToggle(rail) : null;
      const isBoundToCurrentChatter = rail
        && rail.__chatterContainer === chatterContainer
        && rail.__formContainer === formContainer
        && toggleButton?.isConnected;

      if (isBoundToCurrentChatter) {
        return;
      }

      if (rail) {
        this.removeToggleButton();
      }

      this.insertToggleButton(formContainer, chatterContainer);
    },

    /**
     * Resolves the best parent container to host the toggle and layout classes.
     * Falls back gracefully if the typical container is not found.
     * @param {HTMLElement} chatterContainer
     * @returns {HTMLElement|null}
     */
    getFormContainer: function(chatterContainer) {
      if (!chatterContainer) return null;
      // Preferred: the direct wrapper inside the content area
      let formContainer = chatterContainer.closest('.o_content > div');
      if (formContainer) return formContainer;

      // Alternative: the content area itself
      formContainer = chatterContainer.closest('.o_content');
      if (formContainer) return formContainer;

      // As a last resort, use the immediate parent so we can still insert the toggle
      return chatterContainer.parentElement || null;
    },

    /**
     * Finds the chatter topbar where action buttons (search, attach, followers) live.
     * @param {HTMLElement} chatterContainer
     * @returns {HTMLElement|null}
     */
    getChatterTopbar: function(chatterContainer) {
      if (!chatterContainer) return null;
      return chatterContainer.querySelector('.o-mail-Chatter-topbar');
    },

    /**
     * Returns the extension's collapsed rail wrapper, if present.
     * @returns {HTMLElement|null}
     */
    getChatterRail: function() {
      return document.querySelector('.chatter-collapsed-rail');
    },

    /**
     * Lists chatter actions currently available in the Odoo topbar.
     * @param {HTMLElement} chatterContainer
     * @returns {Array}
     */
    getAvailableChatterActions: function(chatterContainer) {
      const topbar = this.getChatterTopbar(chatterContainer);
      if (!topbar) return [];

      // Match native buttons even while the panel is folded (display:none)
      return CHATTER_ACTION_DEFS.filter((def) => {
        const button = topbar.querySelector(def.selector);
        return button && !button.disabled;
      });
    },

    /**
     * Builds the collapsed rail: chevron toggle plus vertical quick-action icons.
     * @returns {{ rail: HTMLElement, toggleButton: HTMLButtonElement, actionsContainer: HTMLElement }}
     */
    createChatterRail: function() {
      const rail = document.createElement('div');
      rail.className = 'chatter-collapsed-rail';

      const toggleButton = document.createElement('button');
      toggleButton.className = 'chatter-toggle btn btn-link text-action topbar-mode';
      toggleButton.innerHTML = `
        <svg class="chatter-toggle-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M11 14L7 10L11 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      toggleButton.title = 'Toggle Chatter';
      toggleButton.setAttribute('aria-label', 'Toggle Chatter');

      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'chatter-collapsed-actions';
      actionsContainer.setAttribute('role', 'toolbar');
      actionsContainer.setAttribute('aria-label', 'Chatter quick actions');

      // Icon column stays grouped so the drag grip can sit beside it when folded
      const railBody = document.createElement('div');
      railBody.className = 'chatter-rail-body';
      railBody.appendChild(toggleButton);
      railBody.appendChild(actionsContainer);
      rail.appendChild(railBody);

      // Keep a stable reference — the toggle moves between rail and topbar
      rail.__toggleButton = toggleButton;
      rail.__railBody = railBody;

      return { rail, toggleButton, actionsContainer, railBody };
    },

    /**
     * Returns the toggle button associated with a chatter rail.
     * @param {HTMLElement} rail
     * @returns {HTMLButtonElement|null}
     */
    getRailToggle: function(rail) {
      return rail?.__toggleButton || null;
    },

    /**
     * Rebuilds collapsed quick-action icons from the live Odoo topbar buttons.
     * @param {HTMLElement} rail
     * @param {HTMLElement} chatterContainer
     */
    refreshCollapsedActions: function(rail, chatterContainer) {
      const actionsContainer = rail.querySelector('.chatter-collapsed-actions');
      if (!actionsContainer) return;

      actionsContainer.innerHTML = '';
      this.getAvailableChatterActions(chatterContainer).forEach((def) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chatter-collapsed-action';
        button.dataset.chatterAction = def.id;
        button.title = def.label;
        button.setAttribute('aria-label', def.label);
        button.innerHTML = def.icon;
        actionsContainer.appendChild(button);
      });
    },

    /**
     * Applies optional full-width form layout when stretch is enabled.
     * Side layout: only when chatter is folded. Below layout: always when stretch is on.
     * @param {HTMLElement} formContainer
     * @param {boolean} isChatterHidden
     * @param {boolean} stretchFormWhenFolded
     */
    applyFormStretch: function(formContainer, isChatterHidden, stretchFormWhenFolded) {
      if (!formContainer) return;

      const isVerticalLayout = formContainer.classList.contains('vertical-layout');
      const shouldStretch = !!stretchFormWhenFolded && (isVerticalLayout || !!isChatterHidden);

      formContainer.classList.toggle('stretch-form', shouldStretch);
    },

    /**
     * Converts legacy preset values or stored pixels into a chatter width.
     * @param {number|string|undefined} value
     * @returns {number}
     */
    resolveStoredChatterWidth: function(value) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value);
      }

      if (typeof value === 'string') {
        const ratio = CONFIG.CHATTER_WIDTH.LEGACY_RATIOS[value];
        if (ratio) return Math.round(window.innerWidth * ratio);
      }

      return CONFIG.CHATTER_WIDTH.DEFAULT;
    },

    /**
     * Returns resize limits for the current form/chatter split.
     * @param {HTMLElement} formContainer
     * @returns {{ minVisible: number, max: number, foldBelow: number }}
     */
    getChatterWidthLimits: function(formContainer) {
      const containerWidth = formContainer?.clientWidth || window.innerWidth;
      const maxByForm = Math.max(
        CONFIG.CHATTER_WIDTH.MIN_VISIBLE,
        containerWidth - CONFIG.CHATTER_WIDTH.MIN_FORM
      );
      const maxByRatio = Math.round(containerWidth * CONFIG.CHATTER_WIDTH.MAX_RATIO);

      return {
        minVisible: CONFIG.CHATTER_WIDTH.MIN_VISIBLE,
        max: Math.min(maxByForm, maxByRatio),
        foldBelow: CONFIG.CHATTER_WIDTH.FOLD_BELOW,
      };
    },

    /**
     * Persists the user's chatter width in pixels.
     * @param {number} px
     */
    persistChatterWidth: function(px) {
      const rounded = Math.round(px);
      if (!Number.isFinite(rounded) || rounded <= 0) return;
      setSetting('chatterWidth', rounded).catch(console.error);
    },

    /**
     * Applies a pixel width to the aside chatter panel.
     * @param {number} px
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     */
    applyChatterWidthPx: function(px, formContainer, chatterContainer) {
      if (!chatterContainer || !formContainer) return;
      if (formContainer.classList.contains('vertical-layout')) return;
      if (chatterContainer.classList.contains('hidden')) return;

      const limits = this.getChatterWidthLimits(formContainer);
      const clamped = Math.min(limits.max, Math.max(limits.minVisible, px));

      chatterContainer.classList.add('chatter-width-managed');
      chatterContainer.classList.remove('standard', 'medium', 'large');
      chatterContainer.style.setProperty('--chatter-panel-width', `${clamped}px`);
      formContainer.style.setProperty('--chatter-panel-width', `${clamped}px`);
      this.syncResizeHandlePlacement(formContainer, chatterContainer);
      triggerResize();
    },

    /**
     * Returns the shared resize handle, wherever it is currently mounted.
     * @param {HTMLElement} formContainer
     * @returns {HTMLElement|null}
     */
    getResizeHandle: function(formContainer) {
      const rail = this.getChatterRail();
      return formContainer?.querySelector('.chatter-resize-handle')
        || rail?.querySelector('.chatter-resize-handle')
        || null;
    },

    /**
     * Keeps the drag handle on the split when open, or inside the collapsed rail when folded.
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     */
    syncResizeHandlePlacement: function(formContainer, chatterContainer) {
      const handle = this.getResizeHandle(formContainer);
      if (!handle || !formContainer) return;

      const rail = this.getChatterRail();
      const isVertical = formContainer.classList.contains('vertical-layout');
      const isHidden = chatterContainer?.classList.contains('hidden');

      if (isVertical) {
        handle.style.display = 'none';
        return;
      }

      handle.style.display = 'block';

      if (isHidden && rail) {
        // Folded: grip on the left edge of the icon rail
        const railBody = rail.__railBody || rail.querySelector('.chatter-rail-body');
        const insertBefore = railBody || rail.firstChild;
        if (handle.parentElement !== rail) {
          rail.insertBefore(handle, insertBefore);
        }
        handle.classList.add('in-rail');
        handle.setAttribute('aria-label', 'Drag to open chatter panel');
        handle.title = 'Drag to open chatter';
        return;
      }

      // Open: grip sits on the form/chatter boundary
      if (handle.parentElement !== formContainer) {
        formContainer.appendChild(handle);
      }
      handle.classList.remove('in-rail');
      handle.setAttribute('aria-label', 'Resize chatter panel');
      handle.title = 'Drag to resize chatter';
    },

    /**
     * Inserts the drag handle on the form container (visible open or folded).
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     */
    initResizeHandle: function(formContainer, chatterContainer) {
      if (!formContainer || !chatterContainer) return;

      let handle = this.getResizeHandle(formContainer);
      if (!handle) {
        handle = document.createElement('div');
        handle.className = 'chatter-resize-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', 'Resize chatter panel');
        handle.title = 'Drag to resize chatter';

        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.startChatterResize(event, formContainer, chatterContainer, handle);
        });

        formContainer.appendChild(handle);
      }

      this.syncResizeHandlePlacement(formContainer, chatterContainer);
    },

    /**
     * Removes the drag handle when the rail is torn down.
     * @param {HTMLElement} formContainer
     */
    removeResizeHandle: function(formContainer) {
      this.getResizeHandle(formContainer)?.remove();
    },

    /**
     * Drag-resizes the chatter panel; auto-folds when dragged too narrow.
     * When folded, dragging left reopens the panel at the dragged width.
     * @param {PointerEvent} event
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     * @param {HTMLElement} handle
     */
    startChatterResize: function(event, formContainer, chatterContainer, handle) {
      if (formContainer.classList.contains('vertical-layout')) return;

      const limits = this.getChatterWidthLimits(formContainer);
      const rail = this.getChatterRail();
      let isHidden = chatterContainer.classList.contains('hidden');
      const startWidth = isHidden
        ? this.resolveStoredChatterWidth(null)
        : chatterContainer.getBoundingClientRect().width;
      const formRect = formContainer.getBoundingClientRect();

      handle.classList.add('is-dragging');
      document.body.classList.add('chatter-resize-active');

      const cleanup = () => {
        handle.classList.remove('is-dragging');
        document.body.classList.remove('chatter-resize-active');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      const applyLiveWidth = (widthPx) => {
        const clamped = Math.min(limits.max, Math.max(limits.minVisible, widthPx));
        chatterContainer.style.setProperty('--chatter-panel-width', `${clamped}px`);
        formContainer.style.setProperty('--chatter-panel-width', `${clamped}px`);
        triggerResize();
      };

      const onMove = (moveEvent) => {
        const newWidth = formRect.right - moveEvent.clientX;

        // Dragging open from a folded state
        if (isHidden) {
          if (newWidth < limits.foldBelow) return;

          isHidden = false;
          if (rail) {
            this.setChatterCollapsedState(formContainer, chatterContainer, rail, false, { widthPx: newWidth });
          } else {
            chatterContainer.classList.remove('hidden');
            formContainer.classList.remove('centered-form');
            formContainer.classList.remove('stretch-form');
            applyLiveWidth(newWidth);
          }
          this.syncResizeHandlePlacement(formContainer, chatterContainer);
          return;
        }

        // Auto-fold before the panel gets uncomfortably narrow
        if (newWidth < limits.foldBelow) {
          cleanup();
          this.persistChatterWidth(startWidth);
          if (rail) {
            this.setChatterCollapsedState(formContainer, chatterContainer, rail, true);
          }
          this.syncResizeHandlePlacement(formContainer, chatterContainer);
          return;
        }

        applyLiveWidth(newWidth);
      };

      const onUp = () => {
        cleanup();
        if (!chatterContainer.classList.contains('hidden')) {
          this.persistChatterWidth(chatterContainer.getBoundingClientRect().width);
        }
        this.syncResizeHandlePlacement(formContainer, chatterContainer);
      };

      handle.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },

    /**
     * Applies collapsed/expanded chatter state and updates rail placement.
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     * @param {HTMLElement} rail
     * @param {boolean} isHidden
     * @param {{ widthPx?: number }} [options]
     */
    setChatterCollapsedState: function(formContainer, chatterContainer, rail, isHidden, options = {}) {
      const toggleButton = this.getRailToggle(rail);
      if (!toggleButton) return;

      chatterContainer.classList.toggle('hidden', isHidden);
      formContainer.classList.toggle('centered-form', isHidden);
      toggleButton.classList.toggle('active', !isHidden);
      this.placeChatterRail(rail, formContainer, chatterContainer, isHidden);
      this.syncResizeHandlePlacement(formContainer, chatterContainer);

      if (!isHidden) {
        if (typeof options.widthPx === 'number') {
          this.applyChatterWidthPx(options.widthPx, formContainer, chatterContainer);
        } else {
          getSetting('chatterWidth').then((width) => {
            const px = this.resolveStoredChatterWidth(width);
            this.applyChatterWidthPx(px, formContainer, chatterContainer);
          }).catch(console.error);
        }
      }

      const stretchPref = rail?.__stretchFormWhenFolded;
      if (typeof stretchPref === 'boolean') {
        this.applyFormStretch(formContainer, isHidden, stretchPref);
      } else {
        getSetting('stretchFormWhenFolded').then((stretch) => {
          this.applyFormStretch(formContainer, isHidden, stretch);
        }).catch(console.error);
      }

      triggerResize();
    },

    /**
     * Places the rail on the form edge when collapsed, or only the chevron in the topbar when open.
     * @param {HTMLElement} rail
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     * @param {boolean} isHidden
     */
    placeChatterRail: function(rail, formContainer, chatterContainer, isHidden) {
      const toggleButton = this.getRailToggle(rail);
      const actionsContainer = rail.querySelector('.chatter-collapsed-actions');
      const railBody = rail.__railBody || rail.querySelector('.chatter-rail-body');
      if (!toggleButton) return;

      rail.classList.toggle('is-collapsed', isHidden);
      toggleButton.classList.toggle('collapsed-mode', isHidden);
      toggleButton.classList.toggle('topbar-mode', !isHidden);
      toggleButton.classList.toggle('my-2', !isHidden);

      if (isHidden) {
        rail.style.display = 'flex';
        if (railBody && toggleButton.parentElement !== railBody) {
          railBody.insertBefore(toggleButton, actionsContainer);
        }
        this.refreshCollapsedActions(rail, chatterContainer);
        formContainer.appendChild(rail);
        this.syncResizeHandlePlacement(formContainer, chatterContainer);
        return;
      }

      rail.style.display = 'none';
      if (rail.parentElement !== formContainer) {
        formContainer.appendChild(rail);
      }

      const topbar = this.getChatterTopbar(chatterContainer);
      if (topbar) {
        topbar.appendChild(toggleButton);
      }
      this.syncResizeHandlePlacement(formContainer, chatterContainer);
    },

    /**
     * Triggers a native Odoo chatter action, unfolding when needed.
     * @param {HTMLElement} rail
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     * @param {string} actionId
     */
    triggerChatterAction: function(rail, formContainer, chatterContainer, actionId) {
      const actionDef = CHATTER_ACTION_DEFS.find((def) => def.id === actionId);
      if (!actionDef) return;

      const topbar = this.getChatterTopbar(chatterContainer);
      const nativeButton = topbar?.querySelector(actionDef.selector);
      if (!nativeButton || nativeButton.disabled) return;

      const wasHidden = chatterContainer.classList.contains('hidden');

      // Native buttons must be interactable, so temporarily reveal the chatter if folded
      if (wasHidden) {
        chatterContainer.classList.remove('hidden');
      }

      nativeButton.click();

      if (actionDef.keepCollapsed && wasHidden) {
        // Activity opens its own dialog; fold the panel back once the click is handled
        setTimeout(() => {
          this.setChatterCollapsedState(formContainer, chatterContainer, rail, true);
        }, 50);
        return;
      }

      if (wasHidden) {
        this.setChatterCollapsedState(formContainer, chatterContainer, rail, false);
      }
    },

    /**
     * Hides the chevron and collapsed rail — not needed when chatter is below the form.
     * @param {HTMLElement} rail
     * @param {HTMLButtonElement} toggleButton
     */
    hideChatterToggle: function(rail, toggleButton) {
      if (rail) rail.style.display = 'none';
      if (toggleButton) toggleButton.style.display = 'none';
    },

    /**
     * Wires up rail visibility, toggle handling, and collapsed quick actions.
     * @param {HTMLElement} rail
     * @param {HTMLButtonElement} toggleButton
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     */
    setupChatterRail: function(rail, toggleButton, formContainer, chatterContainer) {
      getSettings(['hideChatter', 'displayBelow', 'stretchFormWhenFolded']).then(settings => {
        const shouldDisplayBelow = settings.displayBelow ?? false;
        const defaultHidden = settings.hideChatter ?? false;
        const stretchFormWhenFolded = settings.stretchFormWhenFolded ?? false;

        // Cache preference so toggling stays synchronous without storage reads
        rail.__stretchFormWhenFolded = stretchFormWhenFolded;

        if (shouldDisplayBelow) {
          formContainer.classList.add('vertical-layout');
          chatterContainer.classList.remove('hidden');
          formContainer.classList.remove('centered-form');
          this.applyFormStretch(formContainer, false, stretchFormWhenFolded);
          this.hideChatterToggle(rail, toggleButton);
          this.syncResizeHandlePlacement(formContainer, chatterContainer);
          return;
        }

        formContainer.classList.remove('vertical-layout');

        this.setChatterCollapsedState(formContainer, chatterContainer, rail, !!defaultHidden);

        this.initResizeHandle(formContainer, chatterContainer);
        getSetting('chatterWidth').then((width) => {
          const px = this.resolveStoredChatterWidth(width);
          if (typeof width === 'string') {
            this.persistChatterWidth(px);
          }
          this.applyChatterWidthPx(px, formContainer, chatterContainer);
        }).catch(console.error);

        // Bind interaction handlers once per rail instance (SPA re-inits create a fresh rail)
        if (!rail.__listenersBound) {
          rail.__listenersBound = true;

          toggleButton.addEventListener('click', () => {
            const isHidden = !chatterContainer.classList.contains('hidden');
            this.setChatterCollapsedState(formContainer, chatterContainer, rail, isHidden);
          });

          rail.addEventListener('click', (event) => {
            if (event.target.closest('.chatter-resize-handle')) return;
            const actionButton = event.target.closest('[data-chatter-action]');
            if (!actionButton || !rail.contains(actionButton)) return;
            event.preventDefault();
            event.stopPropagation();
            this.triggerChatterAction(rail, formContainer, chatterContainer, actionButton.dataset.chatterAction);
          });
        }
      }).catch(console.error);
    },

    /**
     * Inserts the chatter rail (or waits for the topbar), then initializes behavior.
     * @param {HTMLElement} formContainer
     * @param {HTMLElement} chatterContainer
     */
    insertToggleButton: function(formContainer, chatterContainer) {
      const { rail, toggleButton } = this.createChatterRail();
      // Track the live Odoo nodes so we can detect stale rails after SPA navigation
      rail.__formContainer = formContainer;
      rail.__chatterContainer = chatterContainer;

      const initialize = () => {
        this.setupChatterRail(rail, toggleButton, formContainer, chatterContainer);
      };

      const topbar = this.getChatterTopbar(chatterContainer);
      if (topbar) {
        topbar.appendChild(toggleButton);
        formContainer.appendChild(rail);
        initialize();
        return;
      }

      waitForElement('.o-mail-Chatter-topbar', chatterContainer, 5000).then((topbarEl) => {
        if (!topbarEl || this.getChatterRail() !== rail) return;
        topbarEl.appendChild(toggleButton);
        formContainer.appendChild(rail);
        initialize();
      });
    },

    /**
     * Removes the chatter toggle button from the DOM if it exists.
     */
    removeToggleButton: function() {
      const rail = this.getChatterRail();
      if (!rail) return;

      const toggleButton = this.getRailToggle(rail);
      const chatterContainer = rail.__chatterContainer || this.getChatterContainer();
      const formContainer = rail.__formContainer || this.getFormContainer(chatterContainer);
      this.removeResizeHandle(formContainer);
      toggleButton?.remove();
      rail.remove();
    },

    /**
     * Initializes the chatter manager by syncing the rail with the best detected chatter.
     */
    init: function() {
      const foundNow = this.getChatterContainer();
      if (foundNow) {
        this.syncChatterRail(foundNow);
        return;
      }

      this.removeToggleButton();

      this.waitForChatter().then((chatterContainer) => {
        if (chatterContainer) {
          this.syncChatterRail(chatterContainer);
        }
      });
    },

    /**
     * Initializes chatter width from stored pixels (migrating legacy presets once).
     */
    initWidth: function() {
      getSetting('chatterWidth').then((width) => {
        const px = this.resolveStoredChatterWidth(width);
        if (typeof width === 'string') {
          this.persistChatterWidth(px);
        }

        const chatterContainer = this.getChatterContainer();
        const formContainer = this.getFormContainer(chatterContainer);
        if (chatterContainer && formContainer) {
          this.initResizeHandle(formContainer, chatterContainer);
          this.applyChatterWidthPx(px, formContainer, chatterContainer);
        }
      }).catch(console.error);
    },

    /**
     * Handles changes to the 'displayBelow' setting.
     * @param {boolean} isBelow 
     * @param {HTMLElement} formContainer 
     * @param {HTMLElement} chatterContainer 
     * @param {HTMLElement} toggleButton 
     */
    handleDisplayBelowChange: function(isBelow, formContainer, chatterContainer, toggleButton) {
      const rail = this.getChatterRail();
      if (isBelow) {
        formContainer.classList.add('vertical-layout');
        chatterContainer.classList.remove('hidden');
        formContainer.classList.remove('centered-form');
        this.hideChatterToggle(rail, toggleButton);
        this.syncResizeHandlePlacement(formContainer, chatterContainer);

        getSetting('stretchFormWhenFolded').then((stretch) => {
          if (rail) rail.__stretchFormWhenFolded = !!stretch;
          this.applyFormStretch(formContainer, false, stretch);
        }).catch(console.error);
      } else {
        formContainer.classList.remove('vertical-layout');

        const isHidden = chatterContainer.classList.contains('hidden');
        if (rail) {
          // Restore side-layout rail placement and collapsed state without a full reload
          this.setChatterCollapsedState(formContainer, chatterContainer, rail, isHidden);
        } else {
          formContainer.classList.toggle('centered-form', isHidden);
          toggleButton?.classList.toggle('active', !isHidden);
        }

        this.initResizeHandle(formContainer, chatterContainer);

        getSetting('stretchFormWhenFolded').then((stretch) => {
          if (rail) rail.__stretchFormWhenFolded = !!stretch;
          this.applyFormStretch(formContainer, isHidden, stretch);
        }).catch(console.error);
      }
    },

    /**
     * Handles changes to the 'hideChatter' setting.
     * @param {boolean} isHidden 
     * @param {HTMLElement} formContainer 
     * @param {HTMLElement} chatterContainer 
     * @param {HTMLElement} toggleButton 
     */
    handleHideChatterChange: function(isHidden, formContainer, chatterContainer, toggleButton) {
      const rail = this.getChatterRail();
      if (rail) {
        this.setChatterCollapsedState(formContainer, chatterContainer, rail, isHidden);
        return;
      }

      if (isHidden) {
        chatterContainer.classList.add('hidden');
        formContainer.classList.add('centered-form');
        toggleButton.classList.remove('active');
      } else {
        chatterContainer.classList.remove('hidden');
        formContainer.classList.remove('centered-form');
        formContainer.classList.remove('stretch-form');
        toggleButton.classList.add('active');
      }

      getSetting('stretchFormWhenFolded').then((stretch) => {
        this.applyFormStretch(formContainer, isHidden, stretch);
      }).catch(console.error);
    }
  };

  // Feature: Debug Mode Management
  /**
   * Retrieves the current debug mode from the URL query string.
   * @returns {string} The value of the 'debug' query param, if any.
   */
  function getDebugMode() {
    const url = new URL(window.location.href);
    return url.searchParams.get('debug') || '';
  }

  /**
   * Updates the debug mode parameter in the URL without reloading the page,
   * unless the actual debug state has changed.
   * @param {string} mode - '1' to enable debug mode, '' to disable it.
   */
  function updateDebugMode(mode) {
    const url = new URL(window.location.href);
    const currentMode = url.searchParams.get('debug');

    if (currentMode !== mode) {
      if (mode) {
        url.searchParams.set('debug', mode);
      } else {
        url.searchParams.delete('debug');
      }
      window.history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Determines if the URL is a "non-debug compatible" URL.
   * @returns {boolean}
   */
  function isSlideUrl() {
    return window.location.pathname.includes('/slides/') ||
           window.location.href.includes('odoo.com/help') ||
           window.location.pathname.includes('/odoo/website/') ||
           window.location.pathname.includes('/odoo/knowledge/');
  }

  /**
   * Determines if the URL is a "support" page.
   * @returns {boolean}
   */
  function isSupportPage() {
    return window.location.pathname.includes('/_odoo/support');
  }

  /**
   * Manages debug mode changes.
   * @param {boolean} enabled 
   */
  function handleDebugModeChange(enabled) {
    if (isSlideUrl()) return;
    const currentMode = getDebugMode();

    if (enabled) {
      // Any existing debug param counts as active (monkey debug / Odoo Debug extension compat)
      if (!currentMode) {
        updateDebugMode('1');
        window.location.reload();
      }
    } else if (currentMode === '1') {
      // Only strip debug=1 that this extension added — leave other debug values alone
      updateDebugMode('');
      window.location.reload();
    }
  }

  /**
   * Keeps the URL debug param aligned with the stored permanent-debug preference.
   * Reloads when a mismatch is found so Odoo bootstraps with the correct mode.
   */
  function checkDebugModeConsistency() {
    getSetting('debugMode').then((debugMode) => {
      const shouldBeEnabled = !!debugMode;
      const currentMode = getDebugMode();

      if (shouldBeEnabled && !currentMode) {
        handleDebugModeChange(true);
      } else if (!shouldBeEnabled && currentMode === '1') {
        handleDebugModeChange(false);
      }
    }).catch(console.error);
  }

  /**
   * Watches SPA navigations so debug=1 is re-applied when Odoo drops the query param.
   */
  function installDebugModeWatchers() {
    if (window.__chatterDebugWatchersInstalled) return;
    window.__chatterDebugWatchersInstalled = true;

    // Apply on first load
    checkDebugModeConsistency();

    // Fallback: pathname changes that bypass our history hooks
    let lastPathname = window.location.pathname;
    setInterval(() => {
      const currentPathname = window.location.pathname;
      if (currentPathname !== lastPathname) {
        lastPathname = currentPathname;
        checkDebugModeConsistency();
      }
    }, CONFIG.DEBUG_MODE_CHECK_INTERVAL);
  }

  // Feature: Support Page Styling & TOC
  /**
   * Adds or removes support page styling depending on user options.
   */
  function handleSupportPageStyling() {
    if (!isSupportPage()) return;

    getSetting('stylishSupport').then(stylishSupport => {
      let styleElement = document.getElementById('custom-support-styles');
      if (!styleElement) {
        styleElement = document.createElement('link');
        styleElement.id = 'custom-support-styles';
        styleElement.rel = 'stylesheet';
        styleElement.type = 'text/css';
        styleElement.href = chrome.runtime.getURL('support.css');
      }

      if (stylishSupport) {
        if (!document.head.contains(styleElement)) {
          document.head.appendChild(styleElement);
        }
        createTableOfContents();
        handleNavbarScroll();
        moveImpersonationToNavbar(); // Ensure this function is defined
      } else {
        if (document.head.contains(styleElement)) {
          styleElement.remove();
        }
        const toc = document.querySelector('.toc-container');
        if (toc) toc.remove();
      }
    }).catch(console.error);
  }

  /**
   * Creates a table of contents for support pages with smooth scroll behavior.
   */
  function createTableOfContents() {
    if (!isSupportPage()) return;

    const existingToc = document.querySelector('.toc-container');
    if (existingToc) existingToc.remove();

    const headings = Array.from(document.querySelectorAll('h2'));
    if (headings.length === 0) return;

    const tocContainer = document.createElement('div');
    tocContainer.className = 'toc-container';

    const tocTitle = document.createElement('div');
    tocTitle.className = 'toc-title';
    tocTitle.textContent = 'Table of Contents';
    tocContainer.appendChild(tocTitle);

    const tocList = document.createElement('ul');
    tocList.className = 'toc-list';

    headings.forEach((heading, index) => {
      if (!heading.id) {
        heading.id = `section-${index}`;
      }
      const listItem = document.createElement('li');
      listItem.className = 'toc-item';

      const link = document.createElement('a');
      link.className = 'toc-link';
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;

      // Smooth scroll behavior for TOC links
      link.addEventListener('click', (e) => {
        e.preventDefault();
        heading.scrollIntoView({ behavior: 'smooth' });
        updateActiveLink(link);
      });

      listItem.appendChild(link);
      tocList.appendChild(listItem);
    });

    tocContainer.appendChild(tocList);
    document.body.appendChild(tocContainer);

    addScrollSpy(headings);
  }

  /**
   * Updates the active link in the TOC.
   * @param {HTMLElement} activeLink 
   */
  function updateActiveLink(activeLink) {
    document.querySelectorAll('.toc-link').forEach(link => {
      link.classList.remove('active');
    });
    if (activeLink) {
      activeLink.classList.add('active');
    }
  }

  /**
   * Enables a scroll spy to highlight TOC items as content scrolls.
   * @param {HTMLElement[]} headings 
   */
  function addScrollSpy(headings) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const correspondingLink = document.querySelector(`.toc-link[href="#${id}"]`);
          updateActiveLink(correspondingLink);
        }
      });
    }, {
      rootMargin: '-20% 0px -80% 0px'
    });

    headings.forEach(heading => observer.observe(heading));
  }

  /**
   * Adds or removes 'scrolled' class from the navbar based on scroll position.
   */
  function handleNavbarScroll() {
    if (!isSupportPage() || supportNavbarScrollBound) return;
    const navbar = document.getElementById('support-nav');
    if (!navbar) return;

    supportNavbarScrollBound = true;
    window.addEventListener('scroll', () => {
      if (window.scrollY > CONFIG.SUPPORT_NAVBAR_SCROLL_THRESHOLD) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  /**
   * Moves support-page impersonation controls into the top navbar.
   */
  function moveImpersonationToNavbar() {
    if (!isSupportPage()) return;

    const navbar = document.getElementById('support-nav');
    if (!navbar || navbar.dataset.impersonationMoved === 'true') return;

    const impersonationSection = document.querySelector('.o_database_list');
    if (!impersonationSection) return;

    const navLeft = document.createElement('div');
    navLeft.className = 'nav-left';

    const brand = navbar.querySelector('.navbar-brand');
    const title = navbar.querySelector('.o_menu_title');
    if (brand && title) {
      navLeft.appendChild(brand.cloneNode(true));
      navLeft.appendChild(title.cloneNode(true));
    }

    const impersonationControls = document.createElement('div');
    impersonationControls.className = 'impersonation-controls';

    const form = impersonationSection.querySelector('form');
    if (form) {
      const formClone = form.cloneNode(true);
      const originalSelect = form.querySelector('select');
      const originalButton = form.querySelector('button');
      const clonedSelect = formClone.querySelector('select');
      const clonedButton = formClone.querySelector('button');

      if (originalSelect && clonedSelect) {
        clonedSelect.value = originalSelect.value;
        originalSelect.getAttributeNames().forEach((attr) => {
          if (attr.startsWith('on')) {
            clonedSelect[attr] = originalSelect[attr];
          }
        });
      }

      if (originalButton && clonedButton) {
        originalButton.getAttributeNames().forEach((attr) => {
          if (attr.startsWith('on')) {
            clonedButton[attr] = originalButton[attr];
          }
        });
      }

      impersonationControls.appendChild(formClone);
      form.style.display = 'none';
    }

    const container = navbar.querySelector('.container-fluid');
    if (container) {
      container.innerHTML = '';
      container.appendChild(navLeft);
      container.appendChild(impersonationControls);

      const navbarNav = navbar.querySelector('.nav.navbar-nav');
      if (navbarNav) {
        container.appendChild(navbarNav.cloneNode(true));
      }
    }

    navbar.dataset.impersonationMoved = 'true';
  }

  /**
   * Toggles chatter visibility using the same paths as the keyboard shortcut.
   */
  function toggleChatterFromShortcut() {
    const rail = chatterManager.getChatterRail();
    const toggleButton = rail ? chatterManager.getRailToggle(rail) : document.querySelector('.chatter-toggle');

    if (toggleButton && toggleButton.offsetParent !== null) {
      toggleButton.click();
      return true;
    }

    const chatterContainer = chatterManager.getChatterContainer();
    const formContainer = chatterManager.getFormContainer(chatterContainer);
    if (!chatterContainer || !formContainer || formContainer.classList.contains('vertical-layout')) {
      return false;
    }

    const isHidden = chatterContainer.classList.contains('hidden');
    if (rail) {
      chatterManager.setChatterCollapsedState(formContainer, chatterContainer, rail, !isHidden);
    } else {
      chatterContainer.classList.toggle('hidden');
      formContainer.classList.toggle('centered-form', !isHidden);
      if (!isHidden) {
        formContainer.classList.remove('stretch-form');
      } else {
        getSetting('stretchFormWhenFolded').then((stretch) => {
          chatterManager.applyFormStretch(formContainer, true, stretch);
        }).catch(console.error);
      }
      if (toggleButton) toggleButton.classList.toggle('active', isHidden);
    }

    triggerResize();
    return true;
  }

  /**
   * Shows a brief confirmation after toggling chatter via shortcut.
   * @param {boolean} isMac
   */
  function showToggleShortcutTooltip(isMac) {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(135,90,123,0.9);color:#fff;padding:8px 16px;border-radius:4px;z-index:1001;font-size:13px;pointer-events:none;transition:opacity .3s';
    tooltip.textContent = `Chatter toggled (${isMac ? '⌘⇧X' : 'Alt+Shift+C'})`;
    document.body.appendChild(tooltip);
    setTimeout(() => {
      tooltip.style.opacity = '0';
      setTimeout(() => tooltip.remove(), 300);
    }, 1000);
  }

  const initKeyboardShortcut = () => {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      if (
        (isMac && e.metaKey && e.shiftKey && e.key.toLowerCase() === 'x') ||
        (!isMac && e.altKey && e.shiftKey && e.key.toLowerCase() === 'c')
      ) {
        e.preventDefault();
        if (toggleChatterFromShortcut()) {
          showToggleShortcutTooltip(isMac);
        }
      }
    });
  };
  initKeyboardShortcut();

  // Handle manifest keyboard commands relayed from the background worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== 'toggleChatter') return;

    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if (toggleChatterFromShortcut()) {
      showToggleShortcutTooltip(isMac);
    }
  });

  // Initialize chatter width on script load
  chatterManager.initWidth();

  // Re-clamp stored width when the viewport changes
  window.addEventListener('resize', debounce(() => {
    getSetting('chatterWidth').then((width) => {
      const chatterContainer = chatterManager.getChatterContainer();
      const formContainer = chatterManager.getFormContainer(chatterContainer);
      if (!chatterContainer || !formContainer) return;

      const px = chatterManager.resolveStoredChatterWidth(width);
      chatterManager.applyChatterWidthPx(px, formContainer, chatterContainer);
    }).catch(console.error);
  }, CONFIG.DEBOUNCE_INTERVAL));

  // Single Mutation Observer for DOM changes
  const chatterObserver = new MutationObserver(throttle((mutations) => {
    let shouldReinitChatter = false;
    let shouldTrackRecentView = false;

    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (nodeAffectsChatter(node)) {
            shouldReinitChatter = true;
            shouldTrackRecentView = true;
          }
        });

        mutation.removedNodes.forEach((node) => {
          if (nodeAffectsChatter(node)) {
            shouldReinitChatter = true;
          }
        });
      }

      if (mutation.type === 'attributes') {
        if (mutation.attributeName === 'class' && nodeClassChangeAffectsChatter(mutation.target)) {
          shouldReinitChatter = true;
        }

        if (['href', 'data-action'].includes(mutation.attributeName)) {
          shouldTrackRecentView = true;
        }
      }
    });

    if (shouldTrackRecentView) {
      debouncedTrackRecentView();
    }

    if (shouldReinitChatter) {
      debouncedInit();

      getSetting('chatterWidth').then((width) => {
        const chatterContainer = chatterManager.getChatterContainer();
        const formContainer = chatterManager.getFormContainer(chatterContainer);
        if (!chatterContainer || !formContainer) return;

        const px = chatterManager.resolveStoredChatterWidth(width);
        chatterManager.applyChatterWidthPx(px, formContainer, chatterContainer);
      }).catch(console.error);

      setTimeout(() => {
        triggerResize();
      }, 100);
    }
  }, CONFIG.THROTTLE_INTERVAL));

  // Start observing DOM changes with a scoped root when possible to reduce noise
  const startObserving = () => {
    try {
      chatterObserver.disconnect();
    } catch (e) {}

    const preferredRoot = document.querySelector('.o_web_client, .o_action_manager, main, .o_content, body > div.o_action_manager') || document;
    chatterObserver.observe(preferredRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'data-action', 'class'],
      characterData: false
    });
  };
  startObserving();

  // Clean-up observer on unload
  function disconnectObservers() {
    chatterObserver.disconnect();
  }
  window.addEventListener('unload', disconnectObservers);

  // Debounced initialization function for Chatter Manager
  const debouncedInit = debounce(() => chatterManager.init(), CONFIG.DEBOUNCE_INTERVAL);

  // Replace immediate call with DOMContentLoaded handler for proper initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installDebugModeWatchers();
      chatterManager.init();
      setTimeout(() => {
        triggerResize();
      }, 500);
      // After initial load, start listening to SPA navigation changes
      installNavigationHooks();
    });
  } else {
    installDebugModeWatchers();
    chatterManager.init();
    setTimeout(() => {
      triggerResize();
    }, 500);
    // Ensure hooks exist even on already-loaded documents
    installNavigationHooks();
  }

  // Listen for storage changes to update support page styling and debug mode
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.stylishSupport) {
      handleSupportPageStyling();
    }
    if (changes.debugMode) {
      handleDebugModeChange(changes.debugMode.newValue);
    }
    if (changes.hideChatter) {
      const chatterContainer = chatterManager.getChatterContainer();
      const formContainer = chatterManager.getFormContainer(chatterContainer);
      const rail = chatterManager.getChatterRail();
      const toggleButton = rail ? chatterManager.getRailToggle(rail) : null;
      if (chatterContainer && formContainer && toggleButton) {
        chatterManager.handleHideChatterChange(!!changes.hideChatter.newValue, formContainer, chatterContainer, toggleButton);
      }
    }
    if (changes.stretchFormWhenFolded) {
      const rail = chatterManager.getChatterRail();
      const chatterContainer = chatterManager.getChatterContainer();
      const formContainer = chatterManager.getFormContainer(chatterContainer);
      const stretchEnabled = !!changes.stretchFormWhenFolded.newValue;

      if (rail) rail.__stretchFormWhenFolded = stretchEnabled;

      if (formContainer && chatterContainer) {
        const isHidden = chatterContainer.classList.contains('hidden');
        chatterManager.applyFormStretch(formContainer, isHidden, stretchEnabled);
        triggerResize();
      }
    }
    if (changes.displayBelow) {
      const chatterContainer = chatterManager.getChatterContainer();
      const formContainer = chatterManager.getFormContainer(chatterContainer);
      const rail = chatterManager.getChatterRail();
      const toggleButton = rail ? chatterManager.getRailToggle(rail) : null;
      if (chatterContainer && formContainer && toggleButton) {
        chatterManager.handleDisplayBelowChange(!!changes.displayBelow.newValue, formContainer, chatterContainer, toggleButton);
        triggerResize();
      }
    }
    if (changes.chatterWidth) {
      const chatterContainer = chatterManager.getChatterContainer();
      const formContainer = chatterManager.getFormContainer(chatterContainer);
      if (chatterContainer && formContainer) {
        const px = chatterManager.resolveStoredChatterWidth(changes.chatterWidth.newValue);
        chatterManager.applyChatterWidthPx(px, formContainer, chatterContainer);
      }
    }
  });

  // Apply support page styling on load if on support page
  if (isSupportPage()) {
    handleSupportPageStyling();
  }

  /**
   * Install hooks to detect SPA navigations so we can re-run initialization
   * when Odoo dynamically swaps views without full reloads.
   */
  function installNavigationHooks() {
    // Avoid double-installation
    if (window.__chatterNavHooksInstalled) return;
    window.__chatterNavHooksInstalled = true;

    const debouncedDebugCheck = debounce(checkDebugModeConsistency, 150);

    const reinit = () => {
      debouncedInit();
      debouncedDebugCheck();
      setTimeout(() => triggerResize(), 100);
    };

    // Patch history methods
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      reinit();
      return result;
    };
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      reinit();
      return result;
    };

    // Listen for back/forward
    window.addEventListener('popstate', reinit);
  }
})();
