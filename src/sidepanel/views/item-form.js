/**
 * SimplePass Manager - Item Form View Component (Add / Edit Password)
 */

import { state, getActiveProject } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';
import {
  extractDomainName,
  isLocalOrPrivateHost
} from '../../core/domain.js';
import {
  getCategoryColorDef,
  getCategoryCssVars,
  getItemTags
} from '../../core/categories.js';

export function renderItemFormView() {
  const activeProj = getActiveProject();
  const isNew = !state.selectedItem;
  const targetFormId = state.selectedItem ? state.selectedItem.id : '__new__';

  const hasValidDraft = panelState.formDraft && (
    (isNew && panelState.formDraft.isNew) ||
    (!isNew && panelState.formDraft.id === state.selectedItem.id)
  );

  if (panelState.currentFormItemId !== targetFormId) {
    panelState.currentFormItemId = targetFormId;
    if (hasValidDraft && Array.isArray(panelState.formDraft.tags)) {
      panelState.formSelectedTags = [...panelState.formDraft.tags];
    } else {
      panelState.formSelectedTags = isNew ? [] : getItemTags(state.selectedItem);
    }
  }

  const defaultProjId = activeProj ? activeProj.id : (state.projects[0] ? state.projects[0].id : 'proj_default');
  const baseItem = state.selectedItem || {
    id: '',
    projectId: defaultProjId,
    title: '',
    username: '',
    password: '',
    url: panelState.activeTabDomain
      ? (panelState.activeTabDomain.includes(':') || isLocalOrPrivateHost(panelState.activeTabDomain) ? `http://${panelState.activeTabDomain}` : `https://${panelState.activeTabDomain}`)
      : '',
    domain: extractDomainName(panelState.activeTabDomain) || '',
    favicon: (panelState.activeTabDomain && panelState.cachedFavicons[panelState.activeTabDomain]) || (panelState.activeTabDomain && panelState.cachedFavicons[panelState.activeTabDomain.split(':')[0]]) || '',
    category: '',
    notes: ''
  };

  const item = hasValidDraft ? {
    id: panelState.formDraft.id,
    projectId: panelState.formDraft.projectId || baseItem.projectId,
    title: panelState.formDraft.title !== undefined ? panelState.formDraft.title : baseItem.title,
    username: panelState.formDraft.username !== undefined ? panelState.formDraft.username : baseItem.username,
    password: panelState.formDraft.password !== undefined ? panelState.formDraft.password : baseItem.password,
    url: panelState.formDraft.url !== undefined ? panelState.formDraft.url : baseItem.url,
    domain: panelState.formDraft.domain !== undefined ? panelState.formDraft.domain : (baseItem.domain || ''),
    favicon: panelState.formDraft.favicon !== undefined ? panelState.formDraft.favicon : (baseItem.favicon || ''),
    category: panelState.formDraft.tags && panelState.formDraft.tags[0] ? panelState.formDraft.tags[0] : (baseItem.category || ''),
    notes: panelState.formDraft.notes !== undefined ? panelState.formDraft.notes : baseItem.notes
  } : baseItem;

  panelState.currentFormItemPassword = item.password || '';

  const currentProjId = item.projectId || defaultProjId;
  const currentProject = state.projects.find(p => p.id === currentProjId) || state.projects[0] || { id: 'proj_default', name: 'main' };

  const formDomain = extractDomainName(item.domain || item.url);
  const formDomainNoPort = formDomain ? formDomain.split(':')[0] : '';
  const formFavicon = state.showFavicons
    ? (item.favicon || (formDomain && panelState.cachedFavicons[formDomain]) || (formDomainNoPort && panelState.cachedFavicons[formDomainNoPort]) || '')
    : '';

  return `
    <div class="sp-view-container">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <button class="sp-btn-secondary" id="sp-form-back" style="padding:6px 10px;">
          ${icons.iX} ${t('form.back')}
        </button>
        <h3 style="font-size:14px; font-weight:700;">${isNew ? t('form.new_title') : t('form.edit_title')}</h3>
        <div style="display:flex; gap:6px;">
          ${!isNew ? `<button type="button" class="sp-btn-secondary" id="sp-form-export-csv" style="padding:6px 10px;" title="${t('vault.export_csv_btn')}">${icons.iDownload}</button>` : ''}
          ${!isNew ? `<button type="button" class="sp-btn-danger" id="sp-form-delete" style="padding:6px 10px;" title="${t('form.delete_btn')}">${icons.iTrash}</button>` : '<div></div>'}
        </div>
      </div>

      ${
        isNew
          ? `
        <div style="background:var(--bg-surface); border:1px dashed var(--border-subtle); border-radius:var(--radius-sm); padding:10px 12px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:12px; font-weight:600; color:var(--text-main);">${t('form.csv_title')}</div>
            <div style="font-size:11px; color:var(--text-dim);">${t('form.csv_sub')}</div>
          </div>
          <label class="sp-btn-secondary" style="padding:5px 10px; font-size:11px; cursor:pointer;">
            ${icons.iDownload} ${t('form.csv_choose_file')}
            <input type="file" id="sp-csv-file-input" accept=".csv,text/csv" style="display:none;" />
          </label>
        </div>
      `
          : ''
      }

      <form id="sp-item-form" novalidate style="display:flex; flex-direction:column; gap:12px;">
        <input type="hidden" id="sp-item-id" value="${item.id}" />

        <div class="sp-form-group">
          <label class="sp-label">${t('footer.db_project')}</label>
          <div class="sp-custom-select-wrap" id="sp-project-select-wrap">
            <input type="hidden" id="sp-item-project" value="${currentProject.id}" />
            <div class="sp-select-trigger" id="sp-project-select-trigger" tabindex="0" role="combobox" aria-expanded="false">
              <span class="sp-select-trigger-text" id="sp-project-select-label">${escapeHtml(currentProject.name)}</span>
              <button type="button" class="sp-input-action-btn" id="sp-project-dropdown-toggle" title="${t('footer.db_project')}" tabindex="-1">
                ${icons.iChevronDown}
              </button>
            </div>
            <div class="sp-select-dropdown" id="sp-project-dropdown" style="display:none;">
              ${state.projects.map(p => {
                const isSelected = p.id === currentProject.id;
                return `
                  <div class="sp-select-option ${isSelected ? 'selected' : ''}" data-action="select-form-project" data-project-id="${p.id}" data-project-name="${escapeHtml(p.name)}">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="color:var(--text-dim); display:flex; align-items:center;">${p.type === 'pass_cli' ? icons.iTerminal : icons.iFolder}</span>
                      <span>${escapeHtml(p.name)}</span>
                    </div>
                    ${isSelected ? `<span style="color:var(--text-main); font-size:12px; display:flex; align-items:center;">${icons.iCheck}</span>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">${t('form.title_label')} *</label>
          <input type="text" id="sp-item-title" class="sp-input" value="${escapeHtml(item.title || '')}" placeholder="${t('form.title_placeholder')}" autocomplete="off" />
          <div class="sp-field-error" id="sp-item-title-error"></div>
        </div>

        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label class="sp-label" style="margin:0; display:flex; align-items:center; gap:6px;">
              ${formFavicon ? `<img id="sp-form-favicon-preview" src="${escapeHtml(formFavicon)}" style="width:14px; height:14px; border-radius:3px; object-fit:contain;" alt="" />` : '<img id="sp-form-favicon-preview" style="width:14px; height:14px; border-radius:3px; object-fit:contain; display:none;" alt="" />'}
              <span>${t('form.url_label')}</span>
            </label>
            ${formDomain ? `<span id="sp-form-domain-badge" style="font-size:10px; color:var(--text-dim);">${escapeHtml(formDomain)}</span>` : '<span id="sp-form-domain-badge" style="font-size:10px; color:var(--text-dim); display:none;"></span>'}
          </div>
          <div class="sp-input-with-action">
            <input type="text" id="sp-item-url" class="sp-input" value="${escapeHtml(item.url || '')}" placeholder="${t('form.url_placeholder')}" style="padding-right: ${state.showFavicons ? '36px' : '10px'};" />
            ${
              state.showFavicons
                ? `
            <button type="button" class="sp-input-action-btn" id="sp-btn-refresh-favicon" title="${t('form.refresh_favicon_title')}">
              ${icons.iRefresh}
            </button>
            `
                : ''
            }
          </div>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">${t('form.login_label')}</label>
          <input type="text" id="sp-item-username" class="sp-input" value="${escapeHtml(item.username || '')}" placeholder="${t('form.login_placeholder')}" />
        </div>

        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label class="sp-label">${t('form.password_label')} *</label>
            <button type="button" class="sp-btn-icon" id="sp-btn-gen-inline" style="width:auto; height:20px; font-size:11px; gap:4px;" title="${t('generator.refresh_title')}">
              ${icons.iDice} ${t('form.generate_btn')}
            </button>
          </div>
          <div class="sp-input-with-action">
            <input type="${panelState.isPasswordVisible ? 'text' : 'password'}" id="sp-item-password" class="sp-input" autocomplete="new-password" spellcheck="false" inputmode="text" style="padding-right: 36px;" />
            <button type="button" class="sp-input-action-btn" id="sp-toggle-pwd-vis">
              ${panelState.isPasswordVisible ? icons.iEyeOff : icons.iEye}
            </button>
          </div>
          <div class="sp-field-error" id="sp-item-password-error"></div>
          ${
            !isNew && item.passwordHistory && item.passwordHistory.length > 0
              ? `
            <div class="sp-pwd-history-wrap" style="margin-top:6px;">
              <button type="button" class="sp-btn-link" id="sp-toggle-pwd-history" style="font-size:11px; display:inline-flex; align-items:center; gap:4px; color:var(--primary); background:none; border:none; padding:2px 0; cursor:pointer;">
                ${icons.iChevronDown}
                <span>${t('form.password_history')} (${item.passwordHistory.length})</span>
              </button>
              <div id="sp-pwd-history-list" style="display:none; margin-top:6px; flex-direction:column; gap:4px;">
                ${item.passwordHistory
                  .map(
                    ph => `
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 8px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-size:11px;">
                    <span style="color:var(--text-dim); font-size:10px;">${new Date(ph.createdAt || ph.lastUsed || Date.now()).toLocaleDateString()}</span>
                    <span style="font-family:monospace; color:var(--text-dim); font-size:11px;">••••••••</span>
                    <div style="display:flex; align-items:center; gap:4px;">
                      <button type="button" class="sp-btn-icon" data-action="copy-history-pwd" data-pwd="${escapeHtml(ph.password)}" style="width:22px; height:22px; padding:3px;" title="${t('vault.copy_password')}">
                        ${icons.iCopy}
                      </button>
                      <button type="button" class="sp-btn-secondary" data-action="restore-history-pwd" data-pwd="${escapeHtml(ph.password)}" style="font-size:10px; padding:2px 6px;">
                        ${t('form.restore_pwd_btn')}
                      </button>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>

        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="sp-label" style="margin:0;">${t('form.category_label')}</label>
            <span style="font-size:11px; color:var(--text-dim);">${panelState.formSelectedTags.length} ${t('form.category_label').toLowerCase()}</span>
          </div>

          <div class="sp-form-tags-selected" id="sp-form-tags-selected">
            ${renderFormTagsSelectedHtml()}
          </div>

          <div class="sp-tag-input-container" style="margin-top:6px;">
            <div class="sp-input-with-action">
              <input type="text" id="sp-tag-search-input" class="sp-input" placeholder="${t('form.tags_placeholder')}" autocomplete="off" maxlength="30" />
              <button type="button" class="sp-input-action-btn" id="sp-tag-dropdown-toggle" title="${t('form.category_label')}">
                ${icons.iChevronDown}
              </button>
            </div>
            <div class="sp-tags-dropdown" id="sp-tags-dropdown" style="display:none;"></div>
          </div>
          <div id="sp-tag-input-err" style="display:none; font-size:11px; color:var(--danger); margin-top:4px;"></div>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">${t('form.notes_label')}</label>
          <textarea id="sp-item-notes" class="sp-input" rows="3" placeholder="${t('form.notes_placeholder')}">${escapeHtml(item.notes || '')}</textarea>
        </div>

        <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top:8px;">
          ${t('form.save_btn')}
        </button>
      </form>
    </div>
  `;
}

export function renderFormTagsSelectedHtml() {
  if (!panelState.formSelectedTags || panelState.formSelectedTags.length === 0) {
    return `<span style="font-size:11px; color:var(--text-dim);">${t('form.tags_no_tags')}</span>`;
  }
  return panelState.formSelectedTags.map(tagName => {
    const colorDef = getCategoryColorDef(tagName, state.categoryColors);
    const cssVars = getCategoryCssVars(colorDef);
    const label = tagName === 'Work' ? t('categories.Work') : (tagName === 'Personal' ? t('categories.Personal') : tagName);
    return `
      <span class="sp-pill sp-form-tag-pill" data-color-pill="true" style="${cssVars}">
        <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
        <span>${escapeHtml(label)}</span>
        <button type="button" class="sp-tag-remove-btn" data-action="remove-form-tag" data-tag="${escapeHtml(tagName)}" title="${t('form.delete_btn')}">×</button>
      </span>
    `;
  }).join('');
}
