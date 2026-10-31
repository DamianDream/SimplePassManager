/**
 * SimplePass Manager - Header, Drawer & Footer Navigation Handlers
 */

import { panelState, clearFormDraft } from '../panel-state.js';
import { state, updateState, lockVault } from '../../core/state.js';

export function attachHeaderHandlers({ renderApp }) {
  // Drawer open / close
  const burgerBtn = document.getElementById('sp-burger-btn');
  const closeDrawerBtn = document.getElementById('sp-close-drawer-btn');
  const drawerOverlay = document.getElementById('sp-drawer-overlay');

  if (burgerBtn) {
    burgerBtn.addEventListener('click', () => {
      panelState.isDrawerOpen = true;
      renderApp();
    });
  }

  [closeDrawerBtn, drawerOverlay].forEach(el => {
    if (el) {
      el.addEventListener('click', () => {
        panelState.isDrawerOpen = false;
        renderApp();
      });
    }
  });

  // Drawer navigation items
  document.querySelectorAll('.sp-drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetNav = btn.dataset.nav;
      panelState.isDrawerOpen = false;
      if (targetNav === 'settings') {
        panelState.settingsSearchQuery = '';
      }
      if (state.activeTab === 'item-details' && targetNav !== 'item-details') {
        clearFormDraft();
      }
      updateState({ activeTab: targetNav, selectedItem: null, isProjectSwitcherOpen: false });
    });
  });

  // Add password button in header
  const btnAdd = document.getElementById('sp-btn-add');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'item-details', selectedItem: null });
    });
  }

  // Lock vault button in header
  const btnLock = document.getElementById('sp-btn-lock');
  if (btnLock) {
    btnLock.addEventListener('click', () => {
      lockVault();
    });
  }

  // Project Switcher Trigger in Footer
  const projectContainer = document.getElementById('sp-project-container');
  if (projectContainer) {
    projectContainer.addEventListener('click', () => {
      updateState({ isProjectSwitcherOpen: !state.isProjectSwitcherOpen });
    });
  }
}
