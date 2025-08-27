// popup.js
// Immediately Invoked Function Expression (IIFE) to encapsulate the code
(() => {
  /**
   * Cache DOM elements for performance and readability
   */
  const DOM = {
    hideChatter: document.getElementById('hideChatter'),
    displayBelow: document.getElementById('displayBelow'),
    // New: hide on-page toggle button option
    hideToggleButton: document.getElementById('hideToggleButton'),
    debugMode: document.getElementById('debugMode'),
    stylishSupportToggle: document.getElementById('stylishSupportToggle'),
    showDomainsToggle: document.getElementById('showDomainsToggle'),
    recentViewsList: document.getElementById('recentViewsList'),
    settingsLink: document.getElementById('settingsLink'),
    pinPageButton: document.getElementById('pinPageButton'),
    pinsList: document.getElementById('pinsList'),
    recentViewsSearch: document.getElementById('recentViewsSearch'),
    widthStandard: document.getElementById('widthStandard'),
    widthMedium: document.getElementById('widthMedium'),
    widthLarge: document.getElementById('widthLarge'),
  };

  /**
   * Storage Utilities
   * Handles interactions with chrome.storage (sync and local)
   */
  const StorageUtil = {
    // Sync storage methods
    getSync: (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
    setSync: (items) => new Promise((resolve) => chrome.storage.sync.set(items, resolve)),

    // Local storage methods
    getLocal: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
    setLocal: (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve)),

    getChatterWidth: () => new Promise((resolve) => chrome.storage.sync.get(['chatterWidth'], resolve)),
    setChatterWidth: (width) => new Promise((resolve) => chrome.storage.sync.set({ chatterWidth: width }, resolve)),
  };

  /**
   * Utility Functions
   */
  const Utils = {
    /**
     * Debounce function to limit the rate at which a function can fire.
     * @param {Function} func - The function to debounce.
     * @param {number} wait - The debounce interval in milliseconds.
     * @returns {Function}
     */
    debounce(func, wait) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    },

    /**
     * Format timestamp into a readable string.
     * @param {number} timestamp - The timestamp to format.
     * @returns {string} - Formatted timestamp.
     */
    formatTimestamp(timestamp) {
      const now = new Date();
      const date = new Date(timestamp);
      const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));

      if (diffInHours < 1) {
        return 'Just now';
      } else if (diffInHours < 24) {
        return `${diffInHours}h ago`;
      } else {
        return date.toLocaleDateString();
      }
    },

    /**
     * Parses the app name from the URL path.
     * @param {string} url - The URL of the page.
     * @returns {string} - The app name (e.g., 'Project', 'Contacts').
     */
    getAppNameFromUrl(url) {
      try {
        const path = new URL(url).pathname;
        const segments = path.split('/').filter(segment => segment);
        return segments[1] ? segments[1].charAt(0).toUpperCase() + segments[1].slice(1) : 'App';
      } catch (error) {
        console.error('Invalid URL:', url, error);
        return 'App';
      }
    },

    /**
     * Trims the .odoo.com suffix from a domain if present, except for odoo.com itself
     * @param {string} domain - The domain to trim
     * @returns {string} - The trimmed domain
     */
    trimOdooDomain(domain) {
      // Special case for odoo.com
      if (domain === 'www.odoo.com' || domain === 'odoo.com') {
        return 'odoo.com';
      }
      return domain.replace('.odoo.com', '');
    },
  };

  /**
   * Tab Utilities
   * Handles operations related to browser tabs
   */
  const TabUtil = {
    /**
     * Reloads the active tab to apply changes.
     */
    reloadActiveTab() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
    },

    /**
     * Retrieves the current active tab's URL and details.
     * @returns {Promise<{url: string, title: string}>}
     */
    getCurrentTab() {
      return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            resolve({ url: tabs[0].url, title: tabs[0].title });
          } else {
            reject('No active tab found.');
          }
        });
      });
    },

    /**
     * Opens the settings page in a new tab.
     */
    navigateToSettings() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          try {
            const currentTab = tabs[0];
            const url = new URL(currentTab.url);
            const settingsUrl = `${url.origin}/odoo/settings?debug=1`;

            // Open the settings URL in a new tab
            chrome.tabs.create({ url: settingsUrl }, () => {
              window.close(); // Close the popup after opening the new tab
            });
          } catch (error) {
            console.error('Error navigating to settings:', error);
          }
        }
      });
    },

    /**
     * Opens a given URL in the current tab.
     * @param {string} url - The URL to open.
     */
    openUrlInCurrentTab(url) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.update(tabs[0].id, { url });
          window.close(); // Optional: Close the popup after navigating
        }
      });
    },
  };

  /**
   * Pin Management
   * Handles adding, removing, and rendering pinned pages
   */
  const PinManager = {
    /**
     * Loads pinned pages from local storage.
     * @returns {Promise<Array>}
     */
    async getPins() {
      const result = await StorageUtil.getLocal(['pinnedPages']);
      return result.pinnedPages || [];
    },

    /**
     * Saves pinned pages to local storage.
     * @param {Array} pins - The array of pinned pages.
     * @returns {Promise}
     */
    setPins(pins) {
      return StorageUtil.setLocal({ pinnedPages: pins });
    },

    /**
     * Adds the current page to the pinned pages.
     */
    async addPin() {
      try {
        const { url, title } = await TabUtil.getCurrentTab();
        const appName = Utils.getAppNameFromUrl(url);
        let pins = await this.getPins();

        // Check for duplicates
        if (pins.find(pin => pin.url === url)) {
          alert('This page is already pinned.');
          return;
        }

        // Add new pin
        pins.push({ url, title, appName });
        await this.setPins(pins);
        UIManager.renderPins();
      } catch (error) {
        console.error('Error adding pin:', error);
      }
    },

    /**
     * Removes a pinned page by its URL.
     * @param {string} url - The URL of the pinned page to remove.
     */
    async removePin(url) {
      try {
        let pins = await this.getPins();
        // Filter out the pin with the matching URL
        pins = pins.filter(pin => pin.url !== url);
        await this.setPins(pins);
        UIManager.renderPins();
      } catch (error) {
        console.error('Error removing pin:', error);
      }
    },

    /**
     * Enables drag-and-drop functionality for rearranging pinned pages.
     */
    enableDragAndDrop() {
      const pinsList = DOM.pinsList;
      let draggedElement = null;

      // Add draggable attribute to each pinned-button
      const draggablePins = pinsList.querySelectorAll('.pinned-button');
      draggablePins.forEach((pin) => {
        pin.setAttribute('draggable', true);

        // Drag start event
        pin.addEventListener('dragstart', (e) => {
          draggedElement = pin;
          e.dataTransfer.effectAllowed = 'move';
          // Optional: Add a drag image
          e.dataTransfer.setDragImage(pin, 20, 20);
        });

        // Drag over event
        pin.addEventListener('dragover', (e) => {
          e.preventDefault(); // Necessary to allow dropping
          e.dataTransfer.dropEffect = 'move';
        });

        // Drop event
        pin.addEventListener('drop', (e) => {
          e.preventDefault();
          if (draggedElement && draggedElement !== pin) {
            // Insert the dragged element before the drop target
            pinsList.insertBefore(draggedElement, pin);
            this.savePinOrder();
          }
        });

        // Drag end event
        pin.addEventListener('dragend', () => {
          draggedElement = null;
        });
      });
    },

    /**
     * Saves the current order of pinned pages to local storage.
     */
    async savePinOrder() {
      try {
        const pinsList = DOM.pinsList;
        const pinElements = pinsList.querySelectorAll('.pinned-button');
        const newOrder = [];

        pinElements.forEach((pinEl) => {
          const url = pinEl.dataset.url;
          const title = pinEl.querySelector('.pinned-page-name').textContent;
          const appName = pinEl.querySelector('.pinned-app-name').textContent;
          newOrder.push({ url, title, appName });
        });

        await this.setPins(newOrder);
      } catch (error) {
        console.error('Error saving pin order:', error);
      }
    },
  };

  /**
   * UI Management
   * Handles rendering and event binding for UI components
   */
  const UIManager = {
    /**
     * Renders the pinned pages in the popup with remove buttons and drag-and-drop enabled.
     */
    async renderPins() {
      try {
        const pins = await PinManager.getPins();
        const { showDomains = true } = await StorageUtil.getLocal(['showDomains']);
        DOM.pinsList.innerHTML = '';

        pins.forEach((pin) => {
          const button = document.createElement('div');
          button.className = 'pinned-button';
          button.dataset.url = pin.url;
          button.title = pin.title;

          const appName = document.createElement('div');
          appName.className = 'pinned-app-name';
          appName.textContent = pin.appName;

          const pageName = document.createElement('div');
          pageName.className = 'pinned-page-name';
          pageName.textContent = pin.title;

          // Append basic elements
          button.appendChild(appName);
          button.appendChild(pageName);

          // Add domain name display only if showDomains is true
          if (showDomains) {
            try {
              const domain = Utils.trimOdooDomain(new URL(pin.url).hostname);
              const domainDiv = document.createElement('div');
              domainDiv.className = 'pinned-domain';
              domainDiv.style.fontSize = '11px';
              domainDiv.style.color = '#666';
              domainDiv.textContent = domain;
              button.appendChild(domainDiv);
            } catch (error) {
              console.error('Invalid URL:', pin.url, error);
            }
          }

          // Add the remove button
          this.addRemoveButton(button, pin);

          // Event listener to open the pinned page in the current tab
          button.addEventListener('click', () => {
            TabUtil.openUrlInCurrentTab(pin.url);
          });

          DOM.pinsList.appendChild(button);
        });

        // Enable drag-and-drop after rendering all pins
        PinManager.enableDragAndDrop();
      } catch (error) {
        console.error('Error rendering pins:', error);
      }
    },

    /**
     * Adds a remove button to each pinned page and sets up its event listener.
     * @param {HTMLElement} button - The pinned-button element.
     * @param {Object} pin - The pinned page object containing url, title, and appName.
     */
    addRemoveButton(button, pin) {
      // Create the remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-pin-button';
      removeBtn.textContent = '×'; //

      // Prevent the click event from bubbling up to the parent button
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent opening the pinned page
        PinManager.removePin(pin.url);
      });

      // Append the remove button to the pinned button
      button.appendChild(removeBtn);
    },

    /**
     * Displays recent views by fetching data from local storage and updating the DOM.
     * @param {string} [filter=''] - Optional search filter to apply.
     */
    async displayRecentViews(filter = '') {
      try {
        if (!DOM.recentViewsList) return;

        const { recentViews = [], showDomains = true } = await StorageUtil.getLocal([
          'recentViews',
          'showDomains',
        ]);

        // Remove duplicate entries by URL
        const uniqueRecentViews = recentViews.filter(
          (view, index, self) => index === self.findIndex((v) => v.url === view.url)
        );

        // Clear existing content
        DOM.recentViewsList.innerHTML = '';

        if (uniqueRecentViews.length === 0) {
          const placeholder = document.createElement('div');
          placeholder.className = 'recent-view-item';
          placeholder.style.cursor = 'default';
          placeholder.style.color = '#666';
          placeholder.textContent = 'No recently visited pages';
          DOM.recentViewsList.appendChild(placeholder);
          return;
        }

        const fragment = document.createDocumentFragment();

        uniqueRecentViews.forEach((view) => {
          // Apply filter if provided
          if (
            filter &&
            !view.title.toLowerCase().includes(filter.toLowerCase()) &&
            !view.url.toLowerCase().includes(filter.toLowerCase())
          ) {
            return; // Skip rendering this item if it doesn't match the filter
          }

          const item = document.createElement('div');
          item.className = 'recent-view-item';
          item.dataset.url = view.url;
          item.title = view.title;

          // Header containing title and timestamp
          const header = document.createElement('div');
          header.className = 'recent-view-header';
          header.style.display = 'flex';
          header.style.justifyContent = 'space-between';
          header.style.alignItems = 'center';

          const title = document.createElement('div');
          title.className = 'recent-view-title';
          title.textContent = view.title;

          const timestamp = document.createElement('span');
          timestamp.className = 'recent-view-timestamp';
          timestamp.textContent = Utils.formatTimestamp(view.timestamp);

          header.appendChild(title);
          header.appendChild(timestamp);
          item.appendChild(header);

          // Domain name displayed below the title if enabled
          if (showDomains) {
            try {
              const domain = Utils.trimOdooDomain(new URL(view.url).hostname);
              const domainDiv = document.createElement('div');
              domainDiv.className = 'recent-view-domain';
              domainDiv.style.fontSize = '11px';
              domainDiv.style.color = '#666';
              domainDiv.textContent = domain;
              item.appendChild(domainDiv);
            } catch (error) {
              console.error('Invalid URL:', view.url, error);
            }
          }

          fragment.appendChild(item);
        });

        DOM.recentViewsList.appendChild(fragment);
      } catch (error) {
        console.error('Error displaying recent views:', error);
      }
    },

    /**
     * Initializes the popup by loading saved states and setting up the UI.
     */
    async initializePopup() {
      try {
        // Load sync storage states
        const syncResult = await StorageUtil.getSync([
          'hideChatter',
          'displayBelow',
          // Load hideToggleButton initial state
          'hideToggleButton',
          'debugMode',
          'stylishSupport',
        ]);

        const {
          hideChatter = false,
          displayBelow = false,
          hideToggleButton = false,
          debugMode = false,
          stylishSupport = false,
        } = syncResult;

        DOM.hideChatter.checked = hideChatter;
        DOM.displayBelow.checked = displayBelow;
        DOM.hideChatter.disabled = displayBelow;
        // Initialize new toggle
        if (DOM.hideToggleButton) DOM.hideToggleButton.checked = hideToggleButton;
        DOM.debugMode.checked = debugMode;
        DOM.stylishSupportToggle.checked = stylishSupport;

        // Load local storage states
        const localResult = await StorageUtil.getLocal(['showDomains']);
        DOM.showDomainsToggle.checked = localResult.showDomains ?? true;

        // Display recent views based on loaded settings
        await this.displayRecentViews();

        // Set up search filter event listener and focus on the search field
        if (DOM.recentViewsSearch) {
          // Automatically focus on the search input when popup opens
          DOM.recentViewsSearch.focus();

          // Add event listener for input in the search field
          DOM.recentViewsSearch.addEventListener('input', Utils.debounce((e) => {
            const query = e.target.value.trim();
            this.displayRecentViews(query);
          }, 300)); // Debounce to optimize performance
        }

        // Render pinned pages
        await this.renderPins();

        // Initialize chatter width settings
        await this.initializeChatterWidth();
      } catch (error) {
        console.error('Error initializing popup:', error);
      }
    },

    /**
     * Sets up all necessary event listeners.
     */
    setupEventListeners() {
      /**
       * Event listener for changes in 'displayBelow' toggle
       */
      DOM.displayBelow.addEventListener('change', async (e) => {
        try {
          DOM.hideChatter.disabled = e.target.checked;

          if (e.target.checked) {
            DOM.hideChatter.checked = false;
            await StorageUtil.setSync({ hideChatter: false, displayBelow: true });
            TabUtil.reloadActiveTab();
          } else {
            await StorageUtil.setSync({ displayBelow: false });
            TabUtil.reloadActiveTab();
          }
        } catch (error) {
          console.error('Error handling displayBelow change:', error);
        }
      });

      /**
       * Generic event listeners for toggle changes to update storage
       */
      const handleToggleChange = async (toggleElement, storageKey, callback) => {
        try {
          const isChecked = toggleElement.checked;
          if (storageKey === 'showDomains') {
            await StorageUtil.setLocal({ [storageKey]: isChecked });
          } else {
            await StorageUtil.setSync({ [storageKey]: isChecked });
          }
          if (callback) callback(isChecked);
        } catch (error) {
          console.error(`Error updating ${storageKey}:`, error);
        }
      };

      DOM.hideChatter.addEventListener('change', () => {
        handleToggleChange(DOM.hideChatter, 'hideChatter');
      });

      // New: persist hideToggleButton change
      if (DOM.hideToggleButton) {
        DOM.hideToggleButton.addEventListener('change', () => {
          handleToggleChange(DOM.hideToggleButton, 'hideToggleButton');
        });
      }

      DOM.debugMode.addEventListener('change', () => {
        handleToggleChange(DOM.debugMode, 'debugMode');
      });

      DOM.stylishSupportToggle.addEventListener('change', () => {
        handleToggleChange(DOM.stylishSupportToggle, 'stylishSupport');
      });

      DOM.showDomainsToggle.addEventListener(
        'change',
        Utils.debounce(() => {
          handleToggleChange(DOM.showDomainsToggle, 'showDomains', () => {
            // Update both recent views and pins when the toggle changes
            this.displayRecentViews();
            this.renderPins();
          });
        }, 300)
      );

      // Event listener for settings link click
      DOM.settingsLink.addEventListener('click', () => TabUtil.navigateToSettings());

      // Event listener for the "Pin Page" button
      DOM.pinPageButton.addEventListener('click', () => PinManager.addPin());

      /**
       * Event delegation for handling clicks on recent view items.
       * This approach reduces the number of event listeners by utilizing a single listener on the parent.
       */
      DOM.recentViewsList.addEventListener('click', (event) => {
        const item = event.target.closest('.recent-view-item');
        if (item) {
          const url = item.dataset.url;
          TabUtil.openUrlInCurrentTab(url);
        }
      });

      // Setup chatter width listeners
      this.setupChatterWidthListeners();
    },

    /**
     * Renders the initial state of chatter width settings
     */
    async initializeChatterWidth() {
      try {
        const result = await StorageUtil.getChatterWidth();
        const width = result.chatterWidth || 'standard';
        
        // Find the tri-state toggle container
        const toggleContainer = document.querySelector('.tri-state-toggle');
        if (!toggleContainer) return;
        
        // Set the active state
        toggleContainer.dataset.state = width;
        
        // Update active class on options
        const options = toggleContainer.querySelectorAll('.toggle-option');
        options.forEach(option => {
          option.classList.toggle('active', option.dataset.value === width);
        });
      } catch (error) {
        console.error('Error initializing chatter width:', error);
      }
    },

    /**
     * Sets up event listeners for chatter width toggle
     */
    setupChatterWidthListeners() {
      const toggleContainer = document.querySelector('.tri-state-toggle');
      if (!toggleContainer) return;

      const handleWidthChange = async (selectedWidth) => {
        try {
          await StorageUtil.setChatterWidth(selectedWidth);
          // Update the toggle state
          toggleContainer.dataset.state = selectedWidth;
          
          // Update active classes
          const options = toggleContainer.querySelectorAll('.toggle-option');
          options.forEach(option => {
            option.classList.toggle('active', option.dataset.value === selectedWidth);
          });
        } catch (error) {
          console.error('Error setting chatter width:', error);
        }
      };

      // Add click listeners to each option
      const options = toggleContainer.querySelectorAll('.toggle-option');
      options.forEach(option => {
        option.addEventListener('click', () => {
          handleWidthChange(option.dataset.value);
        });
      });
    },
  };

  /**
   * Event Listener for storage changes to update the recent views list and pins dynamically
   */
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.recentViews) {
      const query = DOM.recentViewsSearch ? DOM.recentViewsSearch.value.trim() : '';
      UIManager.displayRecentViews(query);
    }

    if (changes.pinnedPages) {
      UIManager.renderPins();
    }
  });

  /**
   * Collapsible Settings Initialization
   */
  const initializeCollapsibleSettings = () => {
    const settingsHeader = document.getElementById('settingsHeader');
    const settingsSection = settingsHeader.closest('.settings-section');

    // Load saved state
    StorageUtil.getLocal(['settingsCollapsed']).then(result => {
      if (result.settingsCollapsed) {
        settingsSection.classList.add('collapsed');
      }
    });

    settingsHeader.addEventListener('click', () => {
      settingsSection.classList.toggle('collapsed');

      // Save state
      StorageUtil.setLocal({
        settingsCollapsed: settingsSection.classList.contains('collapsed')
      });
    });
  };

  /**
   * Initialize all components when the DOM is fully loaded
   */
  document.addEventListener('DOMContentLoaded', () => {
    UIManager.initializePopup();
    UIManager.setupEventListeners();
    initializeCollapsibleSettings();
  });
})();

