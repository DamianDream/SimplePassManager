/**
 * SimplePass Manager - Security Health Audit View (F3 - Experimental)
 */

import { getActiveProjectItems } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';
import { runSecurityAudit } from '../../core/security-audit.js';

export function renderSecurityView() {
  const activeItems = getActiveProjectItems();
  const report = runSecurityAudit(activeItems);

  // Filter items according to search and risk filter
  const query = (panelState.securitySearchQuery || '').toLowerCase().trim();
  const riskFilter = panelState.securityActiveRiskFilter || 'all';

  const filteredResults = report.auditedItems.filter(res => {
    const item = res.item;

    // Risk level filter
    if (riskFilter === 'reused' && !res.isReused) return false;
    if (riskFilter === 'weak' && !res.isWeak) return false;
    if (riskFilter === 'strong' && res.riskLevel !== 'strong') return false;

    // Search query filter
    if (query) {
      const matchTitle = (item.title || '').toLowerCase().includes(query);
      const matchUser = (item.username || '').toLowerCase().includes(query);
      const matchUrl = (item.url || '').toLowerCase().includes(query);
      const matchDomain = (item.domain || '').toLowerCase().includes(query);
      if (!matchTitle && !matchUser && !matchUrl && !matchDomain) return false;
    }

    return true;
  });

  // Health score color
  let scoreColor = 'var(--accent)';
  if (report.healthScore < 50) {
    scoreColor = 'var(--danger)';
  } else if (report.healthScore < 80) {
    scoreColor = 'var(--warning)';
  }

  const cardsHtml =
    filteredResults.length > 0
      ? filteredResults
          .map(res => {
            const item = res.item;
            let cardRiskClass = 'sp-card-risk-strong';

            if (res.isReused) {
              cardRiskClass = 'sp-card-risk-reused';
            } else if (res.isWeak) {
              cardRiskClass = 'sp-card-risk-weak';
            }

            return `
              <div class="sp-card ${cardRiskClass}" style="margin-bottom:0; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                  ${
                    item.favicon
                      ? `<img src="${escapeHtml(item.favicon)}" style="width:16px; height:16px; border-radius:3px; object-fit:contain;" alt="" />`
                      : `<span style="color:var(--text-dim); display:flex;">${icons.iKey}</span>`
                  }
                  <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(item.title || 'Untitled')}
                  </span>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:var(--text-dim);">
                  <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">
                    ${escapeHtml(item.username || item.domain || item.url || '—')}
                  </span>
                  <button type="button" class="sp-btn-secondary" data-action="fix-security-item" data-id="${escapeHtml(item.id)}" style="padding:3px 8px; font-size:10px;">
                    ${icons.iEdit}
                    <span>${t('security.fix_pwd_btn')}</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join('')
      : `
        <div class="sp-empty-state" style="padding:30px 16px; text-align:center;">
          <div style="font-size:24px; margin-bottom:6px; opacity:0.5;">${icons.iCheck}</div>
          <p style="font-size:12px; font-weight:600; color:var(--text-main);">${t('security.no_issues_found')}</p>
          <p style="font-size:11px; color:var(--text-dim); margin-top:2px;">${t('security.filter_empty_hint')}</p>
        </div>
      `;

  return `
    <div style="display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; flex:1;">
      <!-- Pinned Top Header Pane (Fixed, will not scroll) -->
      <div style="padding:10px 16px 8px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:8px; flex-shrink:0;">
        <!-- Top Row: Experimental Pill Only -->
        <div style="display:flex; align-items:center; justify-content:flex-start;">
          <span class="sp-badge-info" style="font-size:9px; padding:2px 6px; text-transform:uppercase; letter-spacing:0.5px; border-radius:4px;">
            ${t('security.experimental')}
          </span>
        </div>

        <!-- Health Score & Metrics Card -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:38px; height:38px; border-radius:50%; border:3px solid ${scoreColor}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; color:${scoreColor}; flex-shrink:0;">
              ${report.healthScore}%
            </div>
            <div>
              <div style="font-size:12px; font-weight:600; color:var(--text-main);">${t('security.health_score')}</div>
              <div style="font-size:10px; color:var(--text-dim);">${t('security.audited_count', { count: report.total })}</div>
            </div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <span style="display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:var(--text-main);" title="${t('security.filter_reused')}">
              <span class="sp-pill-dot" style="background:var(--danger); box-shadow:0 0 4px var(--danger);"></span>
              ${report.reusedCount}
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:var(--text-main);" title="${t('security.filter_weak')}">
              <span class="sp-pill-dot" style="background:var(--warning); box-shadow:0 0 4px var(--warning);"></span>
              ${report.weakCount}
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:var(--text-main);" title="${t('security.filter_strong')}">
              <span class="sp-pill-dot" style="background:var(--accent); box-shadow:0 0 4px var(--accent);"></span>
              ${report.strongCount}
            </span>
          </div>
        </div>

        <!-- Color Legend Accordion (Collapsed by default) -->
        <div class="sp-settings-item ${panelState.isSecurityLegendOpen ? 'open' : ''}" style="margin:0; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); overflow:hidden;">
          <button type="button" class="sp-settings-item-header" id="sp-btn-toggle-legend" style="padding:6px 10px; font-size:11px; background:var(--bg-surface);">
            <div class="sp-settings-item-left">
              <span class="sp-settings-item-title" style="font-size:11px; font-weight:600;">${t('security.legend_title')}</span>
            </div>
            <span class="sp-settings-item-arrow">${icons.iChevronDown}</span>
          </button>
          ${
            panelState.isSecurityLegendOpen
              ? `
            <div style="padding:8px 10px; background:var(--bg-card); font-size:11px; display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--border-subtle);">
              <div style="display:flex; align-items:flex-start; gap:8px;">
                <span class="sp-pill-dot" style="background:var(--danger); box-shadow:0 0 4px var(--danger); margin-top:4px;"></span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_reused_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_reused_desc')}</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:8px;">
                <span class="sp-pill-dot" style="background:var(--warning); box-shadow:0 0 4px var(--warning); margin-top:4px;"></span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_weak_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_weak_desc')}</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:8px;">
                <span class="sp-pill-dot" style="background:var(--accent); box-shadow:0 0 4px var(--accent); margin-top:4px;"></span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_strong_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_strong_desc')}</span>
                </div>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <!-- Filter Search Bar -->
        <div class="sp-search-bar" style="padding:0; margin:0;">
          <div class="sp-search-input-wrap">
            <span class="sp-search-icon">${icons.iSearch}</span>
            <input type="text" id="sp-security-search" class="sp-search-input" placeholder="${t('security.search_placeholder')}" value="${escapeHtml(panelState.securitySearchQuery || '')}" />
            ${panelState.securitySearchQuery ? `<button class="sp-search-clear" id="sp-security-search-clear">${icons.iX}</button>` : ''}
          </div>
        </div>

        <!-- Risk Filter Pills (Styled matching category tag pills) -->
        <div class="sp-cat-pills-wrap" style="padding:0; margin:0;">
          <div class="sp-cat-pills-scroll" style="display:flex; gap:6px; overflow-x:auto; padding-bottom:2px;">
            <button type="button" class="sp-pill-risk sp-pill-risk-all ${riskFilter === 'all' ? 'active' : ''}" data-action="filter-risk" data-risk="all">
              <span>${t('security.filter_all')}</span>
              <span style="opacity:0.75; font-size:10px;">(${report.total})</span>
            </button>
            <button type="button" class="sp-pill-risk sp-pill-risk-reused ${riskFilter === 'reused' ? 'active' : ''}" data-action="filter-risk" data-risk="reused">
              <span class="sp-pill-dot" style="background:var(--danger); box-shadow:0 0 4px var(--danger);"></span>
              <span>${t('security.filter_reused')}</span>
              <span style="opacity:0.75; font-size:10px;">(${report.reusedCount})</span>
            </button>
            <button type="button" class="sp-pill-risk sp-pill-risk-weak ${riskFilter === 'weak' ? 'active' : ''}" data-action="filter-risk" data-risk="weak">
              <span class="sp-pill-dot" style="background:var(--warning); box-shadow:0 0 4px var(--warning);"></span>
              <span>${t('security.filter_weak')}</span>
              <span style="opacity:0.75; font-size:10px;">(${report.weakCount})</span>
            </button>
            <button type="button" class="sp-pill-risk sp-pill-risk-strong ${riskFilter === 'strong' ? 'active' : ''}" data-action="filter-risk" data-risk="strong">
              <span class="sp-pill-dot" style="background:var(--accent); box-shadow:0 0 4px var(--accent);"></span>
              <span>${t('security.filter_strong')}</span>
              <span style="opacity:0.75; font-size:10px;">(${report.strongCount})</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Dedicated Scrollable Container for Password Cards Only -->
      <div id="sp-security-cards-container" style="flex:1; min-height:0; overflow-y:auto; padding:10px 16px 16px; display:flex; flex-direction:column; gap:8px;">
        ${cardsHtml}
      </div>
    </div>
  `;
}
