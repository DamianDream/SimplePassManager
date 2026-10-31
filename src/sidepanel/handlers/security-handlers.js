/**
 * SimplePass Manager - Security View Event Handlers (F3)
 */

import { state, updateState, getActiveProjectItems } from '../../core/state.js';
import { panelState } from '../panel-state.js';
import { runSecurityAudit } from '../../core/security-audit.js';
import { showToast } from '../render-utils.js';
import { t } from '../../core/i18n.js';

export function attachSecurityHandlers({ renderApp }) {
  // 1. Quick Audit Run Button
  const btnRunAudit = document.getElementById('sp-btn-run-audit');
  if (btnRunAudit) {
    btnRunAudit.addEventListener('click', async () => {
      panelState.isAuditing = true;
      renderApp();

      setTimeout(() => {
        const activeItems = getActiveProjectItems();
        const report = runSecurityAudit(activeItems);
        panelState.securityAuditReport = report;
        panelState.isAuditing = false;

        const totalIssues = report.reusedCount + report.weakCount;
        showToast(
          t('security.audit_completed', {
            score: report.healthScore,
            issues: totalIssues
          })
        );
        renderApp();
      }, 300);
    });
  }

  // 2. Search Input (Preserves focus)
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

  // 3. Category / Tag filter pills
  document.querySelectorAll('[data-action="filter-sec-tag"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (tag) {
        panelState.securityActiveTag = tag;
        renderApp();
      }
    });
  });

  // 4. Risk filter chips
  document.querySelectorAll('[data-action="filter-risk"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const risk = btn.dataset.risk;
      if (risk) {
        panelState.securityActiveRiskFilter = risk;
        renderApp();
      }
    });
  });

  // 5. Toggle Legend Accordion
  const btnToggleLegend = document.getElementById('sp-btn-toggle-legend');
  if (btnToggleLegend) {
    btnToggleLegend.addEventListener('click', () => {
      panelState.isSecurityLegendOpen = !panelState.isSecurityLegendOpen;
      renderApp();
    });
  }

  // 6. Fix Password Button (opens item-form)
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
