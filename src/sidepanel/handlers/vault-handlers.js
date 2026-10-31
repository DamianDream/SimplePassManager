/**
 * SimplePass Manager - Vault List & Card Action Event Handlers
 * Uses event delegation and scoped DOM updates to preserve focus and scroll state.
 */

import { state, updateState, copyToClipboard } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { panelState, clearFormDraft } from '../panel-state.js';
import { showToast } from '../render-utils.js';
import { extractCleanDomain, extractDomainName } from '../../core/domain.js';
import {
  requestPermission,
  requestOriginPermissions,
  getDomainOriginPatterns
} from '../../core/permissions.js';
import { renderCardsListHtml } from '../views/vault-list.js';

export function attachVaultHandlers({ updateActiveTabDomain, renderApp }) {
  const searchInput = document.getElementById('sp-search-input');
  const searchClear = document.getElementById('sp-search-clear');
  const cardsContainer = document.getElementById('sp-vault-cards-container');

  // 1. Scoped search input handler - updates only the cards list, preserving focus and selection
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      const val = e.target.value;
      updateState({ searchQuery: val });
      if (searchClear) {
        searchClear.style.display = val ? 'flex' : 'none';
      }
      if (cardsContainer) {
        cardsContainer.innerHTML = renderCardsListHtml();
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      updateState({ searchQuery: '' });
      searchClear.style.display = 'none';
      if (cardsContainer) {
        cardsContainer.innerHTML = renderCardsListHtml();
      }
    });
  }

  // 2. Category pill filters
  const pillsContainer = document.getElementById('sp-category-pills');
  if (pillsContainer) {
    pillsContainer.addEventListener('click', e => {
      const btn = e.target.closest('.sp-pill');
      if (!btn) return;
      const cat = btn.dataset.cat;
      if (!cat) return;

      updateState({ activeCategory: cat });
      // Update active class on pills
      pillsContainer.querySelectorAll('.sp-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.cat === cat);
      });
      if (cardsContainer) {
        cardsContainer.innerHTML = renderCardsListHtml();
      }
    });
  }

  // 3. Active site banner filter & Enable tabs CTA
  const domainBanner = document.getElementById('sp-active-domain-banner');
  if (domainBanner) {
    domainBanner.addEventListener('click', () => {
      const dName = extractDomainName(panelState.activeTabDomain);
      if (dName) {
        if (searchInput) searchInput.value = dName;
        updateState({ searchQuery: dName });
        if (searchClear) searchClear.style.display = 'flex';
        if (cardsContainer) cardsContainer.innerHTML = renderCardsListHtml();
      }
    });
  }

  const enableTabsBanner = document.getElementById('sp-enable-tabs-banner') || document.getElementById('sp-btn-enable-tabs');
  if (enableTabsBanner) {
    enableTabsBanner.addEventListener('click', async e => {
      e.stopPropagation();
      const granted = await requestPermission('tabs');
      if (granted) {
        updateState({ hasTabsPermission: true, currentSiteEnabled: true });
        updateActiveTabDomain();
        renderApp();
      } else {
        showToast(t('toasts.tabs_permission_denied'));
      }
    });
  }

  // 4. Card event delegation (view, autofill, copy-user, copy-pwd)
  if (cardsContainer) {
    cardsContainer.addEventListener('click', async e => {
      // Empty state add button
      const emptyBtn = e.target.closest('#sp-empty-btn-add');
      if (emptyBtn) {
        clearFormDraft();
        updateState({ activeTab: 'item-details', selectedItem: null, isProjectSwitcherOpen: false });
        renderApp();
        return;
      }

      const card = e.target.closest('.sp-card');
      if (!card) return;
      const id = card.dataset.id;
      const item = state.items.find(i => i.id === id);
      if (!item) return;

      const actionBtn = e.target.closest('[data-action]');
      const action = actionBtn ? actionBtn.dataset.action : 'view';

      if (action === 'view') {
        clearFormDraft();
        updateState({ activeTab: 'item-details', selectedItem: item, isProjectSwitcherOpen: false });
        renderApp();
      } else if (action === 'autofill') {
        await triggerAutofill(item);
      } else if (action === 'copy-user') {
        copyToClipboard(item.username || '');
        showToast(t('toasts.copied'));
      } else if (action === 'copy-pwd') {
        copyToClipboard(item.password || '');
        showToast(t('toasts.pwd_copied'));
        if (typeof chrome !== 'undefined' && chrome.alarms) {
          chrome.alarms.create('clearClipboardAlarm', { delayInMinutes: 0.5 });
        }
      }
    });

    // Delegated favicon error handling without inline onerror
    cardsContainer.addEventListener('error', e => {
      if (e.target && e.target.classList.contains('sp-card-favicon')) {
        e.target.style.display = 'none';
        const fallback = e.target.nextElementSibling;
        if (fallback && fallback.classList.contains('sp-card-fallback-letter')) {
          fallback.style.display = 'inline-block';
        }
      }
    }, true);
  }
}

/**
 * Executes autofill for an item with immediate origin and tabs permission checks.
 */
export async function triggerAutofill(item, forceFill = false) {
  const itemUrl = item.url || item.domain || '';
  const itemDomain = extractCleanDomain(itemUrl);

  // 1. Request origin host permission for target domain immediately to preserve user gesture
  const patterns = getDomainOriginPatterns(itemDomain);
  if (patterns.length > 0) {
    const granted = await requestOriginPermissions(patterns);
    if (!granted) {
      copyToClipboard(item.password);
      showToast(t('toasts.autofill_copied'));
      return;
    }
  }

  // 2. Check & request tabs permission if needed
  if (!state.hasTabsPermission) {
    const granted = await requestPermission('tabs');
    if (granted) {
      updateState({ hasTabsPermission: true });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && panelState.activeTabId) {
    chrome.runtime.sendMessage(
      {
        action: 'AUTOFILL_LOGIN',
        tabId: panelState.activeTabId,
        username: item.username,
        password: item.password,
        forceFill
      },
      async response => {
        if (chrome.runtime?.lastError) {
          copyToClipboard(item.password);
          showToast(t('toasts.autofill_copied'));
          return;
        }
        if (response && response.success) {
          showToast(t('toasts.form_autofilled'));
        } else if (response && response.reason === 'no_tab_access') {
          const granted = await requestPermission('tabs');
          if (granted) {
            updateState({ hasTabsPermission: true });
            triggerAutofill(item, forceFill);
          } else {
            copyToClipboard(item.password);
            showToast(t('toasts.autofill_copied'));
          }
        } else if (response && response.reason === 'domain_mismatch') {
          const tabDomain = response.tabDomain || 'current site';
          const itemDomain = response.itemDomain || 'this item';
          const confirmed = confirm(
            t('toasts.domain_mismatch_warning', {
              tabDomain,
              itemDomain
            })
          );
          if (confirmed) {
            triggerAutofill(item, true);
          } else {
            copyToClipboard(item.password);
            showToast(t('toasts.autofill_copied'));
          }
        } else {
          copyToClipboard(item.password);
          showToast(t('toasts.autofill_copied'));
        }
      }
    );
  } else {
    copyToClipboard(item.password);
    showToast(t('toasts.autofill_copied'));
  }
}
