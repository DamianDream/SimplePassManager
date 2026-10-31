/**
 * SimplePass Manager - Security View Event Handlers (F3)
 */

import { state, updateState } from '../../core/state.js';
import { panelState } from '../panel-state.js';

export function attachSecurityHandlers({ renderApp }) {
  // 1. Search Input (Preserves focus)
  const searchInput = document.getElementById('sp-security-search');
  const searchClear = document.getElementById('sp-security-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      panelState.securitySearchQuery = e.target.value;
      const sStart = searchInput.selectionStart;
      const sEnd = searchInput.selectionEnd;
      renderApp();

      const newInp = document.getElementById('sp-security-search');
      if (newInp) {
        newInp.focus();
        if (sStart !== null && sEnd !== null) {
          try {
            newInp.setSelectionRange(sStart, sEnd);
          } catch (_) {}
        }
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      panelState.securitySearchQuery = '';
      renderApp();
      const newInp = document.getElementById('sp-security-search');
      if (newInp) newInp.focus();
    });
  }

  // 2. Risk filter pills
  document.querySelectorAll('[data-action="filter-risk"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const risk = btn.dataset.risk;
      if (risk) {
        panelState.securityActiveRiskFilter = risk;
        renderApp();
      }
    });
  });

  // 3. Toggle Legend Accordion
  const btnToggleLegend = document.getElementById('sp-btn-toggle-legend');
  if (btnToggleLegend) {
    btnToggleLegend.addEventListener('click', () => {
      panelState.isSecurityLegendOpen = !panelState.isSecurityLegendOpen;
      renderApp();
    });
  }

  // 4. Fix Password Button (opens item-details form)
  document.querySelectorAll('[data-action="fix-security-item"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = state.items.find(i => i.id === id);
      if (item) {
        updateState({
          activeTab: 'item-details',
          selectedItem: item,
          isEditing: true
        });
      }
    });
  });
}
