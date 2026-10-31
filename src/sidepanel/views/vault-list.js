/**
 * SimplePass Manager - Vault List View & Card Template Component
 * Features scoped card rendering to preserve search focus and scroll position.
 */

import { state, getActiveProjectItems } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';
import {
  extractCleanDomain,
  extractDomainName,
  isItemMatchingDomain,
  sortItemsByDomainMatch
} from '../../core/domain.js';
import {
  getCategoryColorDef,
  getCategoryCssVars,
  getItemTags
} from '../../core/categories.js';

/**
 * Generates the HTML for category filter pills.
 * @returns {string}
 */
export function renderCategoryPillsHtml() {
  return state.categories
    .map(c => {
      const isAll = c === 'All';
      const label = isAll ? t('categories.All') : (c === 'Work' ? t('categories.Work') : (c === 'Personal' ? t('categories.Personal') : c));
      if (isAll) {
        return `<button class="sp-pill sp-pill-all ${c === state.activeCategory ? 'active' : ''}" data-cat="${c}">${label}</button>`;
      }
      const colorDef = getCategoryColorDef(c, state.categoryColors);
      const cssVars = getCategoryCssVars(colorDef);
      return `
        <button class="sp-pill ${c === state.activeCategory ? 'active' : ''}" data-color-pill="true" data-cat="${c}" style="${cssVars}">
          <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
          <span>${label}</span>
        </button>
      `;
    })
    .join('');
}

/**
 * Generates the HTML for the active domain notice banner.
 * @returns {string}
 */
export function renderActiveDomainNoticeHtml() {
  const projectItems = getActiveProjectItems();
  const domain = panelState.activeTabDomain;

  if (domain) {
    const domainMatches = projectItems.filter(i => isItemMatchingDomain(i, domain));
    const displayDomain = extractDomainName(domain);
    if (domainMatches.length > 0 && displayDomain) {
      return `
        <div id="sp-active-domain-banner" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 6px 12px; margin: 8px 14px 0; border-radius: var(--radius-sm); font-size: 11px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.15s ease;" title="${t('vault.filter_domain_title')}">
          <span style="color: var(--text-main); font-weight: 600; display:flex; align-items:center; gap:6px;">
            <span style="color:var(--accent);">${icons.iGlobe}</span> ${t('vault.current_site')}: <b>${escapeHtml(displayDomain)}</b> (${domainMatches.length})
          </span>
          <button class="sp-btn-icon" id="sp-filter-domain" style="width:20px;height:20px;" title="${t('vault.filter_domain_title')}">${icons.iSearch}</button>
        </div>
      `;
    }
  } else if (!state.hasTabsPermission && state.currentSiteEnabled) {
    return `
      <div id="sp-enable-tabs-banner" style="background: var(--bg-surface); border: 1px dashed var(--accent, #6366f1); padding: 7px 12px; margin: 8px 14px 0; border-radius: var(--radius-sm); font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer;">
        <span style="display:flex; align-items:center; gap:6px; color:var(--text-main);">
          <span style="color:var(--accent, #6366f1);">${icons.iGlobe}</span>
          <span>${t('vault.enable_site_detection_desc')}</span>
        </span>
        <button type="button" class="sp-btn-primary" id="sp-btn-enable-tabs" style="padding: 3px 8px; font-size: 10px; height: auto; white-space: nowrap;">
          ${t('vault.enable_site_detection_btn')}
        </button>
      </div>
    `;
  }
  return '';
}

/**
 * Generates the cards list HTML from current state filters.
 * @returns {string}
 */
export function renderCardsListHtml() {
  const query = state.searchQuery.toLowerCase().trim();
  const cat = state.activeCategory;
  const projectItems = getActiveProjectItems();

  const filteredItems = projectItems.filter(item => {
    const itemTags = getItemTags(item);
    const matchesCat = cat === 'All' || itemTags.includes(cat) || item.category === cat;
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.domain && item.domain.toLowerCase().includes(query)) ||
      (item.username && item.username.toLowerCase().includes(query)) ||
      (item.url && item.url.toLowerCase().includes(query)) ||
      itemTags.some(t => t.toLowerCase().includes(query));
    return matchesCat && matchesQuery;
  });

  const sortedItems = sortItemsByDomainMatch(filteredItems, panelState.activeTabDomain);

  if (sortedItems.length === 0) {
    return `
      <div class="sp-empty-state">
        <div class="sp-empty-icon">${icons.iKey}</div>
        <p style="font-size: 13px; font-weight: 600;">${t('vault.empty_title')}</p>
        <p style="font-size: 11px;">${t('vault.empty_desc')}</p>
        <button type="button" class="sp-btn-add-pwd" id="sp-empty-btn-add" style="margin-top:8px;">
          ${icons.iPlus}
          <span>${t('nav.add_password')}</span>
        </button>
      </div>
    `;
  }

  return sortedItems
    .map(item => {
      const letter = item.title ? item.title[0] : '?';
      const isMatched = isItemMatchingDomain(item, panelState.activeTabDomain);
      const itemDomain = item.domain || extractCleanDomain(item.url);
      const itemDomainNoPort = itemDomain ? itemDomain.split(':')[0] : '';
      const itemFavicon = state.showFavicons
        ? (item.favicon || (itemDomain && panelState.cachedFavicons[itemDomain]) || (itemDomainNoPort && panelState.cachedFavicons[itemDomainNoPort]))
        : null;
      const avatarContent = itemFavicon
        ? `<img src="${escapeHtml(itemFavicon)}" class="sp-card-favicon" alt="" /><span class="sp-card-fallback-letter" style="display:none;">${letter}</span>`
        : `<span>${letter}</span>`;

      let tagsHtml = '';
      if (state.showCardTags) {
        const itemTags = getItemTags(item);
        tagsHtml = itemTags
          .map(tName => {
            const colorDef = getCategoryColorDef(tName, state.categoryColors);
            const cssVars = getCategoryCssVars(colorDef);
            const label = tName === 'Work' ? t('categories.Work') : (tName === 'Personal' ? t('categories.Personal') : tName);
            return `<span class="sp-pill sp-pill-tag-card" data-color-pill="true" style="${cssVars}; pointer-events:none;"><span class="sp-pill-dot" style="background-color:${colorDef.color};"></span><span>${escapeHtml(label)}</span></span>`;
          })
          .join('');
      }

      return `
        <div class="sp-card ${isMatched ? 'sp-card-matched' : ''}" data-id="${item.id}">
          <div class="sp-card-left" data-action="view">
            <div class="sp-card-avatar">${avatarContent}</div>
            <div class="sp-card-meta">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="sp-card-title">${escapeHtml(item.title)}</span>
                ${tagsHtml}
              </div>
              <span class="sp-card-sub">${escapeHtml(item.username || item.url || t('vault.no_login'))}</span>
            </div>
          </div>
          <div class="sp-card-actions">
            <button class="sp-btn-icon" data-action="autofill" title="${panelState.isAutofillSupported ? t('vault.autofill_action') : t('vault.autofill_unsupported')}" ${!panelState.isAutofillSupported ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''}>${icons.iZap}</button>
            <button class="sp-btn-icon" data-action="copy-user" title="${t('vault.copy_user')}">${icons.iCopy}</button>
            <button class="sp-btn-icon" data-action="copy-pwd" title="${t('vault.copy_pwd')}">${icons.iKey}</button>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Full Vault View template (structure with stable container IDs).
 * @returns {string}
 */
export function renderVaultView() {
  return `
    <div class="sp-search-bar">
      <div class="sp-search-input-wrap">
        <span class="sp-search-icon">${icons.iSearch}</span>
        <input type="text" id="sp-search-input" class="sp-search-input" placeholder="${t('vault.search_placeholder')}" value="${escapeHtml(state.searchQuery)}" />
        <button class="sp-search-clear" id="sp-search-clear" style="display: ${state.searchQuery ? 'flex' : 'none'};">${icons.iX}</button>
      </div>
      <div class="sp-category-pills" id="sp-category-pills">
        ${renderCategoryPillsHtml()}
      </div>
    </div>
    <div id="sp-vault-domain-notice">
      ${renderActiveDomainNoticeHtml()}
    </div>
    <div class="sp-vault-list" id="sp-vault-cards-container">
      ${renderCardsListHtml()}
    </div>
  `;
}
