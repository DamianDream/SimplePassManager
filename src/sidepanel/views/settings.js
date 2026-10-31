/**
 * SimplePass Manager - Settings View Component
 */

import { state, getActiveProject, getActiveProjectItems } from '../../core/state.js';
import { t, getLanguage, LANGUAGE_OPTIONS } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLORS,
  getCategoryColorDef,
  getCategoryCssVars,
  getItemTags
} from '../../core/categories.js';

export function renderSettingsView() {
  const query = panelState.settingsSearchQuery.toLowerCase().trim();

  // Calculate session status text
  let sessionStatusText = t('settings.session_active');
  if (state.lockInterval === 'session') {
    sessionStatusText = t('settings.session_active_browser');
  } else if (state.sessionExpiresAt) {
    const diffMs = state.sessionExpiresAt - Date.now();
    if (diffMs > 0) {
      const hours = Math.round(diffMs / (3600 * 1000));
      if (hours >= 24) {
        const days = Math.round(hours / 24);
        sessionStatusText = t('settings.session_active_days', { days });
      } else {
        sessionStatusText = t('settings.session_active_hours', { hours });
      }
    } else {
      sessionStatusText = t('settings.session_expired');
    }
  }

  const intervalLabels = {
    session: t('settings.interval_session'),
    '15m': t('settings.interval_15m'),
    '1h': t('settings.interval_1h'),
    '8h': t('settings.interval_8h'),
    '1day': t('settings.interval_1day')
  };
  const selectedIntervalLabel = intervalLabels[state.lockInterval] || intervalLabels['session'];

  const autolockVal = state.autolockMinutes !== undefined ? Number(state.autolockMinutes) : 15;
  const autolockLabels = {
    0: t('settings.autolock_off'),
    1: t('settings.autolock_1m'),
    5: t('settings.autolock_5m'),
    15: t('settings.autolock_15m'),
    30: t('settings.autolock_30m')
  };
  const selectedAutolockLabel = autolockLabels[autolockVal] || autolockLabels[15];

  // 0. Accordion: Appearance & Theme
  const isDark = state.theme === 'dark';
  const currentLang = getLanguage();
  const currentLangObj = LANGUAGE_OPTIONS.find(o => o.code === currentLang) || LANGUAGE_OPTIONS[0];

  const appearanceHtml = `
    <div class="sp-setting-row" data-search="language язык мова беларуская қазақша 中文 日本語 हिन्दी hindi english интерфейс switch">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.language_label')}</span>
        <span class="sp-badge-info">${currentLangObj.code.toUpperCase()}</span>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.language_desc')}
      </p>
      <div class="sp-setting-control">
        <div class="sp-custom-select ${panelState.isLangSelectOpen ? 'open' : ''}" id="sp-setting-lang-dropdown">
          <button type="button" class="sp-custom-select-trigger" id="sp-custom-lang-trigger" aria-haspopup="listbox" aria-expanded="${panelState.isLangSelectOpen}">
            <span class="sp-custom-select-value">${currentLangObj.flag} ${currentLangObj.name}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown">
            ${LANGUAGE_OPTIONS.map(opt => {
              const isSelected = opt.code === currentLang;
              return `
                <div class="sp-custom-select-option ${isSelected ? 'selected' : ''}" data-val="${opt.code}">
                  <span>${opt.flag} ${opt.name}</span>
                  ${isSelected ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="sp-setting-row" data-search="тема оформления темная светлая cloud dancer darkest hour вид интерфейс переключатель theme dark light">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.theme_label')}</span>
        <label class="sp-liquid-switch">
          <input type="checkbox" id="sp-theme-toggle" ${isDark ? 'checked' : ''} />
          <span class="sp-liquid-slider"></span>
        </label>
      </div>
      <p class="sp-setting-desc">
        ${isDark ? t('settings.theme_dark_desc') : t('settings.theme_light_desc')}
      </p>
    </div>

    <div class="sp-setting-row" data-search="фавикон favicon иконки сайтов карточки отображение favicons icons cards show hide">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.show_favicons_label')}</span>
        <label class="sp-liquid-switch">
          <input type="checkbox" id="sp-show-favicons-toggle" ${state.showFavicons ? 'checked' : ''} />
          <span class="sp-liquid-slider"></span>
        </label>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.show_favicons_desc')}
      </p>
    </div>

    <div class="sp-setting-row" data-search="внешние сервисы иконок google duckduckgo external icon services">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.external_icons_label')}</span>
        <label class="sp-liquid-switch">
          <input type="checkbox" id="sp-use-external-icons-toggle" ${state.useExternalIcons ? 'checked' : ''} />
          <span class="sp-liquid-slider"></span>
        </label>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.external_icons_desc')}
      </p>
    </div>

    <div class="sp-setting-row" data-search="текущий сайт вкладка активная домен автозаполнение tabs current site">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.current_site_label')}</span>
        <label class="sp-liquid-switch">
          <input type="checkbox" id="sp-current-site-toggle" ${state.currentSiteEnabled && state.hasTabsPermission ? 'checked' : ''} />
          <span class="sp-liquid-slider"></span>
        </label>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.current_site_desc')}
      </p>
    </div>
  `;

  // 1. Accordion: Security & Session
  const secHtml = `
    <div class="sp-setting-row" data-search="проверка пароля сессия тайм-аут 3 дня день неделя месяц безопасность security session">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.master_pwd_check')}</span>
        <span class="sp-badge-info">${state.lockInterval || 'session'}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.master_pwd_check_desc')}</p>
      <div class="sp-setting-control">
        <div class="sp-custom-select ${panelState.isCustomSelectOpen ? 'open' : ''}" id="sp-setting-lock-interval-dropdown">
          <button type="button" class="sp-custom-select-trigger" id="sp-custom-lock-trigger">
            <span class="sp-custom-select-value">${selectedIntervalLabel}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown">
            <div class="sp-custom-select-option ${state.lockInterval === 'session' ? 'selected' : ''}" data-val="session">
              <span>${t('settings.interval_session')}</span>
              ${state.lockInterval === 'session' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '15m' ? 'selected' : ''}" data-val="15m">
              <span>${t('settings.interval_15m')}</span>
              ${state.lockInterval === '15m' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '1h' ? 'selected' : ''}" data-val="1h">
              <span>${t('settings.interval_1h')}</span>
              ${state.lockInterval === '1h' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '8h' ? 'selected' : ''}" data-val="8h">
              <span>${t('settings.interval_8h')}</span>
              ${state.lockInterval === '8h' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '1day' ? 'selected' : ''}" data-val="1day">
              <span>${t('settings.interval_1day')}</span>
              ${state.lockInterval === '1day' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
          </div>
        </div>
        ${state.lockInterval === '1day' ? `<p style="font-size:10px; color:var(--text-dim); margin-top:5px; line-height:1.3;">⚠️ ${t('settings.interval_1day_warning')}</p>` : ''}
      </div>
    </div>

    <div class="sp-setting-row" data-search="автоблокировка бездействие inactivity autolock security">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.autolock_title')}</span>
        <span class="sp-badge-info">${autolockVal === 0 ? 'off' : autolockVal + 'm'}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.autolock_desc')}</p>
      <div class="sp-setting-control">
        <div class="sp-custom-select ${panelState.isAutolockSelectOpen ? 'open' : ''}" id="sp-setting-autolock-dropdown">
          <button type="button" class="sp-custom-select-trigger" id="sp-custom-autolock-trigger">
            <span class="sp-custom-select-value">${selectedAutolockLabel}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown">
            <div class="sp-custom-select-option ${autolockVal === 1 ? 'selected' : ''}" data-val="1">
              <span>${t('settings.autolock_1m')}</span>
              ${autolockVal === 1 ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${autolockVal === 5 ? 'selected' : ''}" data-val="5">
              <span>${t('settings.autolock_5m')}</span>
              ${autolockVal === 5 ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${autolockVal === 15 ? 'selected' : ''}" data-val="15">
              <span>${t('settings.autolock_15m')}</span>
              ${autolockVal === 15 ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${autolockVal === 30 ? 'selected' : ''}" data-val="30">
              <span>${t('settings.autolock_30m')}</span>
              ${autolockVal === 30 ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${autolockVal === 0 ? 'selected' : ''}" data-val="0">
              <span>${t('settings.autolock_off')}</span>
              ${autolockVal === 0 ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-setting-row" data-search="статус сессия время активности status session active">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.session_status_label')}</span>
        <span style="font-size:11px; font-weight:600; color:var(--success);">${sessionStatusText}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.session_status_desc')}</p>
    </div>

    <div class="sp-setting-row" data-search="сменить мастер пароль ключ безопасность change password">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.master_pwd_label')}</span>
        <button class="sp-btn-secondary" id="sp-btn-toggle-change-pwd" style="padding:4px 8px; font-size:11px;">
          ${panelState.isChangePwdOpen ? t('form.cancel_btn') : t('settings.change_pwd_btn')}
        </button>
      </div>
      <p class="sp-setting-desc">${t('settings.master_pwd_desc')}</p>

      ${
        panelState.isChangePwdOpen
          ? `
        <form id="sp-change-pwd-form" style="display:flex; flex-direction:column; gap:8px; margin-top:8px; padding:10px; background:var(--bg-surface); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
          <input type="password" id="sp-pwd-old" class="sp-input" placeholder="${t('settings.current_pwd_placeholder')}" required />
          <input type="password" id="sp-pwd-new" class="sp-input" placeholder="${t('settings.new_pwd_placeholder')}" required />
          <div id="sp-pwd-new-strength"></div>
          <input type="password" id="sp-pwd-new2" class="sp-input" placeholder="${t('settings.repeat_new_pwd_placeholder')}" required />
          <div id="sp-change-pwd-err" style="display:none; font-size:11px; color:var(--danger);"></div>
          <button type="submit" class="sp-btn-primary" style="justify-content:center; padding:6px 12px; margin-top:4px;">
            ${t('settings.save_new_pwd_btn')}
          </button>
        </form>
      `
          : ''
      }
    </div>

    <div class="sp-setting-row" data-search="заблокировать блокировка выйти заморозить lock vault">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.lock_vault_label')}</span>
        <button class="sp-btn-danger" id="sp-btn-lock-now" style="padding:4px 10px; font-size:11px;">
          ${t('settings.lock_now_btn')}
        </button>
      </div>
      <p class="sp-setting-desc">${t('settings.lock_vault_desc')}</p>
    </div>
  `;

  // 2. Accordion: Databases & Storage
  const activeProj = getActiveProject();
  const hostConnected = !!(state.passHostStatus && state.passHostStatus.ok);

  const dbHtml = `
    <div class="sp-setting-row" data-search="база данных проект хранилище active project pass">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.current_db_label')}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="sp-badge-info">${activeProj ? escapeHtml(activeProj.name) : '—'}</span>
          ${activeProj && activeProj.type === 'pass_cli' ? `<span class="sp-badge-pass">${t('settings.badge_pass_cli')}</span>` : `<span class="sp-badge-browser">${t('settings.badge_browser')}</span>`}
        </div>
      </div>
      <p class="sp-setting-desc">${t('settings.db_stats_desc', { projects: state.projects.length, items: getActiveProjectItems().length })}</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-open-switcher" style="width:100%; justify-content:center;">
          ${t('settings.manage_dbs_btn')}
        </button>
      </div>
    </div>

    <div class="sp-setting-row" data-search="хранилище тип локальное браузер pass cli синхронизация gpg native">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.pass_cli_label')}</span>
        <span style="font-size:11px; font-weight:600; color:${hostConnected ? 'var(--success)' : '#f59e0b'};">
          ${hostConnected ? t('settings.pass_connected', { version: state.passHostStatus.version }) : t('settings.pass_not_connected')}
        </span>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.pass_desc')}
      </p>

      <div class="sp-host-status-box">
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">${t('settings.store_path_label')}</span>
          <span><code>${state.passHostStatus?.storePath || '~/.password-store'}</code></span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">${t('settings.pass_tool_label')}</span>
          <span style="color:${state.passHostStatus?.passInstalled ? 'var(--success)' : 'var(--danger)'};">
            ${state.passHostStatus?.passInstalled ? t('settings.tool_installed') : t('settings.tool_not_found')}
          </span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">${t('settings.gpg_tool_label')}</span>
          <span style="color:${state.passHostStatus?.gpgInstalled ? 'var(--success)' : 'var(--danger)'};">
            ${state.passHostStatus?.gpgInstalled ? t('settings.tool_installed') : t('settings.tool_not_found')}
          </span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">${t('settings.pass_entries_label')}</span>
          <span style="font-weight:600;">${state.passHostStatus?.entriesCount ?? 0}</span>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="sp-btn-secondary" id="sp-btn-check-pass-host" style="flex:1; justify-content:center; font-size:11px; padding:6px 8px;">
          ${state.hasNativeMessagingPermission ? t('settings.check_status_btn') : t('settings.connect_pass_btn')}
        </button>
        <button class="sp-btn-secondary" id="sp-btn-show-pass-instructions" style="flex:1; justify-content:center; font-size:11px; padding:6px 8px;">
          ${t('settings.instructions_btn')}
        </button>
      </div>

      ${
        activeProj && activeProj.type === 'pass_cli'
          ? `
        <button class="sp-btn-primary" id="sp-btn-sync-active-pass" style="width:100%; justify-content:center; font-size:11px; padding:7px 10px; margin-top:4px;">
          ${t('settings.sync_pass_btn')}
        </button>
      `
          : ''
      }
    </div>
  `;

  // 3. Section: Tags Management
  const catItems = state.categories.filter(c => c !== 'All');
  const catListHtml = catItems.map(c => {
    const isDefault = c === 'Work' || c === 'Personal';
    const label = c === 'Work' ? t('categories.Work') : (c === 'Personal' ? t('categories.Personal') : c);
    const colorDef = getCategoryColorDef(c, state.categoryColors);
    const cssVars = getCategoryCssVars(colorDef);
    const isPickerOpen = panelState.activeColorPickerCat === c;
    const isEditing = panelState.editingTagId === c;

    if (isEditing) {
      return `
        <div class="sp-cat-item-wrap">
          <div class="sp-cat-item">
            <div style="display:flex; align-items:center; gap:6px; flex:1;">
              <input type="text" class="sp-input" id="sp-rename-tag-input" value="${escapeHtml(c)}" maxlength="30" style="padding:4px 8px; font-size:12px; height:28px; flex:1;" />
              <button type="button" class="sp-btn-primary" id="sp-btn-save-tag-rename" data-old-name="${escapeHtml(c)}" style="padding:4px 8px; font-size:11px; height:28px;" title="${t('form.save_btn')}">
                ${icons.iCheck}
              </button>
              <button type="button" class="sp-btn-secondary" id="sp-btn-cancel-tag-rename" style="padding:4px 8px; font-size:11px; height:28px;" title="${t('nav.close')}">
                ${icons.iX}
              </button>
            </div>
          </div>
          <div id="sp-rename-tag-err" style="display:none; font-size:11px; color:var(--danger); padding:0 4px; margin-top:2px;"></div>
        </div>
      `;
    }

    return `
      <div class="sp-cat-item-wrap">
        <div class="sp-cat-item ${isDefault ? 'default' : ''}">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="sp-pill" data-color-pill="true" style="${cssVars}; pointer-events:none; padding:3px 8px; font-size:11px;">
              <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
              <span>${escapeHtml(label)}</span>
            </span>
            ${isDefault ? `<span style="font-size:10px; color:var(--text-dim);">${t('settings.default_cat_badge')}</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <button type="button" class="sp-cat-color-btn" data-action="toggle-cat-color-picker" data-cat="${escapeHtml(c)}" style="background-color:${colorDef.color};" title="${t('settings.change_color_title')}"></button>
            <button type="button" class="sp-cat-edit-btn" data-action="start-tag-rename" data-cat="${escapeHtml(c)}" title="${t('settings.rename_cat_title')}">${icons.iEdit}</button>
            ${!isDefault ? `<button type="button" class="sp-cat-del-btn" data-cat="${escapeHtml(c)}" title="${t('form.delete_btn')}">${icons.iTrash}</button>` : ''}
          </div>
        </div>
        ${isPickerOpen ? `
          <div class="sp-cat-edit-palette">
            <span style="font-size:11px; color:var(--text-dim); margin-right:4px;">${t('settings.new_cat_color_label')}</span>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${Object.values(CATEGORY_COLORS).map(color => `
                <button type="button" class="sp-color-swatch-sm ${color.id === (state.categoryColors[c] || DEFAULT_CATEGORY_COLORS[c] || 'slate') ? 'selected' : ''}" data-action="set-cat-color" data-cat="${escapeHtml(c)}" data-color-id="${color.id}" style="background-color:${color.color};" title="${color.name}">
                  ${color.id === (state.categoryColors[c] || DEFAULT_CATEGORY_COLORS[c] || 'slate') ? icons.iCheck : ''}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const catHtml = `
    <div class="sp-setting-row" data-search="метки теги карточки показывать скрывать отображение tags badge pills cards show hide">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.show_card_tags_label')}</span>
        <label class="sp-liquid-switch">
          <input type="checkbox" id="sp-show-card-tags-toggle" ${state.showCardTags ? 'checked' : ''} />
          <span class="sp-liquid-slider"></span>
        </label>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.show_card_tags_desc')}
      </p>
    </div>

    <div class="sp-setting-row" data-search="метки теги tags categories папки work personal создать добавить цвет tone переименовать">
      <p class="sp-setting-desc" style="margin-top:0;">${t('settings.categories_desc')}</p>

      <div class="sp-cat-list">
        ${catListHtml}
      </div>

      <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border-subtle); display:flex; flex-direction:column; gap:8px;">
        <span style="font-size:11px; font-weight:600; color:var(--text-muted);">${t('settings.new_cat_color_label')}</span>
        <div class="sp-color-palette" id="sp-new-cat-palette">
          ${Object.values(CATEGORY_COLORS).map(color => {
            const isSelected = color.id === panelState.selectedNewCatColor;
            return `
              <button type="button" class="sp-color-swatch ${isSelected ? 'selected' : ''}" data-action="select-new-cat-color" data-color-id="${color.id}" style="background-color:${color.color};" title="${color.name}">
                ${isSelected ? icons.iCheck : ''}
              </button>
            `;
          }).join('')}
        </div>

        <div style="display:flex; gap:6px; margin-top:2px;">
          <input type="text" id="sp-new-cat-name" class="sp-input" placeholder="${t('settings.new_cat_placeholder')}" maxlength="30" style="flex:1;" />
          <button type="button" class="sp-btn-primary" id="sp-btn-add-cat" style="white-space:nowrap; padding:6px 12px; font-size:12px;">
            ${t('settings.add_cat_btn')}
          </button>
        </div>
        <div id="sp-cat-err" style="display:none; font-size:11px; color:var(--danger); margin-top:4px;"></div>
      </div>
    </div>
  `;

  // 4. Accordion: Backup & Data Transfer
  const allProjectItems = getActiveProjectItems();
  const availableExportTags = Array.from(new Set([
    ...state.categories.filter(c => c !== 'All'),
    ...allProjectItems.flatMap(i => getItemTags(i))
  ])).filter(Boolean);

  const availableExportTagsHtml = availableExportTags.length > 0
    ? availableExportTags.map(tag => {
        const isSelected = panelState.exportSelectedTags.has(tag);
        const colorDef = getCategoryColorDef(tag, state.categoryColors);
        const cssVars = getCategoryCssVars(colorDef);
        const tagCount = allProjectItems.filter(i => getItemTags(i).includes(tag)).length;
        const tagLabel = tag === 'Work' ? t('categories.Work') : (tag === 'Personal' ? t('categories.Personal') : tag);
        return `
          <button type="button"
            class="sp-pill ${isSelected ? 'active' : ''}"
            data-color-pill="true"
            data-action="toggle-export-tag"
            data-tag="${escapeHtml(tag)}"
            style="${cssVars}; font-size:11px; padding:3px 8px; cursor:pointer;"
            title="${tagCount}">
            <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
            <span>${escapeHtml(tagLabel)}</span>
            <span style="font-size:10px; opacity:0.75;">(${tagCount})</span>
            ${isSelected ? `<span style="margin-left:2px; display:inline-flex; align-items:center;">${icons.iCheck}</span>` : ''}
          </button>
        `;
      }).join('')
    : `<span style="font-size:11px; color:var(--text-muted); font-style:italic;">${t('settings.export_no_tags_available')}</span>`;

  let exportSummaryText = '';
  if (panelState.exportSelectedTags.size === 0) {
    exportSummaryText = t('settings.export_tags_none_selected', { count: allProjectItems.length });
  } else {
    const matchingCount = allProjectItems.filter(item => {
      const itemTags = getItemTags(item);
      return itemTags.some(t => panelState.exportSelectedTags.has(t));
    }).length;
    exportSummaryText = t('settings.export_tags_selected_count', { count: matchingCount, total: allProjectItems.length });
  }

  const backupHtml = `
    <div class="sp-setting-row" data-search="экспорт export json csv метки tags фильтр">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.export_title')}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.export_desc')}</p>
      <div class="sp-setting-control" style="display:flex; gap:8px; align-items:center;">
        <button class="sp-btn-secondary" id="sp-btn-export-unified" style="flex:1; justify-content:center;">
          ${t('settings.csv_export_btn')}
        </button>
        <div class="sp-custom-select sp-custom-select-sm ${panelState.isExportFormatSelectOpen ? 'open' : ''}" id="sp-export-format-dropdown" style="width:125px; flex-shrink:0;">
          <button type="button" class="sp-custom-select-trigger" id="sp-export-format-trigger" aria-haspopup="listbox" aria-expanded="${panelState.isExportFormatSelectOpen}">
            <span class="sp-custom-select-value">${panelState.selectedExportFormat === 'spbackup' ? '.SPBACKUP' : panelState.selectedExportFormat.toUpperCase()}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown" style="min-width:125px;">
            <div class="sp-custom-select-option ${panelState.selectedExportFormat === 'spbackup' ? 'selected' : ''}" data-val="spbackup" style="font-size:12px; padding:6px 10px;">
              <span>🔒 .spbackup</span>
              ${panelState.selectedExportFormat === 'spbackup' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${panelState.selectedExportFormat === 'json' ? 'selected' : ''}" data-val="json" style="font-size:12px; padding:6px 10px;">
              <span>JSON</span>
              ${panelState.selectedExportFormat === 'json' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${panelState.selectedExportFormat === 'csv' ? 'selected' : ''}" data-val="csv" style="font-size:12px; padding:6px 10px;">
              <span>CSV</span>
              ${panelState.selectedExportFormat === 'csv' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:8px;">
        <button type="button" class="sp-export-advanced-toggle" id="sp-export-advanced-toggle" style="background:none; border:none; padding:0; display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--text-dim); cursor:pointer; text-decoration:none; transition:color 0.15s ease;">
          <span class="sp-settings-item-arrow ${panelState.isExportAdvancedOpen ? 'open' : ''}" style="display:inline-flex; align-items:center; transform:${panelState.isExportAdvancedOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition:transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);">${icons.iChevronDown}</span>
          <span style="text-decoration:underline;">${t('settings.export_advanced_link')}</span>
          ${panelState.exportSelectedTags.size > 0 ? `<span class="sp-badge-info" style="font-size:10px; padding:1px 5px; margin-left:2px;">${panelState.exportSelectedTags.size}</span>` : ''}
        </button>
      </div>

      ${panelState.isExportAdvancedOpen ? `
        <div class="sp-export-advanced-panel" style="margin-top:10px; padding:12px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; font-weight:600; color:var(--text-main);">${t('settings.export_by_tags_title')}</span>
            <div style="display:flex; gap:10px;">
              <button type="button" id="sp-export-select-all-tags" style="background:none; border:none; padding:0; font-size:11px; color:var(--accent); cursor:pointer; text-decoration:underline;">${t('settings.export_select_all')}</button>
              <button type="button" id="sp-export-clear-tags" style="background:none; border:none; padding:0; font-size:11px; color:var(--text-dim); cursor:pointer; text-decoration:underline;">${t('settings.export_clear_tags')}</button>
            </div>
          </div>

          <div class="sp-export-tags-wrap" style="display:flex; flex-wrap:wrap; gap:6px;">
            ${availableExportTagsHtml}
          </div>

          <div style="font-size:11px; color:var(--text-dim); border-top:1px dashed var(--border-subtle); padding-top:8px;">
            ${exportSummaryText}
          </div>
        </div>
      ` : ''}
    </div>

    <div class="sp-setting-row" data-search="импорт import json csv bitwarden">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.import_title')}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.import_desc')}</p>
      <div class="sp-setting-control">
        <input type="file" id="sp-import-unified-file-input" style="display:none;" accept=".json,.csv,text/csv,application/json,.txt" />
        <button class="sp-btn-secondary" id="sp-btn-trigger-import-unified" style="width:100%; justify-content:center;">
          ${t('settings.csv_import_btn')}
        </button>
      </div>
      <div style="margin-top:8px; display:flex; justify-content:flex-start;">
        <a href="#" id="sp-download-csv-template" style="font-size:11px; color:var(--text-dim); text-decoration:underline; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:color 0.15s ease;">
          ${icons.iDownload} ${t('settings.csv_template_link')}
        </a>
      </div>
    </div>
  `;

  // 5. Accordion: About & Reset
  const aboutHtml = `
    <div class="sp-setting-row" data-search="версия simplepass лицензия open source mit инфо about">
      <div class="sp-setting-header">
        <span class="sp-setting-label">SimplePass Manager</span>
        <span class="sp-badge-info">v0.6</span>
      </div>
      <p class="sp-setting-desc">
        ${t('settings.about_desc')}
      </p>
    </div>

    <div class="sp-setting-row" data-search="шифрование криптография алгоритм aes pbkdf2 cryptography">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${t('settings.crypto_spec_title')}</span>
      </div>
      <p class="sp-setting-desc" style="font-family:monospace; font-size:10px; line-height:1.5;">
        Algorithm: AES-256-GCM (12-byte random IV)<br>
        Derivation: PBKDF2 (SHA-256, 600,000 rounds)<br>
        Standard: W3C Web Cryptography API
      </p>
    </div>

    ${panelState.cachedVaultProfiles.length > 1 ? `
    <div class="sp-setting-row" data-search="удалить текущую базу данных delete database">
      <div class="sp-setting-header">
        <span class="sp-setting-label" style="color:var(--danger);">${t('settings.delete_current_vault_btn')}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.delete_current_vault_desc')}</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-delete-current-vault" style="width:100%; justify-content:center; color:var(--danger); border-color:var(--danger);">
          ${icons.iTrash} ${t('settings.delete_current_vault_btn')} (${escapeHtml(panelState.cachedVaultProfiles.find(p => p.id === panelState.cachedActiveVaultId)?.name || '')})
        </button>
      </div>
    </div>
    ` : ''}

    <div class="sp-setting-row" data-search="сброс удалить все данные стереть очистить wipe danger reset">
      <div class="sp-setting-header">
        <span class="sp-setting-label" style="color:var(--danger);">${t('settings.wipe_data_label')}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.wipe_data_desc')}</p>
      <div class="sp-setting-control">
        <button class="sp-btn-danger" id="sp-btn-reset-all" style="width:100%; justify-content:center;">
          ${t('settings.wipe_all_btn')}
        </button>
      </div>
    </div>
  `;

  const sections = [
    {
      id: 'appearance',
      title: t('settings.appearance_section'),
      desc: t('settings.appearance_desc_short'),
      icon: icons.iMoon,
      content: appearanceHtml,
      keywords: 'тема оформления темная светлая вид цвет language язык мова беларуская қазақша 中文 日本語 हिन्दी hindi english'
    },
    {
      id: 'security',
      title: t('settings.security_section'),
      desc: t('settings.security_desc_short'),
      icon: icons.iShield,
      content: secHtml,
      keywords: 'пароль сессия 3 дня тайм-аут блокировка безопасность смена мастер-пароль'
    },
    {
      id: 'databases',
      title: t('settings.db_section'),
      desc: t('settings.db_desc_short'),
      icon: icons.iFolder,
      content: dbHtml,
      keywords: 'база проект хранилище список pass синхронизация'
    },
    {
      id: 'categories',
      title: t('settings.categories_section'),
      desc: t('settings.categories_desc_short'),
      icon: icons.iTag,
      badge: catItems.length,
      content: catHtml,
      keywords: 'метки теги категории папки work personal создать добавить цвет tone карточки badge pills cards show hide'
    },
    {
      id: 'backup',
      title: t('settings.backup_section'),
      desc: t('settings.backup_desc_short'),
      icon: icons.iDownload,
      content: backupHtml,
      keywords: 'бэкап экспорт импорт json csv pass txt export backup plaintext'
    },
    {
      id: 'about',
      title: t('settings.about_section'),
      desc: t('settings.about_desc_short'),
      icon: icons.iGlobe,
      content: aboutHtml,
      keywords: 'версия лицензия шифрование сброс о программе mit about'
    }
  ];

  const filteredSections = sections.filter(s => {
    if (!query) return true;
    return (
      s.title.toLowerCase().includes(query) ||
      (s.desc && s.desc.toLowerCase().includes(query)) ||
      s.keywords.toLowerCase().includes(query) ||
      s.content.toLowerCase().includes(query)
    );
  });

  const listHtml = filteredSections.length
    ? `
      <div class="sp-settings-list">
        ${filteredSections.map(s => {
          const isOpen = query ? true : panelState.openSections.has(s.id);
          return `
            <div class="sp-settings-item ${isOpen ? 'open' : ''}" data-section-id="${s.id}">
              <button type="button" class="sp-settings-item-header" data-action="toggle-section" data-section-id="${s.id}">
                <div class="sp-settings-item-left">
                  <span class="sp-settings-item-icon">${s.icon}</span>
                  <span class="sp-settings-item-title">${s.title}</span>
                  ${s.badge !== undefined ? `<span class="sp-badge-info" style="margin-left:6px;">${s.badge}</span>` : ''}
                </div>
                <span class="sp-settings-item-arrow">${icons.iChevronDown}</span>
              </button>
              ${isOpen ? `
                <div class="sp-settings-item-body">
                  ${s.content}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `
    : `
      <div class="sp-empty-state" style="height: 180px;">
        <div class="sp-empty-icon">${icons.iSearch}</div>
        <p style="font-size: 13px; font-weight: 600;">${t('settings.settings_not_found')}</p>
        <p style="font-size: 11px;">${t('settings.no_search_results', { query: escapeHtml(panelState.settingsSearchQuery) })}</p>
      </div>
    `;

  return `
    <div style="display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; flex:1;">
      <div class="sp-search-bar" style="padding: 10px 16px 6px;">
        <div class="sp-search-input-wrap">
          <span class="sp-search-icon">${icons.iSearch}</span>
          <input type="text" id="sp-settings-search" class="sp-search-input" placeholder="${t('settings.search_placeholder')}" value="${escapeHtml(panelState.settingsSearchQuery)}" />
          ${panelState.settingsSearchQuery ? `<button class="sp-search-clear" id="sp-settings-search-clear">${icons.iX}</button>` : ''}
        </div>
      </div>

      <div class="sp-settings-container">
        ${listHtml}
      </div>
    </div>
  `;
}
