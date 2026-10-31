/**
 * SimplePass Manager - Settings View Event Handlers
 */

import { panelState } from '../panel-state.js';
import {
  state,
  updateState,
  lockVault,
  getActiveProject,
  getActiveProjectItems
} from '../../core/state.js';
import { getItemTags } from '../../core/categories.js';
import { persistVaultChanges, handleSyncPassProject } from '../vault-operations.js';
import { showToast, applyTheme, renderPasswordStrengthBar } from '../render-utils.js';
import { t, setLanguage, SUPPORTED_LANGUAGES } from '../../core/i18n.js';
import {
  getStoredConfig,
  saveStoredConfig,
  getStoredVault,
  saveStoredVault,
  getActiveVaultId,
  getVaultProfiles,
  deleteVaultProfile,
  clearStoredVault
} from '../../core/storage.js';
import { createSession, destroySession } from '../../core/session.js';
import { startAutolock } from '../autolock.js';
import { requestPermission } from '../../core/permissions.js';
import {
  unwrapMekWithPassword,
  wrapMek,
  encryptVaultWithMek,
  validateMasterPassword
} from '../../core/crypto.js';
import { checkPassHostStatus } from '../../core/pass-native.js';
import { attachSettingsTagHandlers } from './settings-tag-handlers.js';

export function attachSettingsHandlers({ renderApp, updateActiveTabDomain }) {
  // Settings search
  const settingsSearchInput = document.getElementById('sp-settings-search');
  if (settingsSearchInput) {
    settingsSearchInput.addEventListener('input', e => {
      panelState.settingsSearchQuery = e.target.value;
      renderApp();
    });
  }

  const settingsSearchClear = document.getElementById('sp-settings-search-clear');
  if (settingsSearchClear) {
    settingsSearchClear.addEventListener('click', () => {
      panelState.settingsSearchQuery = '';
      renderApp();
    });
  }

  // Language Dropdown
  const customLangSelect = document.getElementById('sp-setting-lang-dropdown');
  const customLangTrigger = document.getElementById('sp-custom-lang-trigger');
  if (customLangSelect && customLangTrigger) {
    customLangTrigger.addEventListener('click', e => {
      e.stopPropagation();
      panelState.isLangSelectOpen = !panelState.isLangSelectOpen;
      customLangSelect.classList.toggle('open', panelState.isLangSelectOpen);
      closeOtherDropdowns('lang');
    });

    customLangSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const lang = opt.dataset.val;
        panelState.isLangSelectOpen = false;
        if (lang && SUPPORTED_LANGUAGES.includes(lang)) {
          setLanguage(lang);
          updateState({ language: lang });
          const cfg = await getStoredConfig();
          await saveStoredConfig({ ...cfg, language: lang });
          showToast(t('toasts.language_changed'));
          renderApp();
        }
      });
    });
  }

  // Theme Toggle
  const themeToggle = document.getElementById('sp-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('change', async e => {
      const newTheme = e.target.checked ? 'dark' : 'light';
      applyTheme(newTheme);
      updateState({ theme: newTheme });
      const cfg = await getStoredConfig();
      await saveStoredConfig({ ...cfg, theme: newTheme });
      showToast(newTheme === 'dark' ? t('toasts.theme_dark_enabled') : t('toasts.theme_light_enabled'));
    });
  }

  // Show Favicons Toggle
  const faviconsToggle = document.getElementById('sp-show-favicons-toggle');
  if (faviconsToggle) {
    faviconsToggle.addEventListener('change', async e => {
      const showFavicons = e.target.checked;
      updateState({ showFavicons });
      const cfg = await getStoredConfig();
      await saveStoredConfig({ ...cfg, showFavicons });
      showToast(showFavicons ? t('toasts.favicons_shown') : t('toasts.favicons_hidden'));
    });
  }

  // External Favicon Services Toggle
  const externalIconsToggle = document.getElementById('sp-use-external-icons-toggle');
  if (externalIconsToggle) {
    externalIconsToggle.addEventListener('change', async e => {
      const useExternalIcons = e.target.checked;
      updateState({ useExternalIcons });
      const cfg = await getStoredConfig();
      await saveStoredConfig({ ...cfg, useExternalIcons });
      showToast(useExternalIcons ? t('toasts.external_icons_enabled') : t('toasts.external_icons_disabled'));
    });
  }

  // Current Site Active Detection Toggle
  const currentSiteToggle = document.getElementById('sp-current-site-toggle');
  if (currentSiteToggle) {
    currentSiteToggle.addEventListener('change', async e => {
      if (e.target.checked) {
        const granted = await requestPermission('tabs');
        if (granted) {
          updateState({ hasTabsPermission: true, currentSiteEnabled: true });
          const cfg = await getStoredConfig();
          await saveStoredConfig({ ...cfg, currentSiteEnabled: true });
          if (updateActiveTabDomain) updateActiveTabDomain();
          renderApp();
        } else {
          e.target.checked = false;
          showToast(t('toasts.tabs_permission_denied'));
        }
      } else {
        updateState({ currentSiteEnabled: false });
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, currentSiteEnabled: false });
        if (updateActiveTabDomain) updateActiveTabDomain();
        renderApp();
      }
    });
  }

  // Show Card Tags Toggle
  const cardTagsToggle = document.getElementById('sp-show-card-tags-toggle');
  if (cardTagsToggle) {
    cardTagsToggle.addEventListener('change', async e => {
      const showCardTags = e.target.checked;
      updateState({ showCardTags });
      const cfg = await getStoredConfig();
      await saveStoredConfig({ ...cfg, showCardTags });
      showToast(showCardTags ? t('toasts.card_tags_shown') : t('toasts.card_tags_hidden'));
    });
  }

  // Settings Section Accordions
  document.querySelectorAll('[data-action="toggle-section"]').forEach(header => {
    header.addEventListener('click', () => {
      const sectionId = header.dataset.sectionId;
      if (panelState.openSections.has(sectionId)) {
        panelState.openSections.delete(sectionId);
      } else {
        panelState.openSections.add(sectionId);
      }
      renderApp();
    });
  });

  // Lock Interval Dropdown
  const customLockSelect = document.getElementById('sp-setting-lock-interval-dropdown');
  const customLockTrigger = document.getElementById('sp-custom-lock-trigger');
  if (customLockSelect && customLockTrigger) {
    customLockTrigger.addEventListener('click', e => {
      e.stopPropagation();
      panelState.isCustomSelectOpen = !panelState.isCustomSelectOpen;
      customLockSelect.classList.toggle('open', panelState.isCustomSelectOpen);
      closeOtherDropdowns('lock');
    });

    customLockSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const val = opt.dataset.val;
        state.lockInterval = val;
        panelState.isCustomSelectOpen = false;
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, lockInterval: val });
        if (state.rawMek) {
          const session = await createSession(state.rawMek, val);
          updateState({ sessionExpiresAt: session.expiresAt });
        } else if (state.isUnlocked) {
          showToast(t('toasts.session_invalid'));
        }
        if (val === '1day') {
          showToast(`⚠️ ${t('settings.interval_1day_warning')}`);
        } else {
          showToast(t('toasts.interval_updated'));
        }
        renderApp();
      });
    });
  }

  // Autolock Minutes Dropdown
  const customAutolockSelect = document.getElementById('sp-setting-autolock-dropdown');
  const customAutolockTrigger = document.getElementById('sp-custom-autolock-trigger');
  if (customAutolockSelect && customAutolockTrigger) {
    customAutolockTrigger.addEventListener('click', e => {
      e.stopPropagation();
      panelState.isAutolockSelectOpen = !panelState.isAutolockSelectOpen;
      customAutolockSelect.classList.toggle('open', panelState.isAutolockSelectOpen);
      closeOtherDropdowns('autolock');
    });

    customAutolockSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const val = Number(opt.dataset.val);
        state.autolockMinutes = val;
        panelState.isAutolockSelectOpen = false;
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, autolockMinutes: val });
        if (state.isUnlocked) {
          startAutolock({
            idleMinutes: val,
            onLock: () => lockVault()
          });
        }
        showToast(t('toasts.interval_updated'));
        renderApp();
      });
    });
  }

  // Export Format Dropdown
  const customExportSelect = document.getElementById('sp-export-format-dropdown');
  const customExportTrigger = document.getElementById('sp-export-format-trigger');
  if (customExportSelect && customExportTrigger) {
    customExportTrigger.addEventListener('click', e => {
      e.stopPropagation();
      panelState.isExportFormatSelectOpen = !panelState.isExportFormatSelectOpen;
      customExportSelect.classList.toggle('open', panelState.isExportFormatSelectOpen);
      closeOtherDropdowns('export');
    });

    customExportSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        panelState.selectedExportFormat = opt.dataset.val || 'spbackup';
        panelState.isExportFormatSelectOpen = false;
        renderApp();
      });
    });
  }

  function closeOtherDropdowns(keep) {
    if (keep !== 'lang' && customLangSelect) {
      panelState.isLangSelectOpen = false;
      customLangSelect.classList.remove('open');
    }
    if (keep !== 'lock' && customLockSelect) {
      panelState.isCustomSelectOpen = false;
      customLockSelect.classList.remove('open');
    }
    if (keep !== 'autolock' && customAutolockSelect) {
      panelState.isAutolockSelectOpen = false;
      customAutolockSelect.classList.remove('open');
    }
    if (keep !== 'export' && customExportSelect) {
      panelState.isExportFormatSelectOpen = false;
      customExportSelect.classList.remove('open');
    }
  }

  // Tag Management Handlers
  attachSettingsTagHandlers({ renderApp });

  // Password Change
  const btnToggleChangePwd = document.getElementById('sp-btn-toggle-change-pwd');
  if (btnToggleChangePwd) {
    btnToggleChangePwd.addEventListener('click', () => {
      panelState.isChangePwdOpen = !panelState.isChangePwdOpen;
      renderApp();
      if (panelState.isChangePwdOpen) {
        setTimeout(() => {
          const form = document.getElementById('sp-change-pwd-form');
          if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 30);
      }
    });
  }

  const changePwdForm = document.getElementById('sp-change-pwd-form');
  if (changePwdForm) {
    renderPasswordStrengthBar('sp-pwd-new', 'sp-pwd-new-strength');
    changePwdForm.addEventListener('submit', async e => {
      e.preventDefault();
      const oldPwd = document.getElementById('sp-pwd-old').value;
      const newPwd = document.getElementById('sp-pwd-new').value;
      const newPwd2 = document.getElementById('sp-pwd-new2').value;
      const errBox = document.getElementById('sp-change-pwd-err');

      const envelope = await getStoredVault();
      let currentMek = state.rawMek;
      try {
        currentMek = await unwrapMekWithPassword(envelope, oldPwd);
      } catch (_) {
        if (errBox) {
          errBox.innerText = t('auth.invalid_master_pwd');
          errBox.style.display = 'block';
        }
        return;
      }

      const pwdVal = validateMasterPassword(newPwd);
      if (!pwdVal.valid) {
        if (errBox) {
          errBox.innerText = t(`auth.${pwdVal.errorCode}`) || pwdVal.error;
          errBox.style.display = 'block';
        }
        return;
      }
      if (newPwd !== newPwd2) {
        if (errBox) {
          errBox.innerText = t('auth.pwd_mismatch');
          errBox.style.display = 'block';
        }
        return;
      }

      try {
        const newKeyByPassword = await wrapMek(currentMek, newPwd, 'mek-pwd');
        state.rawMek = currentMek;
        if (!state.keySlots) {
          state.keySlots = {
            keyByPassword: envelope.keyByPassword,
            keyByRecovery: envelope.keyByRecovery
              ? { ...envelope.keyByRecovery, aad: envelope.keyByRecovery.aad ?? false }
              : null
          };
        }
        state.keySlots.keyByPassword = newKeyByPassword;

        const vaultData = {
          version: 3,
          updatedAt: new Date().toISOString(),
          projects: state.projects,
          items: state.items
        };
        const updatedEnvelope = await encryptVaultWithMek(vaultData, currentMek, state.keySlots);
        await saveStoredVault(updatedEnvelope);

        const session = await createSession(currentMek, state.lockInterval || 'session');
        panelState.isChangePwdOpen = false;
        updateState({
          rawMek: currentMek,
          keySlots: state.keySlots,
          sessionExpiresAt: session.expiresAt
        });
        showToast(t('toasts.pwd_changed_success'));
        renderApp();
      } catch (err) {
        if (errBox) {
          errBox.innerText = err.message;
          errBox.style.display = 'block';
        }
      }
    });
  }

  // Lock Now Button
  const btnLockNow = document.getElementById('sp-btn-lock-now');
  if (btnLockNow) {
    btnLockNow.addEventListener('click', () => {
      lockVault();
    });
  }

  // Switcher Trigger
  const btnOpenSwitcher = document.getElementById('sp-btn-open-switcher');
  if (btnOpenSwitcher) {
    btnOpenSwitcher.addEventListener('click', () => {
      updateState({ isProjectSwitcherOpen: true });
    });
  }

  // Advanced Export & Tag Filter
  const btnExportAdvancedToggle = document.getElementById('sp-export-advanced-toggle');
  if (btnExportAdvancedToggle) {
    btnExportAdvancedToggle.addEventListener('click', e => {
      e.preventDefault();
      panelState.isExportAdvancedOpen = !panelState.isExportAdvancedOpen;
      renderApp();
    });
  }

  const btnExportSelectAllTags = document.getElementById('sp-export-select-all-tags');
  if (btnExportSelectAllTags) {
    btnExportSelectAllTags.addEventListener('click', e => {
      e.preventDefault();
      const allProjectItems = getActiveProjectItems();
      const tags = Array.from(
        new Set([
          ...state.categories.filter(c => c !== 'All'),
          ...allProjectItems.flatMap(i => getItemTags(i))
        ])
      ).filter(Boolean);
      tags.forEach(t => panelState.exportSelectedTags.add(t));
      renderApp();
    });
  }

  const btnExportClearTags = document.getElementById('sp-export-clear-tags');
  if (btnExportClearTags) {
    btnExportClearTags.addEventListener('click', e => {
      e.preventDefault();
      panelState.exportSelectedTags.clear();
      renderApp();
    });
  }

  document.querySelectorAll('[data-action="toggle-export-tag"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const tag = btn.dataset.tag;
      if (!tag) return;
      if (panelState.exportSelectedTags.has(tag)) {
        panelState.exportSelectedTags.delete(tag);
      } else {
        panelState.exportSelectedTags.add(tag);
      }
      renderApp();
    });
  });

  const btnExportUnified = document.getElementById('sp-btn-export-unified');
  if (btnExportUnified) {
    btnExportUnified.addEventListener('click', () => {
      const format = panelState.selectedExportFormat || 'spbackup';
      const activeProj = getActiveProject();
      const projectItems = getActiveProjectItems();
      const allItems = projectItems.length > 0 ? projectItems : state.items;

      let itemsToExport = allItems;
      if (panelState.exportSelectedTags.size > 0) {
        itemsToExport = allItems.filter(item => {
          const itemTags = getItemTags(item);
          return itemTags.some(t => panelState.exportSelectedTags.has(t));
        });
        if (itemsToExport.length === 0) {
          showToast(t('settings.export_no_matching_items'));
          return;
        }
      }

      const projName = activeProj?.name
        ? activeProj.name.replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '_')
        : 'passwords';
      const tagSuffix =
        panelState.exportSelectedTags.size === 1
          ? `-${Array.from(panelState.exportSelectedTags)[0]}`
          : panelState.exportSelectedTags.size > 1
          ? '-filtered'
          : '';

      panelState.exportModalData = {
        format,
        items: itemsToExport,
        fileName: `passwords-${projName}${tagSuffix}`
      };
      renderApp();
    });
  }

  // Vault Management & Reset
  const btnDeleteCurrentVault = document.getElementById('sp-btn-delete-current-vault');
  if (btnDeleteCurrentVault) {
    btnDeleteCurrentVault.addEventListener('click', async () => {
      const activeId = await getActiveVaultId();
      const profiles = await getVaultProfiles();
      const currentProfile = profiles.find(p => p.id === activeId);
      const name = currentProfile ? currentProfile.name : '';
      if (confirm(t('settings.delete_vault_confirm', { name }))) {
        await deleteVaultProfile(activeId);
        await destroySession();
        window.location.reload();
      }
    });
  }

  const btnResetAll = document.getElementById('sp-btn-reset-all');
  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      const confirmText = prompt(t('settings.reset_prompt'));
      if (confirmText === 'СБРОС') {
        await clearStoredVault();
        await destroySession();
        window.location.reload();
      }
    });
  }

  // Pass CLI settings actions
  const btnCheckPassHost = document.getElementById('sp-btn-check-pass-host');
  if (btnCheckPassHost) {
    btnCheckPassHost.addEventListener('click', async () => {
      if (!state.hasNativeMessagingPermission) {
        const granted = await requestPermission('nativeMessaging');
        if (!granted) {
          showToast(t('toasts.native_permission_denied'));
          return;
        }
        updateState({ hasNativeMessagingPermission: true });
      }
      showToast(t('toasts.native_checking'));
      const status = await checkPassHostStatus();
      updateState({ passHostStatus: status });
      if (status && status.ok) {
        showToast(t('toasts.native_connected', { count: status.entriesCount }));
      } else if (status && status.permissionRequired) {
        showToast(t('toasts.native_permission_denied'));
      } else {
        showToast(t('toasts.native_unresponsive'));
      }
      renderApp();
    });
  }

  const btnShowPassInstructions = document.getElementById('sp-btn-show-pass-instructions');
  if (btnShowPassInstructions) {
    btnShowPassInstructions.addEventListener('click', () => {
      updateState({ isShowPassInstructions: true });
    });
  }

  const btnSyncActivePass = document.getElementById('sp-btn-sync-active-pass');
  if (btnSyncActivePass) {
    btnSyncActivePass.addEventListener('click', () => {
      const activeProj = getActiveProject();
      if (activeProj) {
        handleSyncPassProject(activeProj.id);
      }
    });
  }
}
