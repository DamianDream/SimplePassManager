/**
 * SimplePass Manager - Security Health Audit View (F3 - Experimental)
 */

import { state, getActiveProject, getActiveProjectItems } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';
import { runSecurityAudit } from '../../core/security-audit.js';
import { getItemTags } from '../../core/categories.js';

export function renderSecurityView() {
  const activeItems = getActiveProjectItems();
  const report = panelState.securityAuditReport || runSecurityAudit(activeItems);

  // Filter items according to search, tag and risk filter
  const query = (panelState.securitySearchQuery || '').toLowerCase().trim();
  const activeTag = panelState.securityActiveTag || 'All';
  const riskFilter = panelState.securityActiveRiskFilter || 'all';

  const filteredResults = report.auditedItems.filter(res => {
    const item = res.item;
    const itemTags = getItemTags(item);

    // Tag filter
    if (activeTag !== 'All' && !itemTags.includes(activeTag) && item.category !== activeTag) {
      return false;
    }

    // Risk level filter
    if (riskFilter === 'reused' && !res.isReused) return false;
    if (riskFilter === 'weak' && !res.isWeak) return false;
    if (riskFilter === 'old' && !res.isOld) return false;
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
  let scoreColor = 'var(--success)';
  let scoreBadgeClass = 'sp-badge-success';
  if (report.healthScore < 50) {
    scoreColor = 'var(--danger)';
    scoreBadgeClass = 'sp-badge-danger';
  } else if (report.healthScore < 80) {
    scoreColor = '#f59e0b';
    scoreBadgeClass = 'sp-badge-warning';
  }

  // Categories list for tag chips
  const tagsList = ['All', ...state.categories.filter(c => c !== 'All')];

  const cardsHtml =
    filteredResults.length > 0
      ? filteredResults
          .map(res => {
            const item = res.item;
            let statusPill = '';
            if (res.isReused) {
              statusPill = `<span class="sp-badge-danger" style="display:inline-flex; align-items:center; gap:4px; font-size:10px;">🔴 ${t('security.risk_reused', { count: res.reusedCount })}</span>`;
            } else if (res.isWeak) {
              statusPill = `<span class="sp-badge-warning" style="display:inline-flex; align-items:center; gap:4px; font-size:10px; background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3);">🟠 ${t('security.risk_weak')}</span>`;
            } else if (res.isOld) {
              statusPill = `<span class="sp-badge-info" style="display:inline-flex; align-items:center; gap:4px; font-size:10px; color:#eab308; background:rgba(234,179,8,0.12); border:1px solid rgba(234,179,8,0.25);">🟡 ${t('security.risk_old')}</span>`;
            } else {
              statusPill = `<span class="sp-badge-success" style="display:inline-flex; align-items:center; gap:4px; font-size:10px;">🟢 ${t('security.risk_strong')}</span>`;
            }

            return `
              <div class="sp-card" style="margin-bottom:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                  <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    ${item.favicon ? `<img src="${escapeHtml(item.favicon)}" style="width:16px; height:16px; border-radius:3px; object-fit:contain;" alt="" />` : `<span style="color:var(--text-dim); display:flex;">${icons.iKey}</span>`}
                    <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${escapeHtml(item.title || 'Untitled')}
                    </span>
                  </div>
                  <div style="flex-shrink:0;">
                    ${statusPill}
                  </div>
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
      <!-- Security View Top Bar with Quick Audit Trigger -->
      <div style="padding: 12px 16px 8px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:var(--primary); display:flex;">${icons.iShield}</span>
            <span style="font-size:14px; font-weight:700; color:var(--text-main);">${t('security.title')}</span>
            <span class="sp-badge-info" style="font-size:9px; padding:2px 5px; text-transform:uppercase;">${t('security.experimental')}</span>
          </div>
          <button type="button" class="sp-btn-primary ${panelState.isAuditing ? 'sp-spin' : ''}" id="sp-btn-run-audit" style="padding:5px 10px; font-size:11px;">
            ${icons.iShield}
            <span>${t('security.run_audit_btn')}</span>
          </button>
        </div>

        <!-- Health Score & Metrics Card -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:42px; height:42px; border-radius:50%; border:3px solid ${scoreColor}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; color:${scoreColor}; flex-shrink:0;">
              ${report.healthScore}%
            </div>
            <div>
              <div style="font-size:12px; font-weight:600; color:var(--text-main);">${t('security.health_score')}</div>
              <div style="font-size:10px; color:var(--text-dim);">${t('security.audited_count', { count: report.total })}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
            <span class="sp-badge-danger" style="font-size:10px; padding:2px 6px;">🔴 ${report.reusedCount}</span>
            <span class="sp-badge-warning" style="font-size:10px; padding:2px 6px; background:rgba(245,158,11,0.15); color:#f59e0b;">🟠 ${report.weakCount}</span>
            <span class="sp-badge-info" style="font-size:10px; padding:2px 6px; color:#eab308; background:rgba(234,179,8,0.12);">🟡 ${report.oldCount}</span>
            <span class="sp-badge-success" style="font-size:10px; padding:2px 6px;">🟢 ${report.strongCount}</span>
          </div>
        </div>
      </div>

      <!-- Scrollable Main Container -->
      <div style="flex:1; overflow-y:auto; padding:10px 16px; display:flex; flex-direction:column; gap:10px;">
        <!-- Color Legend Block -->
        <div class="sp-settings-item ${panelState.isSecurityLegendOpen ? 'open' : ''}" style="margin-bottom:4px; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); overflow:hidden;">
          <button type="button" class="sp-settings-item-header" id="sp-btn-toggle-legend" style="padding:8px 12px; font-size:11px; background:var(--bg-surface);">
            <div class="sp-settings-item-left">
              <span class="sp-settings-item-title" style="font-size:11px; font-weight:600;">${t('security.legend_title')}</span>
            </div>
            <span class="sp-settings-item-arrow">${icons.iChevronDown}</span>
          </button>
          ${
            panelState.isSecurityLegendOpen
              ? `
            <div style="padding:10px 12px; background:var(--bg-card); font-size:11px; display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--border-subtle);">
              <div style="display:flex; align-items:flex-start; gap:6px;">
                <span style="flex-shrink:0;">🔴</span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_reused_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_reused_desc')}</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:6px;">
                <span style="flex-shrink:0;">🟠</span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_weak_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_weak_desc')}</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:6px;">
                <span style="flex-shrink:0;">🟡</span>
                <div>
                  <strong style="color:var(--text-main);">${t('security.legend_old_title')}</strong>:
                  <span style="color:var(--text-dim);">${t('security.legend_old_desc')}</span>
                </div>
              </div>
              <div style="display:flex; align-items:flex-start; gap:6px;">
                <span style="flex-shrink:0;">🟢</span>
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
        <div class="sp-search-bar" style="padding:0;">
          <div class="sp-search-input-wrap">
            <span class="sp-search-icon">${icons.iSearch}</span>
            <input type="text" id="sp-security-search" class="sp-search-input" placeholder="${t('security.search_placeholder')}" value="${escapeHtml(panelState.securitySearchQuery || '')}" />
            ${panelState.securitySearchQuery ? `<button class="sp-search-clear" id="sp-security-search-clear">${icons.iX}</button>` : ''}
          </div>
        </div>

        <!-- Tag Filter Pills -->
        <div class="sp-cat-pills-wrap" style="padding:0;">
          <div class="sp-cat-pills-scroll" style="display:flex; gap:6px; overflow-x:auto;">
            ${tagsList
              .map(
                tagName => `
              <button type="button" class="sp-pill ${activeTag === tagName ? 'active' : ''}" data-action="filter-sec-tag" data-tag="${escapeHtml(tagName)}" style="font-size:11px; padding:3px 8px;">
                ${escapeHtml(tagName === 'All' ? t('categories.All') : tagName)}
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Risk Filter Bar -->
        <div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:2px;">
          <button type="button" class="sp-btn-secondary ${riskFilter === 'all' ? 'sp-btn-primary' : ''}" data-action="filter-risk" data-risk="all" style="padding:4px 8px; font-size:10px; border-radius:12px;">
            ${t('security.filter_all')} (${report.total})
          </button>
          <button type="button" class="sp-btn-secondary ${riskFilter === 'reused' ? 'sp-btn-primary' : ''}" data-action="filter-risk" data-risk="reused" style="padding:4px 8px; font-size:10px; border-radius:12px;">
            🔴 ${t('security.filter_reused')} (${report.reusedCount})
          </button>
          <button type="button" class="sp-btn-secondary ${riskFilter === 'weak' ? 'sp-btn-primary' : ''}" data-action="filter-risk" data-risk="weak" style="padding:4px 8px; font-size:10px; border-radius:12px;">
            🟠 ${t('security.filter_weak')} (${report.weakCount})
          </button>
          <button type="button" class="sp-btn-secondary ${riskFilter === 'old' ? 'sp-btn-primary' : ''}" data-action="filter-risk" data-risk="old" style="padding:4px 8px; font-size:10px; border-radius:12px;">
            🟡 ${t('security.filter_old')} (${report.oldCount})
          </button>
          <button type="button" class="sp-btn-secondary ${riskFilter === 'strong' ? 'sp-btn-primary' : ''}" data-action="filter-risk" data-risk="strong" style="padding:4px 8px; font-size:10px; border-radius:12px;">
            🟢 ${t('security.filter_strong')} (${report.strongCount})
          </button>
        </div>

        <!-- Cards List -->
        <div id="sp-security-cards-container">
          ${cardsHtml}
        </div>
      </div>
    </div>
  `;
}
