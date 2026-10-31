/**
 * SimplePass Manager - Modals & Panels View Component
 */

import { state, getActiveProject } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';

export function renderProjectSwitcherPanel() {
  const activeProj = getActiveProject();

  const projectItemsHtml = state.projects
    .map(p => {
      const isActive = activeProj && activeProj.id === p.id;
      const count = state.items.filter(item => item.projectId === p.id).length;
      const typeBadge = p.type === 'pass_cli'
        ? `<span class="sp-badge-pass">${t('settings.badge_pass_cli')}</span>`
        : `<span class="sp-badge-browser">${t('settings.badge_browser')}</span>`;

      return `
      <div class="sp-project-item ${isActive ? 'active' : ''}" data-project-id="${p.id}">
        <div class="sp-project-item-left" data-action="select-project" data-project-id="${p.id}">
          <div class="sp-radio-indicator"></div>
          <div class="sp-project-info">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="sp-project-name">${escapeHtml(p.name)}</span>
              ${typeBadge}
            </div>
            <span class="sp-project-meta">${count} ${t('nav.passwords').toLowerCase()}</span>
          </div>
        </div>
        <div class="sp-project-item-actions">
          ${
            p.type === 'pass_cli'
              ? `<button class="sp-btn-icon" data-action="sync-pass-project" data-project-id="${p.id}" title="${t('settings.sync_pass_btn')}">${icons.iRefresh}</button>`
              : ''
          }
          <button class="sp-btn-icon" data-action="rename-project" data-project-id="${p.id}" title="${t('settings.change_pwd_btn')}">${icons.iEdit}</button>
          ${
            state.projects.length > 1
              ? `<button class="sp-btn-icon" data-action="delete-project" data-project-id="${p.id}" title="${t('form.delete_btn')}">${icons.iTrash}</button>`
              : ''
          }
        </div>
      </div>
    `;
    })
    .join('');

  return `
    <div class="sp-project-switcher-panel ${state.isProjectSwitcherOpen ? 'open' : ''}" id="sp-project-panel">
      <div class="sp-panel-header">
        <span class="sp-panel-title">${icons.iFolder} ${t('project_switcher.title')}</span>
        <button class="sp-btn-icon" id="sp-close-project-panel" title="${t('nav.close')}">${icons.iX}</button>
      </div>

      <div class="sp-project-list">
        ${projectItemsHtml}
      </div>

      <div class="sp-new-project-card">
        <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:8px;">
          ${t('project_switcher.create_new')}
        </span>
        <form id="sp-create-project-form" style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:8px;">
            <input type="text" id="sp-new-project-name" class="sp-input" placeholder="${t('project_switcher.name_placeholder')}" required style="flex:1;" />
            <button type="submit" class="sp-btn-primary" style="padding:8px 12px; white-space:nowrap;">
              ${icons.iPlus} ${t('project_switcher.create_btn')}
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:12px; margin-top:2px;">
            <label style="font-size:11px; color:var(--text-dim); display:flex; align-items:center; gap:4px; cursor:pointer;">
              <input type="radio" name="sp-new-project-type" value="browser" checked style="accent-color:var(--text-main);" />
              <span>${t('project_switcher.browser_type')}</span>
            </label>
            <label style="font-size:11px; color:var(--text-dim); display:flex; align-items:center; gap:4px; cursor:pointer;" title="${t('project_switcher.pass_type_title')}">
              <input type="radio" name="sp-new-project-type" value="pass_cli" style="accent-color:var(--text-main);" />
              <span>${t('project_switcher.pass_type')}</span>
            </label>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderDeleteModal() {
  if (!state.projectToDelete) return '';

  const proj = state.projectToDelete;
  const count = state.items.filter(item => item.projectId === proj.id).length;

  return `
    <div class="sp-modal-overlay" id="sp-delete-modal-overlay">
      <div class="sp-modal-content">
        <div class="sp-modal-header">
          <span class="sp-modal-title">${icons.iTrash} ${t('delete_modal.title')}</span>
          <button class="sp-btn-icon" id="sp-modal-cancel-btn" title="${t('nav.close')}">${icons.iX}</button>
        </div>

        <div class="sp-modal-danger-box">
          <strong>${t('delete_modal.warning_title')}</strong><br>
          ${t('delete_modal.desc', { name: escapeHtml(proj.name), count })}
        </div>

        <form id="sp-delete-project-form" style="display:flex; flex-direction:column; gap:10px;">
          <div class="sp-form-group">
            <label class="sp-label">${t('form.title_label')}: «<strong>${escapeHtml(proj.name)}</strong>»:</label>
            <input type="text" id="sp-delete-confirm-name" class="sp-input" placeholder="${escapeHtml(proj.name)}" required />
          </div>

          <div class="sp-form-group">
            <label class="sp-label">${t('settings.master_pwd_label')}:</label>
            <input type="password" id="sp-delete-confirm-pwd" class="sp-input" placeholder="${t('settings.master_pwd_label')}" required />
          </div>

          <div id="sp-delete-modal-error" style="display:none; font-size:11px; color:var(--danger);"></div>

          <div style="display:flex; gap:8px; margin-top:4px;">
            <button type="button" class="sp-btn-secondary" id="sp-modal-close-btn" style="flex:1; justify-content:center;">
              ${t('delete_modal.cancel_btn')}
            </button>
            <button type="submit" class="sp-btn-danger" style="flex:1; justify-content:center;">
              ${t('delete_modal.confirm_btn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderPassInstructionsModal() {
  if (!state.isShowPassInstructions) return '';

  return `
    <div class="sp-modal-overlay" id="sp-pass-instructions-overlay">
      <div class="sp-modal-content" style="max-width: 360px;">
        <div class="sp-modal-header">
          <span class="sp-modal-title" style="color:var(--text-main);">${icons.iFolder} ${t('pass_modal.title')}</span>
          <button class="sp-btn-icon" id="sp-btn-close-pass-instructions">${icons.iX}</button>
        </div>

        <p class="sp-modal-desc">
          ${t('pass_modal.desc')}
        </p>

        <div style="display:flex; flex-direction:column; gap:8px; font-size:11px;">
          <div><strong>${t('pass_modal.step1')}</strong></div>
          <div class="sp-code-block">brew install pass gnupg</div>

          <div><strong>${t('pass_modal.step2')}</strong></div>
          <div class="sp-code-block">cd /Users/dima/Projects/SimplePassManager/native-host &amp;&amp; ./install.sh</div>

          <div><strong>${t('pass_modal.step3')}</strong></div>
          <div style="color:var(--text-dim); line-height:1.4;">
            ${t('pass_modal.step3_desc')}
          </div>
        </div>

        <button type="button" class="sp-btn-primary" id="sp-btn-ack-pass-instructions" style="justify-content:center; margin-top:6px;">
          ${t('pass_modal.got_it')}
        </button>
      </div>
    </div>
  `;
}

export function renderRecoveryBackupModal() {
  if (!panelState.newlyCreatedRecoveryPhrase) return '';

  const words = panelState.newlyCreatedRecoveryPhrase.split(' ');
  const wordsGridHtml = words.map((w, idx) => `
    <div class="sp-recovery-word-card">
      <span class="sp-recovery-word-num">${idx + 1}.</span>
      <span class="sp-recovery-word-val">${escapeHtml(w)}</span>
    </div>
  `).join('');

  return `
    <div class="sp-modal-overlay" id="sp-recovery-backup-overlay" style="z-index: 300;">
      <div class="sp-modal-content" style="max-width: 360px;">
        <div class="sp-modal-header">
          <span class="sp-modal-title" style="color:var(--text-main);">${icons.iKey} ${t('recovery_modal.title')}</span>
          <button class="sp-btn-icon" id="sp-recovery-modal-close" title="${t('nav.close')}">${icons.iX}</button>
        </div>

        <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
          ${t('recovery_modal.desc')}
        </p>

        <div class="sp-recovery-grid">
          ${wordsGridHtml}
        </div>

        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="sp-btn-secondary" id="sp-btn-copy-recovery-phrase" style="flex:1; justify-content:center; font-size:12px;">
            ${icons.iCopy} ${t('recovery_modal.copy_btn')}
          </button>
          <button class="sp-btn-secondary" id="sp-btn-download-recovery-phrase" style="flex:1; justify-content:center; font-size:12px;">
            ${icons.iDownload} ${t('recovery_modal.download_btn')}
          </button>
        </div>

        <button class="sp-btn-primary" id="sp-btn-confirm-recovery-saved" style="width:100%; justify-content:center; margin-top:12px;">
          ${icons.iCheck} ${t('recovery_modal.confirm_btn')}
        </button>
      </div>
    </div>
  `;
}

export function renderExportModal() {
  if (!panelState.exportModalData) return '';
  const isBackup = panelState.exportModalData.format === 'spbackup';

  if (isBackup) {
    return `
      <div class="sp-modal-overlay" id="sp-export-modal-overlay">
        <div class="sp-modal-content" style="max-width:360px;">
          <div class="sp-modal-header">
            <span class="sp-modal-title" style="color:var(--text-main);">${icons.iLock} ${t('settings.export_spbackup_opt')}</span>
            <button class="sp-btn-icon" id="sp-export-modal-close" title="${t('nav.close')}">${icons.iX}</button>
          </div>
          <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
            ${t('settings.export_backup_pwd_label')}
          </p>
          <form id="sp-export-backup-form" style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
            <input type="password" id="sp-export-backup-pwd" class="sp-input" placeholder="${t('settings.export_backup_pwd_label')}" required autofocus />
            <div id="sp-export-modal-err" style="display:none; font-size:11px; color:var(--danger);"></div>
            <div style="display:flex; gap:8px; margin-top:6px;">
              <button type="button" class="sp-btn-secondary" id="sp-export-modal-cancel" style="flex:1; justify-content:center;">
                ${t('form.cancel_btn')}
              </button>
              <button type="submit" class="sp-btn-primary" style="flex:1; justify-content:center;">
                ${icons.iDownload} ${t('settings.csv_export_btn')}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Plaintext export confirmation modal
  return `
    <div class="sp-modal-overlay" id="sp-export-modal-overlay">
      <div class="sp-modal-content" style="max-width:360px;">
        <div class="sp-modal-header">
          <span class="sp-modal-title" style="color:var(--danger);">${icons.iAlertCircle || '⚠️'} ${t('settings.export_warning_title')}</span>
          <button class="sp-btn-icon" id="sp-export-modal-close" title="${t('nav.close')}">${icons.iX}</button>
        </div>
        <div class="sp-modal-danger-box">
          ${t('settings.export_warning_desc')}
        </div>
        <form id="sp-export-plaintext-form" style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
          <div class="sp-form-group">
            <label class="sp-label">${t('settings.export_confirm_pwd_label')}</label>
            <input type="password" id="sp-export-confirm-pwd" class="sp-input" placeholder="${t('settings.master_pwd_label')}" required autofocus />
          </div>
          <div id="sp-export-modal-err" style="display:none; font-size:11px; color:var(--danger);"></div>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <button type="button" class="sp-btn-secondary" id="sp-export-modal-cancel" style="flex:1; justify-content:center;">
              ${t('form.cancel_btn')}
            </button>
            <button type="submit" class="sp-btn-danger" style="flex:1; justify-content:center;">
              ${icons.iDownload} ${panelState.exportModalData.format.toUpperCase()}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderImportBackupModal() {
  if (!panelState.importBackupData) return '';
  return `
    <div class="sp-modal-overlay" id="sp-import-backup-overlay">
      <div class="sp-modal-content" style="max-width:360px;">
        <div class="sp-modal-header">
          <span class="sp-modal-title" style="color:var(--text-main);">${icons.iLock} ${t('settings.import_backup_pwd_label')}</span>
          <button class="sp-btn-icon" id="sp-import-backup-close" title="${t('nav.close')}">${icons.iX}</button>
        </div>
        <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
          ${t('settings.import_backup_pwd_label')}
        </p>
        <form id="sp-import-backup-form" style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
          <input type="password" id="sp-import-backup-pwd" class="sp-input" placeholder="${t('settings.import_backup_pwd_label')}" required autofocus />
          <div id="sp-import-backup-err" style="display:none; font-size:11px; color:var(--danger);"></div>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <button type="button" class="sp-btn-secondary" id="sp-import-backup-cancel" style="flex:1; justify-content:center;">
              ${t('form.cancel_btn')}
            </button>
            <button type="submit" class="sp-btn-primary" style="flex:1; justify-content:center;">
              ${icons.iUnlock} ${t('auth.unlock_btn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderAllModals() {
  return `
    ${renderProjectSwitcherPanel()}
    ${renderDeleteModal()}
    ${renderPassInstructionsModal()}
    ${renderRecoveryBackupModal()}
    ${renderExportModal()}
    ${renderImportBackupModal()}
  `;
}
