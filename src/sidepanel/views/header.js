/**
 * SimplePass Manager - Header, Drawer & Footer Component
 */

import { state, getActiveProject, getActiveProjectItems } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';

export function renderHeader() {
  let sectionTitle = t('nav.passwords');
  if (state.activeTab === 'generator') {
    sectionTitle = t('nav.generator');
  } else if (state.activeTab === 'settings') {
    sectionTitle = t('nav.settings');
  } else if (state.activeTab === 'item-details') {
    sectionTitle = state.selectedItem ? t('form.edit_title') : t('form.new_title');
  }

  return `
    <header class="sp-header">
      <div class="sp-header-left">
        <button class="sp-btn-icon" id="sp-burger-btn" title="${t('nav.menu')}">${icons.iMenu}</button>
        <span class="sp-header-title" id="sp-header-title">${escapeHtml(sectionTitle)}</span>
      </div>
      <div class="sp-header-actions">
        <button class="sp-btn-add-pwd" id="sp-btn-add" title="${t('nav.add_password')}">
          ${icons.iPlus}
          <span>${t('nav.add_password')}</span>
        </button>
        <button class="sp-btn-icon" id="sp-btn-lock" title="${t('nav.lock_vault')}">${icons.iLock}</button>
      </div>
    </header>
  `;
}

export function renderDrawer() {
  const activeItems = getActiveProjectItems();
  const isOpen = panelState.isDrawerOpen;

  return `
    <div class="sp-drawer-overlay ${isOpen ? 'open' : ''}" id="sp-drawer-overlay"></div>
    <aside class="sp-drawer ${isOpen ? 'open' : ''}" id="sp-drawer">
      <div class="sp-drawer-header">
        <span class="sp-drawer-heading">${t('nav.menu')}</span>
        <button class="sp-btn-icon" id="sp-close-drawer-btn" title="${t('nav.close')}">${icons.iX}</button>
      </div>
      <nav class="sp-drawer-menu">
        <button class="sp-drawer-item ${state.activeTab === 'vault' ? 'active' : ''}" data-nav="vault">
          <span class="sp-drawer-item-icon">${icons.iKey}</span>
          <span>${t('nav.passwords')}</span>
          <span class="sp-drawer-item-badge">${activeItems.length}</span>
        </button>
        <button class="sp-drawer-item ${state.activeTab === 'generator' ? 'active' : ''}" data-nav="generator">
          <span class="sp-drawer-item-icon">${icons.iDice}</span>
          <span>${t('nav.generator')}</span>
        </button>
        <button class="sp-drawer-item ${state.activeTab === 'settings' ? 'active' : ''}" data-nav="settings">
          <span class="sp-drawer-item-icon">${icons.iSettings}</span>
          <span>${t('nav.settings')}</span>
        </button>
      </nav>
    </aside>
  `;
}

export function renderFooter() {
  const activeProj = getActiveProject();
  const activeItems = getActiveProjectItems();

  return `
    <footer class="sp-footer">
      <div class="sp-footer-left">
        <span>${t('footer.items_count', { count: activeItems.length })}</span>
      </div>
      <div class="sp-footer-right">
        <div class="sp-project-badge ${state.isProjectSwitcherOpen ? 'active' : ''}" id="sp-project-container" title="${t('footer.db_project')}">
          <span class="sp-project-dot"></span>
          <span id="sp-project-display">${activeProj ? escapeHtml(activeProj.name) : '—'}</span>
        </div>
      </div>
    </footer>
  `;
}
