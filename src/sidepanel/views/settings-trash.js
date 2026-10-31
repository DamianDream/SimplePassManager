/**
 * SimplePass Manager - Trash View Component (F4)
 */

import { state } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { escapeHtml } from '../render-utils.js';

export function renderTrashSectionContentHtml() {
  const trashItems = state.trash || [];

  if (trashItems.length === 0) {
    return `
      <div style="padding:14px; text-align:center; color:var(--text-dim); font-size:12px;">
        <div style="font-size:24px; margin-bottom:6px; opacity:0.6;">${icons.iTrash}</div>
        <p>${t('trash.empty')}</p>
        <p style="font-size:11px; margin-top:4px; opacity:0.8;">${t('trash.desc')}</p>
      </div>
    `;
  }

  const itemsHtml = trashItems
    .map(item => {
      const deletedAtMs = item.deletedAt ? new Date(item.deletedAt).getTime() : Date.now();
      const ageMs = Date.now() - deletedAtMs;
      const daysLeft = Math.max(1, Math.ceil((30 * 24 * 60 * 60 * 1000 - ageMs) / (24 * 60 * 60 * 1000)));
      const daysLeftLabel = t('trash.days_left', { count: daysLeft });

      return `
        <div class="sp-trash-item" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); margin-bottom:8px;">
          <div style="min-width:0; flex:1;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHtml(item.title || 'Untitled')}
              </span>
              <span class="sp-badge-info" style="font-size:10px; padding:2px 6px;">${daysLeftLabel}</span>
            </div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(item.username || item.domain || item.url || '')}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <button type="button" class="sp-btn-secondary" data-action="restore-trash-item" data-id="${escapeHtml(item.id)}" style="padding:4px 8px; font-size:11px;" title="${t('trash.restore_btn')}">
              ${icons.iRefresh}
              <span>${t('trash.restore_btn')}</span>
            </button>
            <button type="button" class="sp-btn-icon" data-action="delete-perm-trash-item" data-id="${escapeHtml(item.id)}" style="color:var(--danger); padding:4px;" title="${t('trash.delete_perm_btn')}">
              ${icons.iTrash}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
        <p class="sp-setting-desc" style="margin:0; font-size:11px;">${t('trash.desc')}</p>
        <button type="button" class="sp-btn-danger" id="sp-btn-empty-trash" style="padding:4px 8px; font-size:11px; flex-shrink:0; margin-left:8px;">
          ${icons.iTrash}
          <span>${t('trash.empty_btn')}</span>
        </button>
      </div>
      <div style="display:flex; flex-direction:column;">
        ${itemsHtml}
      </div>
    </div>
  `;
}
