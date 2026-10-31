/**
 * SimplePass Manager Side Panel Application Entry
 * Built for speed, high security, and sleek user experience.
 */

import {
  state,
  subscribe,
  updateState,
  getActiveProject,
  getActiveProjectItems,
  switchProject,
  createProject,
  renameProject,
  deleteProjectCascade,
  lockVault,
  copyToClipboard
} from '../core/state.js';
import {
  encryptVault,
  decryptVault,
  validateMasterPassword,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  decryptVaultWithRecovery,
  rekeyVault,
  generateMek,
  wrapMek,
  unwrapMekWithPassword,
  unwrapMekWithRecovery,
  encryptVaultWithMek,
  decryptVaultWithMek
} from '../core/crypto.js';
import {
  getStoredVault,
  saveStoredVault,
  getStoredConfig,
  saveStoredConfig,
  clearStoredVault,
  normalizeVaultData,
  verifyMasterPassword,
  itemToPassFormat,
  passFormatToItem,
  itemsToCsv,
  csvToItems,
  bitwardenJsonToItems,
  itemsToBitwardenJson,
  getVaultProfiles,
  getActiveVaultId,
  setActiveVaultId,
  createVaultProfile,
  deleteVaultProfile
} from '../core/storage.js';
import { createSession, restoreSession, destroySession, LOCK_INTERVALS } from '../core/session.js';
import { generatePassword, evaluatePasswordStrength } from '../core/generator.js';
import * as icons from '../icons/icons.js';
import {
  checkPassHostStatus,
  syncAllPassEntries,
  saveItemToPassCli,
  deleteItemFromPassCli
} from '../core/pass-native.js';
import {
  extractCleanDomain,
  extractDomainName,
  isItemMatchingDomain,
  sortItemsByDomainMatch,
  isLocalOrPrivateHost
} from '../core/domain.js';
import { t, setLanguage, getLanguage, SUPPORTED_LANGUAGES, LANGUAGE_OPTIONS } from '../core/i18n.js';
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLORS,
  getCategoryColorDef,
  getCategoryCssVars,
  validateTagName,
  getItemTags
} from '../core/categories.js';
import {
  resolveFavicon,
  getCachedFavicon,
  getFaviconCache
} from '../core/favicon.js';
import { startAutolock, stopAutolock } from './autolock.js';

const rootEl = document.getElementById('sp-app-root');

// Active tab information (queried on launch)
let activeTabDomain = '';
let activeTabFavicon = '';
let activeTabId = null;
let cachedFavicons = {};

// Drawer / Menu state (mySmart style)
let isDrawerOpen = false;

// Failed unlock attempt counter & lockout state
let failedAttempts = 0;
let isRecoveryViewActive = false;
let newlyCreatedRecoveryPhrase = null;

// Multi-Vault profiles state
let cachedVaultProfiles = [];
let cachedActiveVaultId = null;
let isCreatingNewVaultFromLock = false;
let isProfileSelectorViewActive = false;

// Temporary generator options
let genOptions = {
  length: 20,
  useUpper: true,
  useLower: true,
  useDigits: true,
  useSymbols: true,
  avoidAmbiguous: false
};
let currentGeneratedPassword = '';

// Password visibility state in forms
let isPasswordVisible = false;

// Settings view state
let settingsSearchQuery = '';
let openSections = new Set();
let isChangePwdOpen = false;
let isCustomSelectOpen = false;
let isAutolockSelectOpen = false;
let isLangSelectOpen = false;
let isExportFormatSelectOpen = false;
let selectedExportFormat = 'json';
let isExportAdvancedOpen = false;
let exportSelectedTags = new Set();
let selectedNewCatColor = 'amber';
let activeColorPickerCat = null;
let editingTagId = null;

// Form multi-tags state
let formSelectedTags = [];
let currentFormItemId = null;
let formDraft = null;

function saveFormDraftFromDOM() {
  const form = document.getElementById('sp-item-form');
  if (!form) return;
  const idEl = document.getElementById('sp-item-id');
  const projEl = document.getElementById('sp-item-project');
  const titleEl = document.getElementById('sp-item-title');
  const urlEl = document.getElementById('sp-item-url');
  const userEl = document.getElementById('sp-item-username');
  const passEl = document.getElementById('sp-item-password');
  const notesEl = document.getElementById('sp-item-notes');

  const id = idEl ? idEl.value : '';
  const isNew = !id;

  formDraft = {
    isNew,
    id,
    projectId: projEl ? projEl.value : '',
    title: titleEl ? titleEl.value : '',
    url: urlEl ? urlEl.value : '',
    domain: formDraft?.domain || (urlEl ? extractCleanDomain(urlEl.value) : ''),
    favicon: formDraft?.favicon || '',
    username: userEl ? userEl.value : '',
    password: passEl ? passEl.value : '',
    notes: notesEl ? notesEl.value : '',
    tags: Array.isArray(formSelectedTags) ? [...formSelectedTags] : []
  };
}

function clearFormDraft() {
  formDraft = null;
  formSelectedTags = [];
  currentFormItemId = null;
}

// ─── THEME MANAGER ──────────────────────────────────────────────────────────

function applyTheme(theme) {
  const currentTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(`theme-${currentTheme}`);
}

// ─── ACTIVE TAB AUTO-DETECTION ─────────────────────────────────────────────

function updateActiveTabDomain() {
  const applyTab = (url, tabId, favIconUrl) => {
    const clean = extractCleanDomain(url);
    if (favIconUrl) {
      activeTabFavicon = favIconUrl;
    }
    const cleanChanged = clean !== activeTabDomain;
    const tabChanged = tabId !== activeTabId;
    const needsFavicon = state.showFavicons && clean && !cachedFavicons[clean];

    if (cleanChanged || tabChanged || needsFavicon) {
      activeTabDomain = clean;
      activeTabId = tabId;

      if (clean && state.showFavicons) {
        resolveFavicon(url, { forceRefresh: false, activeTabFavIconUrl: favIconUrl || activeTabFavicon })
          .then(res => {
            if (res && res.favicon) {
              cachedFavicons[clean] = res.favicon;
              if (res.domain) cachedFavicons[res.domain] = res.favicon;
              const hostNoPort = clean.split(':')[0];
              cachedFavicons[hostNoPort] = res.favicon;

              const preview = document.getElementById('sp-form-favicon-preview');
              if (preview && (!preview.src || preview.style.display === 'none')) {
                preview.src = res.favicon;
                preview.style.display = 'inline-block';
              }
            }
          })
          .catch(() => {});
      }

      if (state.isUnlocked) {
        if (state.activeTab === 'item-details') {
          saveFormDraftFromDOM();
          return;
        }
        render();
      }
    }
  };

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      if (tabs && tabs[0]) {
        applyTab(tabs[0].url, tabs[0].id, tabs[0].favIconUrl);
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs2 => {
          if (tabs2 && tabs2[0]) applyTab(tabs2[0].url, tabs2[0].id, tabs2[0].favIconUrl);
        });
      }
    });
  } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' }, response => {
      if (response && response.domain) {
        applyTab(response.domain, response.tabId, response.favIconUrl);
      }
    });
  }
}

// Real-time tab change listeners
if (typeof chrome !== 'undefined' && chrome.tabs) {
  try {
    if (chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        updateActiveTabDomain();
      });
    }
    if (chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.favIconUrl) {
          updateActiveTabDomain();
        }
      });
    }
  } catch (_) {}
}

// Preserve form draft whenever sidepanel loses focus or window is switched
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    if (state && state.activeTab === 'item-details') {
      saveFormDraftFromDOM();
    }
  });
}

// ─── INITIALIZATION ──────────────────────────────────────────────────────────

function syncCachedFaviconsFromItems(items) {
  if (!Array.isArray(items)) return;
  items.forEach(item => {
    const domain = item.domain || extractCleanDomain(item.url);
    if (domain && item.favicon) {
      cachedFavicons[domain] = item.favicon;
    }
  });
}

async function init() {
  try {
    cachedFavicons = await getFaviconCache();
  } catch (_) {
    cachedFavicons = {};
  }

  cachedVaultProfiles = await getVaultProfiles();
  cachedActiveVaultId = await getActiveVaultId();

  const storedVault = await getStoredVault();
  const storedConfig = await getStoredConfig();

  // Apply saved theme (defaults to light: #F8FAFC)
  const currentTheme = storedConfig.theme || 'light';
  applyTheme(currentTheme);

  // Apply saved language (defaults to ru)
  const currentLang = storedConfig.language || 'ru';
  setLanguage(currentLang);

  // Clean up legacy local storage key and restore in-session lockout state
  if (typeof chrome !== 'undefined' && chrome.storage) {
    if (chrome.storage.local) {
      chrome.storage.local.remove('sp_failed_attempts');
    }
    if (chrome.storage.session) {
      chrome.storage.session.get(['sp_failed_attempts', 'sp_lockout_until'], res => {
        failedAttempts = res.sp_failed_attempts || 0;
        lockoutUntil = res.sp_lockout_until || 0;
        if (!state.isUnlocked) render();
      });
    }
  }

  const userCategories = storedConfig.categories || ['Work', 'Personal'];
  const fullCategories = ['All', ...userCategories.filter(c => c !== 'All')];
  const userCategoryColors = {
    ...DEFAULT_CATEGORY_COLORS,
    ...(storedConfig.categoryColors || {})
  };

  const initialLockInterval = storedConfig.lockInterval === '3days' || storedConfig.lockInterval === '1week' || storedConfig.lockInterval === '1month'
    ? 'session'
    : (storedConfig.lockInterval || 'session');
  const initialAutolockMinutes = storedConfig.autolockMinutes !== undefined
    ? Number(storedConfig.autolockMinutes)
    : 15;

  updateState({
    isInitialized: storedVault !== null,
    lockInterval: initialLockInterval,
    autolockMinutes: initialAutolockMinutes,
    theme: currentTheme,
    language: currentLang,
    showCardTags: storedConfig.showCardTags === true,
    showFavicons: storedConfig.showFavicons !== false,
    categories: fullCategories,
    categoryColors: userCategoryColors
  });

  // Auto-detect active website domain immediately after config is restored
  updateActiveTabDomain();

  // Attempt to restore active session (via MEK in storage.session or memory)
  if (storedVault) {
    const session = await restoreSession();
    if (session && session.rawMek && (storedVault.version === 2 || storedVault.version === 3) && storedVault.data) {
      try {
        const rawMek = session.rawMek;
        const decrypted = await decryptVaultWithMek(storedVault, rawMek);
        const keySlots = {
          keyByPassword: storedVault.keyByPassword,
          keyByRecovery: storedVault.keyByRecovery
        };

        if (decrypted) {
          const normalized = normalizeVaultData(decrypted);
          syncCachedFaviconsFromItems(normalized.items);

          const initialProjectId =
            storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
              ? storedConfig.latestProjectId
              : normalized.projects[0].id;

          updateState({
            isUnlocked: true,
            rawMek,
            keySlots,
            projects: normalized.projects,
            items: normalized.items,
            activeProjectId: initialProjectId,
            sessionExpiresAt: session.expiresAt
          });
        }
      } catch (err) {
        console.warn('Session restoration failed:', err);
        await destroySession();
      }
    }
  }

  // Asynchronously probe native pass host status
  checkPassHostStatus().then(status => {
    updateState({ passHostStatus: status });
  }).catch(() => {});

  let previousUnlocked = false;
  subscribe(() => {
    if (state.isUnlocked !== previousUnlocked) {
      previousUnlocked = state.isUnlocked;
      if (state.isUnlocked) {
        startAutolock({
          idleMinutes: state.autolockMinutes !== undefined ? state.autolockMinutes : 15,
          onLock: () => lockVault()
        });
      } else {
        stopAutolock();
      }
    }
    render();
  });

  if (state.isUnlocked) {
    previousUnlocked = true;
    startAutolock({
      idleMinutes: state.autolockMinutes !== undefined ? state.autolockMinutes : 15,
      onLock: () => lockVault()
    });
  }

  // Periodic expiration guard: check every 30 seconds
  setInterval(() => {
    if (state.isUnlocked && state.sessionExpiresAt > 0 && Date.now() > state.sessionExpiresAt) {
      lockVault();
    }
  }, 30000);

  render();
}

// ─── VAULT ACTIONS & ERROR HANDLING ──────────────────────────────────────────

function showFieldError(inputId, errorId, message) {
  const inputEl = document.getElementById(inputId);
  const errorEl = document.getElementById(errorId);
  if (inputEl) inputEl.classList.add('has-error');
  if (errorEl) {
    errorEl.innerText = message;
    errorEl.style.display = 'block';
  }
}

function clearFieldErrors() {
  document.querySelectorAll('.sp-field-error').forEach(el => {
    el.innerText = '';
    el.style.display = 'none';
  });
  document.querySelectorAll('.sp-input.has-error').forEach(el => {
    el.classList.remove('has-error');
  });
}

let lockoutUntil = 0;
let lockoutTimer = null;

function getRemainingLockoutSeconds() {
  if (lockoutUntil && Date.now() < lockoutUntil) {
    return Math.ceil((lockoutUntil - Date.now()) / 1000);
  }
  return 0;
}

async function handleUnlock(password) {
  clearFieldErrors();
  const remainingSec = getRemainingLockoutSeconds();
  if (remainingSec > 0) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', `Слишком много неверных попыток. Подождите ${remainingSec} сек.`);
    renderAuthScreen();
    return;
  }

  if (!password) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', t('auth.empty_password') || 'Введите мастер-пароль');
    return;
  }

  try {
    const envelope = await getStoredVault();
    let rawMek = null;
    let keySlots = null;
    let decrypted = null;

    if ((envelope.version === 2 || envelope.version === 3) && envelope.keyByPassword) {
      rawMek = await unwrapMekWithPassword(envelope, password);
      decrypted = await decryptVaultWithMek(envelope, rawMek);
      if (envelope.version === 2) {
        // Upgrade v2 to v3: wrap keyByPassword with AAD ('mek-pwd'), carry keyByRecovery as-is with aad: false
        const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
        const keyByRecovery = envelope.keyByRecovery
          ? { ...envelope.keyByRecovery, aad: false }
          : null;
        keySlots = { keyByPassword, keyByRecovery };
        const v3Envelope = await encryptVaultWithMek(decrypted, rawMek, keySlots);
        await saveStoredVault(v3Envelope);
      } else {
        keySlots = {
          keyByPassword: envelope.keyByPassword,
          keyByRecovery: envelope.keyByRecovery
        };
      }
    } else {
      // Legacy v1 envelope: decrypt and migrate to v3 dual-key envelope!
      decrypted = await decryptVault(envelope, password);
      rawMek = generateMek();
      const newRecPhrase = generateRecoveryPhrase();
      const keyByPwd = await wrapMek(rawMek, password, 'mek-pwd');
      const keyByRec = await wrapMek(rawMek, normalizeRecoveryPhrase(newRecPhrase), 'mek-rec');
      keySlots = { keyByPassword: keyByPwd, keyByRecovery: keyByRec };
      const v3Envelope = await encryptVaultWithMek(decrypted, rawMek, keySlots);
      await saveStoredVault(v3Envelope);
      newlyCreatedRecoveryPhrase = newRecPhrase;
      showToast('Хранилище обновлено до v3. Сохраните новый ключ восстановления!');
    }

    const normalized = normalizeVaultData(decrypted);
    syncCachedFaviconsFromItems(normalized.items);
    const storedConfig = await getStoredConfig();

    const initialProjectId =
      storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
        ? storedConfig.latestProjectId
        : normalized.projects[0].id;

    // Reset failed attempts counter on success
    failedAttempts = 0;
    lockoutUntil = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
    }

    // Create session holding MEK (default session interval)
    const session = await createSession(rawMek, state.lockInterval || 'session');

    updateState({
      isUnlocked: true,
      rawMek,
      keySlots,
      projects: normalized.projects,
      items: normalized.items,
      activeProjectId: initialProjectId,
      sessionExpiresAt: session.expiresAt
    });
  } catch (err) {
    failedAttempts++;
    if (failedAttempts >= 3) {
      const delaySec = Math.min(600, 30 * Math.pow(2, failedAttempts - 3));
      lockoutUntil = Date.now() + delaySec * 1000;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({
        sp_failed_attempts: failedAttempts,
        sp_lockout_until: lockoutUntil
      });
    }

    const remaining = getRemainingLockoutSeconds();
    if (remaining > 0) {
      renderAuthScreen();
    } else {
      showFieldError('sp-unlock-pwd', 'sp-err-unlock', `Неверный мастер-пароль. Попытка ${failedAttempts} из 3.`);
      const forgotWrap = document.getElementById('sp-forgot-pwd-wrap');
      if (forgotWrap) forgotWrap.style.display = 'block';
    }
  }
}

async function handleCreateVault(projectName, password, confirmPassword) {
  clearFieldErrors();

  const pwdVal = validateMasterPassword(password);
  if (!pwdVal.valid) {
    showFieldError('sp-init-pwd', 'sp-err-pwd', pwdVal.error);
    return;
  }
  if (password !== confirmPassword) {
    showFieldError('sp-init-pwd2', 'sp-err-pwd2', 'Введенные пароли не совпадают');
    return;
  }

  const projId = 'proj_' + Date.now();
  const now = new Date().toISOString();
  const profileName = (projectName && projectName.trim()) || 'main';

  const initialProject = {
    id: projId,
    name: profileName,
    type: 'browser',
    createdAt: now,
    updatedAt: now
  };

  const initialData = {
    version: 2,
    createdAt: now,
    updatedAt: now,
    projects: [initialProject],
    items: [
      {
        id: 'item_sample_1',
        projectId: projId,
        title: 'GitHub',
        username: 'developer@example.com',
        password: generatePassword({ length: 24 }),
        url: 'https://github.com',
        category: 'Work',
        notes: 'Первая тестовая запись',
        updatedAt: now
      }
    ]
  };

  // Generate 12-word recovery phrase, MEK, and encrypt with Dual-Key Envelope (v3)
  const recoveryPhrase = generateRecoveryPhrase();
  const rawMek = generateMek();
  const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
  const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(recoveryPhrase), 'mek-rec');
  const keySlots = { keyByPassword, keyByRecovery };
  const encrypted = await encryptVaultWithMek(initialData, rawMek, keySlots);
  await saveStoredVault(encrypted);

  cachedVaultProfiles = await getVaultProfiles();
  cachedActiveVaultId = await getActiveVaultId();
  await saveStoredConfig({
    activeProjectId: projId,
    latestProjectId: projId,
    lockInterval: 'session'
  });

  const session = await createSession(rawMek, 'session');
  failedAttempts = 0;
  lockoutUntil = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
  }

  // Display 12-word recovery phrase modal to user before final unlock
  newlyCreatedRecoveryPhrase = recoveryPhrase;
  updateState({
    isInitialized: true,
    isUnlocked: true,
    rawMek,
    keySlots,
    projects: initialData.projects,
    items: initialData.items,
    activeProjectId: projId,
    sessionExpiresAt: session.expiresAt
  });
}

async function handleCreateAdditionalVault(projectName, password, confirmPassword) {
  clearFieldErrors();

  const pwdVal = validateMasterPassword(password);
  if (!pwdVal.valid) {
    showFieldError('sp-new-db-pwd', 'sp-err-new-db-pwd', pwdVal.error);
    return;
  }
  if (password !== confirmPassword) {
    showFieldError('sp-new-db-pwd2', 'sp-err-new-db-pwd2', 'Введенные пароли не совпадают');
    return;
  }

  const projId = 'proj_' + Date.now();
  const now = new Date().toISOString();
  const dbName = (projectName && projectName.trim()) || `База ${cachedVaultProfiles.length + 1}`;

  const initialProject = {
    id: projId,
    name: dbName,
    type: 'browser',
    createdAt: now,
    updatedAt: now
  };

  const initialData = {
    version: 2,
    createdAt: now,
    updatedAt: now,
    projects: [initialProject],
    items: [
      {
        id: 'item_sample_1',
        projectId: projId,
        title: 'SimplePass',
        username: 'user@example.com',
        password: generatePassword({ length: 24 }),
        url: 'https://example.com',
        category: 'Work',
        notes: 'Начальная запись новой базы данных',
        updatedAt: now
      }
    ]
  };

  const recoveryPhrase = generateRecoveryPhrase();
  const rawMek = generateMek();
  const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
  const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(recoveryPhrase), 'mek-rec');
  const keySlots = { keyByPassword, keyByRecovery };
  const encrypted = await encryptVaultWithMek(initialData, rawMek, keySlots);

  // Creates separate vault profile without touching existing vaults
  const newProfile = await createVaultProfile(dbName, encrypted);
  cachedVaultProfiles = await getVaultProfiles();
  cachedActiveVaultId = newProfile.id;

  const session = await createSession(rawMek, 'session');
  failedAttempts = 0;
  lockoutUntil = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
  }

  isCreatingNewVaultFromLock = false;
  isRecoveryViewActive = false;
  newlyCreatedRecoveryPhrase = recoveryPhrase;

  updateState({
    isInitialized: true,
    isUnlocked: true,
    rawMek,
    keySlots,
    projects: initialData.projects,
    items: initialData.items,
    activeProjectId: projId,
    sessionExpiresAt: session.expiresAt
  });
}

async function handleRestoreWithRecovery(phrase, newPassword, confirmPassword) {
  clearFieldErrors();
  const normPhrase = phrase ? phrase.trim().toLowerCase().split(/\s+/).join(' ') : '';
  if (!normPhrase || normPhrase.split(' ').length !== 12) {
    showFieldError('sp-recover-phrase', 'sp-err-recover-phrase', 'Введите ровно 12 слов ключа восстановления через пробел');
    return;
  }

  const pwdVal = validateMasterPassword(newPassword);
  if (!pwdVal.valid) {
    showFieldError('sp-recover-new-pwd', 'sp-err-recover-pwd', pwdVal.error);
    return;
  }
  if (newPassword !== confirmPassword) {
    showFieldError('sp-recover-new-pwd2', 'sp-err-recover-pwd2', 'Введенные новые пароли не совпадают');
    return;
  }

  try {
    const envelope = await getStoredVault();
    const { vaultData, rawMek } = await decryptVaultWithRecovery(envelope, normPhrase);
    const normalized = normalizeVaultData(vaultData);
    syncCachedFaviconsFromItems(normalized.items);

    // Re-wrap keyByPassword with new master password, keeping rawMek and new recovery key!
    const keyByPassword = await wrapMek(rawMek, newPassword, 'mek-pwd');
    const newRecoveryPhrase = generateRecoveryPhrase();
    const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(newRecoveryPhrase), 'mek-rec');
    const keySlots = { keyByPassword, keyByRecovery };
    const rekeyedEnvelope = await encryptVaultWithMek(normalized, rawMek, keySlots);
    await saveStoredVault(rekeyedEnvelope);

    // Reset failed attempts & lockout
    failedAttempts = 0;
    lockoutUntil = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
    }

    const session = await createSession(rawMek, 'session');
    isRecoveryViewActive = false;
    newlyCreatedRecoveryPhrase = newRecoveryPhrase;

    updateState({
      isUnlocked: true,
      rawMek,
      keySlots,
      projects: normalized.projects,
      items: normalized.items,
      activeProjectId: normalized.projects[0].id,
      sessionExpiresAt: session.expiresAt
    });
    showToast('Доступ восстановлен! Сохраните новый ключ восстановления.');
  } catch (err) {
    showFieldError('sp-recover-phrase', 'sp-err-recover-phrase', 'Неверный ключ восстановления или поврежденные данные.');
  }
}

async function persistVaultChanges() {
  if (!state.rawMek || !state.keySlots) {
    showToast(t('errors.session_invalid') || 'Сессия повреждена, войдите заново');
    await lockVault();
    return;
  }

  const isV3 = Boolean(state.keySlots && state.keySlots.keyByPassword && state.keySlots.keyByPassword.aad);
  const vaultData = {
    version: isV3 ? 3 : 2,
    updatedAt: new Date().toISOString(),
    projects: state.projects,
    items: state.items
  };
  const encrypted = await encryptVaultWithMek(vaultData, state.rawMek, state.keySlots);
  await saveStoredVault(encrypted);

  const cfg = await getStoredConfig();
  await saveStoredConfig({
    ...cfg,
    activeProjectId: state.activeProjectId,
    latestProjectId: state.activeProjectId
  });
}

async function saveItem(itemData) {
  const activeProj = getActiveProject();
  const projectId = itemData.projectId || (activeProj ? activeProj.id : 'proj_default');
  const proj = state.projects.find(p => p.id === projectId);

  const existingIdx = state.items.findIndex(i => i.id === itemData.id);
  let updatedItems = [...state.items];

  const domain = extractCleanDomain(itemData.url);
  const domainNoPort = domain ? domain.split(':')[0] : '';
  let favicon = itemData.favicon || '';
  if (!favicon && domain) {
    favicon =
      cachedFavicons[domain] ||
      cachedFavicons[domainNoPort] ||
      (await getCachedFavicon(domain)) ||
      (await getCachedFavicon(domainNoPort)) ||
      '';
  }

  let itemToSave = {
    ...itemData,
    domain: domain || itemData.domain || '',
    favicon: favicon || (existingIdx >= 0 ? state.items[existingIdx].favicon : '') || '',
    projectId,
    updatedAt: new Date().toISOString()
  };

  if (itemToSave.domain && itemToSave.favicon) {
    cachedFavicons[itemToSave.domain] = itemToSave.favicon;
    if (domainNoPort) cachedFavicons[domainNoPort] = itemToSave.favicon;
  }

  if (existingIdx >= 0) {
    updatedItems[existingIdx] = itemToSave;
  } else {
    itemToSave.id = 'item_' + Date.now();
    updatedItems.unshift(itemToSave);
  }

  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();

  // If favicon wasn't cached yet, fetch in background and persist
  if (state.showFavicons && domain && !itemToSave.favicon) {
    resolveFavicon(itemData.url, { forceRefresh: false, activeTabFavIconUrl: activeTabFavicon })
      .then(async res => {
        if (res && res.favicon) {
          cachedFavicons[domain] = res.favicon;
          if (domainNoPort) cachedFavicons[domainNoPort] = res.favicon;
          const idx = state.items.findIndex(i => i.id === itemToSave.id);
          if (idx >= 0) {
            state.items[idx].favicon = res.favicon;
            state.items[idx].domain = domain;
            await persistVaultChanges();
            render();
          }
        }
      })
      .catch(() => {});
  }

  if (proj && proj.type === 'pass_cli') {
    try {
      await saveItemToPassCli(itemToSave);
      showToast('Сохранено и синхронизировано с PASS CLI');
    } catch (err) {
      console.warn('PASS CLI sync error:', err);
      showToast('Сохранено в хранилище (PASS: ' + err.message + ')');
    }
  } else {
    showToast('Пароль сохранён');
  }
}

async function deleteItem(id) {
  if (!confirm('Вы уверены, что хотите удалить этот пароль?')) return;
  const item = state.items.find(i => i.id === id);
  const proj = item ? state.projects.find(p => p.id === item.projectId) : null;

  const updatedItems = state.items.filter(i => i.id !== id);
  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();

  if (proj && proj.type === 'pass_cli' && item) {
    try {
      await deleteItemFromPassCli(item);
      showToast('Удалено из хранилища и PASS CLI');
    } catch (err) {
      console.warn('PASS CLI delete error:', err);
      showToast('Удалено из хранилища');
    }
  } else {
    showToast('Пароль удалён');
  }
}

function triggerAutofill(item, forceFill = false) {
  const itemUrl = item.url || item.domain || '';
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && activeTabId) {
    chrome.runtime.sendMessage(
      {
        type: 'AUTOFILL_LOGIN',
        tabId: activeTabId,
        itemUrl,
        username: item.username,
        password: item.password,
        forceFill
      },
      response => {
        if (response && response.success) {
          showToast(t('toasts.form_autofilled') || 'Форма успешно заполнена!');
        } else if (response && response.reason === 'domain_mismatch') {
          const tabDomain = response.tabDomain || 'текущего сайта';
          const itemDomain = response.itemDomain || 'этой записи';
          const warnMsg = `Внимание! Возможен фишинг:\nЗапись предназначена для «${itemDomain}», а активная страница — «${tabDomain}».\n\nЗаполнить форму всё равно?`;
          if (window.confirm(warnMsg)) {
            triggerAutofill(item, true);
          }
        } else {
          showToast(t('toasts.autofill_copied') || 'Скопировано в буфер (поля не найдены)');
          copyToClipboard(item.password);
        }
      }
    );
  } else {
    copyToClipboard(item.password);
    showToast(t('toasts.copied') || 'Пароль скопирован в буфер');
  }
}

function showToast(text) {
  let toast = document.getElementById('sp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-toast';
    toast.style.cssText = `
      position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%);
      background: var(--text-main); color: var(--bg-main); font-size: 12px; font-weight: 600;
      border: 1px solid var(--border-subtle);
      padding: 8px 16px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      z-index: 9999; transition: opacity 0.2s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = text;
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 2200);
}

// ─── RENDERERS ────────────────────────────────────────────────────────────────

function render() {
  if (!state.isUnlocked) {
    renderAuthScreen();
    return;
  }

  const activeElId = document.activeElement ? document.activeElement.id : null;
  const selStart = document.activeElement && 'selectionStart' in document.activeElement ? document.activeElement.selectionStart : null;
  const selEnd = document.activeElement && 'selectionEnd' in document.activeElement ? document.activeElement.selectionEnd : null;

  const activeProj = getActiveProject();
  const activeItems = getActiveProjectItems();

  // Section title mapping
  let sectionTitle = t('nav.passwords');
  if (state.activeTab === 'generator') {
    sectionTitle = t('nav.generator');
  } else if (state.activeTab === 'settings') {
    sectionTitle = t('nav.settings');
  } else if (state.activeTab === 'item-details') {
    sectionTitle = state.selectedItem ? t('form.edit_title') : t('form.new_title');
  }

  rootEl.innerHTML = `
    <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <!-- Top Bar (mySmart style: Burger + Current Section Title + Action Icons) -->
      <header class="sp-header">
        <div class="sp-header-left">
          <button class="sp-btn-icon" id="sp-burger-btn" title="${t('nav.menu')}">${icons.iMenu}</button>
          <span class="sp-header-title" id="sp-header-title">${sectionTitle}</span>
        </div>
        <div class="sp-header-actions">
          <button class="sp-btn-add-pwd" id="sp-btn-add" title="${t('nav.add_password')}">
            ${icons.iPlus}
            <span>${t('nav.add_password')}</span>
          </button>
          <button class="sp-btn-icon" id="sp-btn-lock" title="${t('nav.lock_vault')}">${icons.iLock}</button>
        </div>
      </header>

      <!-- Slide-Over Drawer Navigation (mySmart style) -->
      <div class="sp-drawer-overlay ${isDrawerOpen ? 'open' : ''}" id="sp-drawer-overlay"></div>
      <aside class="sp-drawer ${isDrawerOpen ? 'open' : ''}" id="sp-drawer">
        <div class="sp-drawer-header">
          <span class="sp-drawer-heading">${t('nav.menu')}</span>
          <button class="sp-btn-icon" id="sp-close-drawer-btn" title="${t('nav.close')}">${icons.iX}</button>
        </div>
        <nav class="sp-drawer-menu">
          <button class="sp-drawer-item ${state.activeTab === 'vault' ? 'active' : ''}" data-nav="vault">
            <span class="sp-drawer-item-icon">${icons.iKey}</span>
            <span>${t('nav.passwords')}</span>
            <span class="sp-drawer-item-badge">${activeItems.length}</span>
          </button>
          <button class="sp-drawer-item ${state.activeTab === 'generator' ? 'active' : ''}" data-nav="generator">
            <span class="sp-drawer-item-icon">${icons.iDice}</span>
            <span>${t('nav.generator')}</span>
          </button>
          <button class="sp-drawer-item ${state.activeTab === 'settings' ? 'active' : ''}" data-nav="settings">
            <span class="sp-drawer-item-icon">${icons.iSettings}</span>
            <span>${t('nav.settings')}</span>
          </button>
        </nav>
      </aside>

      <!-- Main Content Container -->
      <main id="sp-tab-content" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
        ${renderActiveTabContent()}
      </main>

      <!-- Footer (mySmart style Project Switcher Trigger) -->
      <footer class="sp-footer">
        <div class="sp-footer-left">
          <span>${t('footer.items_count', { count: activeItems.length })}</span>
        </div>
        <div class="sp-footer-right">
          <div class="sp-project-badge ${state.isProjectSwitcherOpen ? 'active' : ''}" id="sp-project-container" title="${t('footer.db_project')}">
            <span class="sp-project-dot"></span>
            <span id="sp-project-display">${activeProj ? activeProj.name : '—'}</span>
          </div>
        </div>
      </footer>

      <!-- Sliding Project Switcher Panel -->
      ${renderProjectSwitcherPanel()}

      <!-- Cascade Delete Confirmation Modal -->
      ${renderDeleteModal()}

      <!-- PASS CLI Instructions Modal -->
      ${renderPassInstructionsModal()}

      <!-- 12-Word Recovery Key Backup Modal (shown on profile creation or recovery rekey) -->
      ${renderRecoveryBackupModal()}
    </div>
  `;

  attachEventHandlers();

  if (activeElId) {
    const el = document.getElementById(activeElId);
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.focus();
      if (selStart !== null && selEnd !== null) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch (_) {}
      }
    }
  }
}

function renderActiveTabContent() {
  if (state.activeTab === 'item-details') {
    return renderItemFormView();
  }
  if (state.activeTab === 'generator') {
    return renderGeneratorView();
  }
  if (state.activeTab === 'settings') {
    return renderSettingsView();
  }
  return renderVaultView();
}

// ─── AUTH SCREEN (LOCK / FIRST RUN) ──────────────────────────────────────────

function renderAuthScreen() {
  // 1. First-time initialization screen
  if (!state.isInitialized) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.create_profile_title')}</h2>
          <p class="sp-auth-desc">${t('auth.create_profile_desc')}</p>
          <form class="sp-auth-form" id="sp-init-form" novalidate>
            <div>
              <input type="text" id="sp-init-proj-name" class="sp-input" placeholder="${t('auth.profile_name_placeholder')}" />
              <div class="sp-field-error" id="sp-err-proj-name"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-pwd"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${t('auth.create_profile_btn')}
            </button>
          </form>
        </div>
      </div>
    `;

    ['sp-init-proj-name', 'sp-init-pwd', 'sp-init-pwd2'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('input', () => {
          inp.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-init-', 'sp-err-'));
          if (errEl) {
            errEl.innerText = '';
            errEl.style.display = 'none';
          }
        });
      }
    });

    document.getElementById('sp-init-form').addEventListener('submit', e => {
      e.preventDefault();
      const proj = document.getElementById('sp-init-proj-name').value;
      const p1 = document.getElementById('sp-init-pwd').value;
      const p2 = document.getElementById('sp-init-pwd2').value;
      handleCreateVault(proj, p1, p2);
    });
    return;
  }

  // 2. New Database Creation from Lock Screen / Recovery
  if (isCreatingNewVaultFromLock) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.new_db_title')}</h2>
          <p class="sp-auth-desc">${t('auth.new_db_desc')}</p>

          <form class="sp-auth-form" id="sp-new-db-form" novalidate>
            <div>
              <input type="text" id="sp-new-db-name" class="sp-input" placeholder="${t('auth.db_name_placeholder')}" autofocus />
              <div class="sp-field-error" id="sp-err-new-db-name"></div>
            </div>
            <div>
              <input type="password" id="sp-new-db-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-new-db-pwd"></div>
            </div>
            <div>
              <input type="password" id="sp-new-db-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-new-db-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iPlus} ${t('auth.create_and_enter_btn')}
            </button>
            <div style="text-align:center; margin-top: 8px;">
              <button type="button" class="sp-link-btn" id="sp-btn-cancel-new-db">${t('auth.cancel_btn')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    ['sp-new-db-name', 'sp-new-db-pwd', 'sp-new-db-pwd2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          el.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-new-db-', 'sp-err-new-db-'));
          if (errEl) { errEl.innerText = ''; errEl.style.display = 'none'; }
        });
      }
    });

    const btnCancelNew = document.getElementById('sp-btn-cancel-new-db');
    if (btnCancelNew) {
      btnCancelNew.addEventListener('click', () => {
        isCreatingNewVaultFromLock = false;
        renderAuthScreen();
      });
    }

    document.getElementById('sp-new-db-form').addEventListener('submit', e => {
      e.preventDefault();
      const dbName = document.getElementById('sp-new-db-name').value;
      const p1 = document.getElementById('sp-new-db-pwd').value;
      const p2 = document.getElementById('sp-new-db-pwd2').value;
      handleCreateAdditionalVault(dbName, p1, p2);
    });
    return;
  }

  // 3. Recovery screen view
  if (isRecoveryViewActive) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.recovery_title')}</h2>
          <p class="sp-auth-desc">${t('auth.recovery_desc')}</p>

          <form class="sp-auth-form" id="sp-recovery-form" novalidate>
            <div>
              <textarea id="sp-recover-phrase" class="sp-input" style="height: 72px; resize:none; font-family:monospace; font-size:12px; line-height:1.4;" placeholder="${t('auth.recovery_phrase_placeholder')}"></textarea>
              <div class="sp-field-error" id="sp-err-recover-phrase"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-recover-pwd"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-recover-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iUnlock} ${t('auth.restore_access_btn')}
            </button>
            <button type="button" class="sp-btn-secondary" id="sp-btn-create-new-vault" style="width:100%; justify-content:center; margin-top: 8px;">
              ${icons.iPlus} ${t('auth.create_new_db_btn')}
            </button>
            <div style="text-align:center; margin-top: 8px;">
              <button type="button" class="sp-link-btn" id="sp-btn-cancel-recovery">${t('auth.return_to_login_btn')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    ['sp-recover-phrase', 'sp-recover-new-pwd', 'sp-recover-new-pwd2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          el.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-recover-', 'sp-err-recover-'));
          if (errEl) { errEl.innerText = ''; errEl.style.display = 'none'; }
        });
      }
    });

    const btnCreateNewVault = document.getElementById('sp-btn-create-new-vault');
    if (btnCreateNewVault) {
      btnCreateNewVault.addEventListener('click', () => {
        isRecoveryViewActive = false;
        isCreatingNewVaultFromLock = true;
        renderAuthScreen();
      });
    }

    const btnCancel = document.getElementById('sp-btn-cancel-recovery');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        isRecoveryViewActive = false;
        renderAuthScreen();
      });
    }

    document.getElementById('sp-recovery-form').addEventListener('submit', e => {
      e.preventDefault();
      const phrase = document.getElementById('sp-recover-phrase').value;
      const p1 = document.getElementById('sp-recover-new-pwd').value;
      const p2 = document.getElementById('sp-recover-new-pwd2').value;
      handleRestoreWithRecovery(phrase, p1, p2);
    });
    return;
  }

  // 4. Profile Selector Screen ("Войти в другой профиль")
  if (isProfileSelectorViewActive) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.select_profile_title')}</h2>
          <p class="sp-auth-desc">${t('auth.select_profile_desc')}</p>

          <div class="sp-profile-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px; width:100%;">
            ${cachedVaultProfiles.map(p => `
              <div class="sp-profile-select-item ${p.id === cachedActiveVaultId ? 'active' : ''}" data-vault-id="${p.id}">
                <div style="display:flex; align-items:center; gap:10px;">
                  <span style="font-size:16px;">🗄️</span>
                  <span style="font-weight:${p.id === cachedActiveVaultId ? '600' : '500'}; font-size:13px; color:var(--text-main);">${p.name}</span>
                </div>
                ${p.id === cachedActiveVaultId ? '<span style="color:var(--sp-primary); font-weight:bold; font-size:13px;">✓</span>' : ''}
              </div>
            `).join('')}
          </div>

          <button type="button" class="sp-btn-secondary" id="sp-btn-profile-create-new" style="width:100%; justify-content:center; margin-bottom:10px;">
            ${icons.iPlus} ${t('auth.create_new_db_btn')}
          </button>

          <div style="text-align:center;">
            <button type="button" class="sp-link-btn" id="sp-btn-cancel-profile-select">${t('auth.return_to_login_btn')}</button>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.sp-profile-select-item').forEach(el => {
      el.addEventListener('click', async () => {
        const vId = el.dataset.vaultId;
        if (vId && vId !== cachedActiveVaultId) {
          cachedActiveVaultId = vId;
          await setActiveVaultId(vId);
          failedAttempts = 0;
          lockoutUntil = 0;
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
          }
        }
        isProfileSelectorViewActive = false;
        renderAuthScreen();
      });
    });

    const btnNew = document.getElementById('sp-btn-profile-create-new');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        isProfileSelectorViewActive = false;
        isCreatingNewVaultFromLock = true;
        renderAuthScreen();
      });
    }

    const btnCancel = document.getElementById('sp-btn-cancel-profile-select');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        isProfileSelectorViewActive = false;
        renderAuthScreen();
      });
    }
    return;
  }

  // 5. Normal Lock Screen with exponential delay lockout, "Забыли пароль?" and "Войти в другой профиль"
  if (lockoutTimer) {
    clearInterval(lockoutTimer);
    lockoutTimer = null;
  }
  const remSec = getRemainingLockoutSeconds();
  const isLockedOut = remSec > 0;

  rootEl.innerHTML = `
    <div class="sp-auth-screen">
      <div class="sp-auth-box">
        <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;display:block;object-fit:contain;" alt="Logo" /></div>
        <h2 class="sp-auth-title">${t('auth.locked_title')}</h2>
        <p class="sp-auth-desc">${t('auth.locked_desc')}</p>

        ${isLockedOut ? `
          <div class="sp-lockout-alert" id="sp-lockout-msg">
            Слишком много неверных попыток. Подождите <span id="sp-lockout-seconds" style="font-weight:bold;">${remSec}</span> сек.
          </div>
        ` : ''}

        <form class="sp-auth-form" id="sp-unlock-form" novalidate>
          <div>
            <input type="password" id="sp-unlock-pwd" class="sp-input" placeholder="${t('settings.master_pwd_label')}" ${isLockedOut ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'autofocus'} />
            <div class="sp-field-error" id="sp-err-unlock" ${failedAttempts > 0 && !isLockedOut ? 'style="display:block;"' : ''}>${failedAttempts > 0 && !isLockedOut ? `Неверный мастер-пароль. Попытка ${failedAttempts}.` : ''}</div>
          </div>

          <button type="submit" class="sp-btn-primary" ${isLockedOut ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} style="justify-content:center; margin-top: 6px;">
            ${icons.iUnlock} ${t('auth.unlock_btn')}
          </button>

          <div id="sp-auth-links-wrap" style="text-align:center; margin-top: 10px; display:flex; flex-direction:column; gap:6px; align-items:center;">
            <button type="button" class="sp-link-btn" id="sp-forgot-pwd">${t('auth.forgot_pwd_btn')}</button>
            <button type="button" class="sp-link-btn" id="sp-switch-profile" style="color:var(--text-dim); font-size:12px;">${t('auth.switch_profile_btn')}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  if (isLockedOut) {
    lockoutTimer = setInterval(() => {
      const currentRem = getRemainingLockoutSeconds();
      const secEl = document.getElementById('sp-lockout-seconds');
      if (secEl) secEl.innerText = currentRem;
      if (currentRem <= 0) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        renderAuthScreen();
      }
    }, 1000);
  }

  const switchProfileBtn = document.getElementById('sp-switch-profile');
  if (switchProfileBtn) {
    switchProfileBtn.addEventListener('click', () => {
      isProfileSelectorViewActive = true;
      renderAuthScreen();
    });
  }

  const unlockInp = document.getElementById('sp-unlock-pwd');
  if (unlockInp) {
    unlockInp.addEventListener('input', () => {
      unlockInp.classList.remove('has-error');
      const errEl = document.getElementById('sp-err-unlock');
      if (errEl) {
        errEl.innerText = '';
        errEl.style.display = 'none';
      }
    });
  }

  const forgotBtn = document.getElementById('sp-forgot-pwd');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      isRecoveryViewActive = true;
      renderAuthScreen();
    });
  }

  const unlockForm = document.getElementById('sp-unlock-form');
  if (unlockForm) {
    unlockForm.addEventListener('submit', e => {
      e.preventDefault();
      if (isLockedOut) return;
      const p = document.getElementById('sp-unlock-pwd').value;
      handleUnlock(p);
    });
  }
}

// ─── VAULT VIEW ──────────────────────────────────────────────────────────────

function downloadItemAsCsv(item) {
  if (!item) return;
  const csvContent = itemsToCsv([item]);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (item.title || 'password').replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '_');
  a.download = `${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(t('toasts.item_csv_exported'));
}

function renderVaultView() {
  const query = state.searchQuery.toLowerCase().trim();
  const cat = state.activeCategory;
  const projectItems = getActiveProjectItems();

  const filteredItems = projectItems.filter(item => {
    const itemTags = getItemTags(item);
    const matchesCat = cat === 'All' || itemTags.includes(cat) || item.category === cat;
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.domain && item.domain.toLowerCase().includes(query)) ||
      (item.username && item.username.toLowerCase().includes(query)) ||
      (item.url && item.url.toLowerCase().includes(query)) ||
      itemTags.some(t => t.toLowerCase().includes(query));
    return matchesCat && matchesQuery;
  });

  // Sort items: matching active domain cards appear at the top
  const sortedItems = sortItemsByDomainMatch(filteredItems, activeTabDomain);

  let activeDomainNotice = '';
  if (activeTabDomain) {
    const domainMatches = projectItems.filter(i => isItemMatchingDomain(i, activeTabDomain));
    const displayDomain = extractDomainName(activeTabDomain);
    if (domainMatches.length > 0 && displayDomain) {
      activeDomainNotice = `
        <div id="sp-active-domain-banner" style="background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 6px 12px; margin: 8px 14px 0; border-radius: var(--radius-sm); font-size: 11px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.15s ease;" title="${t('vault.filter_domain_title')}">
          <span style="color: var(--text-main); font-weight: 600; display:flex; align-items:center; gap:6px;">
            <span style="color:var(--accent);">${icons.iGlobe}</span> ${t('vault.current_site')}: <b>${escapeHtml(displayDomain)}</b> (${domainMatches.length})
          </span>
          <button class="sp-btn-icon" id="sp-filter-domain" style="width:20px;height:20px;" title="${t('vault.filter_domain_title')}">${icons.iSearch}</button>
        </div>
      `;
    }
  }

  const pillsHtml = state.categories
    .map(c => {
      const isAll = c === 'All';
      const label = isAll ? t('categories.All') : (c === 'Work' ? t('categories.Work') : (c === 'Personal' ? t('categories.Personal') : c));
      if (isAll) {
        return `<button class="sp-pill sp-pill-all ${c === state.activeCategory ? 'active' : ''}" data-cat="${c}">${label}</button>`;
      }
      const colorDef = getCategoryColorDef(c, state.categoryColors);
      const cssVars = getCategoryCssVars(colorDef);
      return `
        <button class="sp-pill ${c === state.activeCategory ? 'active' : ''}" data-color-pill="true" data-cat="${c}" style="${cssVars}">
          <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
          <span>${label}</span>
        </button>
      `;
    })
    .join('');

  const cardsHtml =
    sortedItems.length === 0
      ? `
      <div class="sp-empty-state">
        <div class="sp-empty-icon">${icons.iKey}</div>
        <p style="font-size: 13px; font-weight: 600;">${t('vault.empty_title')}</p>
        <p style="font-size: 11px;">${t('vault.empty_desc')}</p>
        <button type="button" class="sp-btn-add-pwd" id="sp-empty-btn-add" style="margin-top:8px;">
          ${icons.iPlus}
          <span>${t('nav.add_password')}</span>
        </button>
      </div>
    `
      : sortedItems
          .map(item => {
            const letter = item.title ? item.title[0] : '?';
            const isMatched = isItemMatchingDomain(item, activeTabDomain);
            const itemDomain = item.domain || extractCleanDomain(item.url);
            const itemDomainNoPort = itemDomain ? itemDomain.split(':')[0] : '';
            const itemFavicon = state.showFavicons
              ? (item.favicon || (itemDomain && cachedFavicons[itemDomain]) || (itemDomainNoPort && cachedFavicons[itemDomainNoPort]))
              : null;
            const avatarContent = itemFavicon
              ? `<img src="${escapeHtml(itemFavicon)}" class="sp-card-favicon" alt="" /><span class="sp-card-fallback-letter" style="display:none;">${letter}</span>`
              : `<span>${letter}</span>`;
            let tagsHtml = '';
            if (state.showCardTags) {
              const itemTags = getItemTags(item);
              tagsHtml = itemTags
                .map(tName => {
                  const colorDef = getCategoryColorDef(tName, state.categoryColors);
                  const cssVars = getCategoryCssVars(colorDef);
                  const label = tName === 'Work' ? t('categories.Work') : (tName === 'Personal' ? t('categories.Personal') : tName);
                  return `<span class="sp-pill sp-pill-tag-card" data-color-pill="true" style="${cssVars}; pointer-events:none;"><span class="sp-pill-dot" style="background-color:${colorDef.color};"></span><span>${escapeHtml(label)}</span></span>`;
                })
                .join('');
            }

            return `
        <div class="sp-card ${isMatched ? 'sp-card-matched' : ''}" data-id="${item.id}">
          <div class="sp-card-left" data-action="view">
            <div class="sp-card-avatar">${avatarContent}</div>
            <div class="sp-card-meta">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="sp-card-title">${escapeHtml(item.title)}</span>
                ${tagsHtml}
              </div>
              <span class="sp-card-sub">${escapeHtml(item.username || item.url || t('vault.no_login'))}</span>
            </div>
          </div>
          <div class="sp-card-actions">
            <button class="sp-btn-icon" data-action="copy-user" title="${t('vault.copy_user')}">${icons.iCopy}</button>
            <button class="sp-btn-icon" data-action="copy-pwd" title="${t('vault.copy_pwd')}">${icons.iKey}</button>
          </div>
        </div>
      `;
          })
          .join('');

  return `
    <div class="sp-search-bar">
      <div class="sp-search-input-wrap">
        <span class="sp-search-icon">${icons.iSearch}</span>
        <input type="text" id="sp-search-input" class="sp-search-input" placeholder="${t('vault.search_placeholder')}" value="${state.searchQuery}" />
        ${state.searchQuery ? `<button class="sp-search-clear" id="sp-search-clear">${icons.iX}</button>` : ''}
      </div>
      <div class="sp-category-pills">
        ${pillsHtml}
      </div>
    </div>
    ${activeDomainNotice}
    <div class="sp-vault-list">
      ${cardsHtml}
    </div>
  `;
}

// ─── PROJECT SWITCHER PANEL (mySmart Style) ──────────────────────────────────

function renderProjectSwitcherPanel() {
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
              <span class="sp-project-name">${p.name}</span>
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

// ─── CASCADE DELETE MODAL ────────────────────────────────────────────────────

function renderDeleteModal() {
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
          ${t('delete_modal.desc', { name: proj.name, count })}
        </div>

        <form id="sp-delete-project-form" style="display:flex; flex-direction:column; gap:10px;">
          <div class="sp-form-group">
            <label class="sp-label">${t('form.title_label')}: «<strong>${proj.name}</strong>»:</label>
            <input type="text" id="sp-delete-confirm-name" class="sp-input" placeholder="${proj.name}" required />
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

// ─── PASS CLI INSTRUCTIONS MODAL ─────────────────────────────────────────────

function renderPassInstructionsModal() {
  if (!state.isShowPassInstructions) return '';

  return `
    <div class="sp-modal-overlay" id="sp-pass-instructions-overlay">
      <div class="sp-modal-content" style="max-width: 360px;">
        <div class="sp-modal-header">
          <span class="sp-modal-title" style="color:var(--text-main);">${icons.iFolder} Подключение UNIX PASS CLI</span>
          <button class="sp-btn-icon" id="sp-btn-close-pass-instructions">${icons.iX}</button>
        </div>

        <p class="sp-modal-desc">
          SimplePass может работать напрямую с вашим локальным хранилищем <code>~/.password-store</code> через Native Messaging.
        </p>

        <div style="display:flex; flex-direction:column; gap:8px; font-size:11px;">
          <div><strong>1. Установите pass и GPG (если не установлены):</strong></div>
          <div class="sp-code-block">brew install pass gnupg</div>

          <div><strong>2. Запустите скрипт регистрации Native Host:</strong></div>
          <div class="sp-code-block">cd /Users/dima/Projects/SimplePassManager/native-host &amp;&amp; ./install.sh</div>

          <div><strong>3. Проверьте подключение:</strong></div>
          <div style="color:var(--text-dim); line-height:1.4;">
            После запуска скрипта перезапустите расширение или нажмите «Проверить подключение» в настройках.
          </div>
        </div>

        <button type="button" class="sp-btn-primary" id="sp-btn-ack-pass-instructions" style="justify-content:center; margin-top:6px;">
          Понятно
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCsvFile(csvContent) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentVal += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\r') {
        // skip carriage return
      } else if (char === '\n') {
        currentRow.push(currentVal.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
  }
  if (currentVal || currentRow.length) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) {
    throw new Error('CSV-файл пуст или не содержит строк с данными.');
  }

  const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const findCol = (...names) => {
    return headers.findIndex(h => names.some(n => h === n || h.includes(n)));
  };

  const colTitle = findCol('name', 'title', 'site');
  const colUrl = findCol('url', 'uri', 'website', 'login_uri');
  const colUser = findCol('username', 'login', 'email', 'user');
  const colPass = findCol('password', 'pass');
  const colNotes = findCol('notes', 'note', 'comment');
  const colCategory = findCol('category', 'folder', 'group');

  if (colPass === -1 && colTitle === -1) {
    throw new Error('Не удалось распознать заголовки CSV (требуются хотя бы Title/Name или Password).');
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const password = colPass !== -1 ? (row[colPass] || '') : '';
    const title = colTitle !== -1 ? (row[colTitle] || '') : '';
    if (!password && !title) continue;

    items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: title || 'Без названия',
      password: password,
      username: colUser !== -1 ? (row[colUser] || '') : '',
      url: colUrl !== -1 ? (row[colUrl] || '') : '',
      notes: colNotes !== -1 ? (row[colNotes] || '') : '',
      category: colCategory !== -1 && row[colCategory] ? row[colCategory] : 'Work',
      updatedAt: new Date().toISOString()
    });
  }

  return items;
}

function renderRecoveryBackupModal() {
  if (!newlyCreatedRecoveryPhrase) return '';

  const words = newlyCreatedRecoveryPhrase.split(' ');
  const wordsGridHtml = words.map((w, idx) => `
    <div class="sp-recovery-word-card">
      <span class="sp-recovery-word-num">${idx + 1}.</span>
      <span class="sp-recovery-word-val">${w}</span>
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

// ─── ITEM FORM VIEW (ADD / EDIT) ─────────────────────────────────────────────

function renderItemFormView() {
  const activeProj = getActiveProject();
  const isNew = !state.selectedItem;
  const targetFormId = state.selectedItem ? state.selectedItem.id : '__new__';

  const hasValidDraft = formDraft && (
    (isNew && formDraft.isNew) ||
    (!isNew && formDraft.id === state.selectedItem.id)
  );

  if (currentFormItemId !== targetFormId) {
    currentFormItemId = targetFormId;
    if (hasValidDraft && Array.isArray(formDraft.tags)) {
      formSelectedTags = [...formDraft.tags];
    } else {
      formSelectedTags = isNew ? [] : getItemTags(state.selectedItem);
    }
  }

  const defaultProjId = activeProj ? activeProj.id : (state.projects[0] ? state.projects[0].id : 'proj_default');
  const baseItem = state.selectedItem || {
    id: '',
    projectId: defaultProjId,
    title: '',
    username: '',
    password: '',
    url: activeTabDomain
      ? (activeTabDomain.includes(':') || isLocalOrPrivateHost(activeTabDomain) ? `http://${activeTabDomain}` : `https://${activeTabDomain}`)
      : '',
    domain: extractDomainName(activeTabDomain) || '',
    favicon: (activeTabDomain && cachedFavicons[activeTabDomain]) || (activeTabDomain && cachedFavicons[activeTabDomain.split(':')[0]]) || '',
    category: '',
    notes: ''
  };

  const item = hasValidDraft ? {
    id: formDraft.id,
    projectId: formDraft.projectId || baseItem.projectId,
    title: formDraft.title !== undefined ? formDraft.title : baseItem.title,
    username: formDraft.username !== undefined ? formDraft.username : baseItem.username,
    password: formDraft.password !== undefined ? formDraft.password : baseItem.password,
    url: formDraft.url !== undefined ? formDraft.url : baseItem.url,
    domain: formDraft.domain !== undefined ? formDraft.domain : (baseItem.domain || ''),
    favicon: formDraft.favicon !== undefined ? formDraft.favicon : (baseItem.favicon || ''),
    category: formDraft.tags && formDraft.tags[0] ? formDraft.tags[0] : (baseItem.category || ''),
    notes: formDraft.notes !== undefined ? formDraft.notes : baseItem.notes
  } : baseItem;

  const currentProjId = item.projectId || defaultProjId;
  const currentProject = state.projects.find(p => p.id === currentProjId) || state.projects[0] || { id: 'proj_default', name: 'main' };

  const formDomain = extractDomainName(item.domain || item.url);
  const formDomainNoPort = formDomain ? formDomain.split(':')[0] : '';
  const formFavicon = state.showFavicons
    ? (item.favicon || (formDomain && cachedFavicons[formDomain]) || (formDomainNoPort && cachedFavicons[formDomainNoPort]) || '')
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
            <input type="${isPasswordVisible ? 'text' : 'password'}" id="sp-item-password" class="sp-input" value="${escapeHtml(item.password || '')}" autocomplete="off" style="padding-right: 36px;" />
            <button type="button" class="sp-input-action-btn" id="sp-toggle-pwd-vis">
              ${isPasswordVisible ? icons.iEyeOff : icons.iEye}
            </button>
          </div>
          <div class="sp-field-error" id="sp-item-password-error"></div>
        </div>

        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="sp-label" style="margin:0;">${t('form.category_label')}</label>
            <span style="font-size:11px; color:var(--text-dim);">${formSelectedTags.length} ${t('form.category_label').toLowerCase()}</span>
          </div>

          <!-- Selected tags badges with remove button -->
          <div class="sp-form-tags-selected" id="sp-form-tags-selected">
            ${formSelectedTags.length > 0 ? formSelectedTags.map(tagName => {
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
            }).join('') : `<span style="font-size:11px; color:var(--text-dim);">${t('form.tags_no_tags')}</span>`}
          </div>

          <!-- Tag search & dropdown -->
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

// ─── GENERATOR VIEW ──────────────────────────────────────────────────────────

function renderGeneratorView() {
  if (!currentGeneratedPassword) {
    currentGeneratedPassword = generatePassword(genOptions);
  }

  return `
    <div class="sp-view-container">
      <div class="sp-gen-result-card">
        <div style="display:flex; justify-content:flex-end; align-items:center;">
          <div style="display:flex; gap:4px;">
            <button class="sp-btn-icon" id="sp-gen-refresh" title="${t('generator.refresh_title')}">${icons.iRefresh}</button>
            <button class="sp-btn-icon" id="sp-gen-copy" title="${t('generator.copy_title')}">${icons.iCopy}</button>
          </div>
        </div>
        <div class="sp-gen-password-display" id="sp-gen-display">${currentGeneratedPassword}</div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <label class="sp-label" style="margin:0;">${t('generator.length_label')}</label>
            <span style="font-size:13px; font-weight:700; color:var(--text-main);" id="sp-length-val">${genOptions.length}</span>
          </div>
          <input type="range" id="sp-slider-len" min="8" max="64" value="${genOptions.length}" style="width:100%; accent-color:var(--text-main); cursor:pointer;" />
        </div>

        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.uppercase')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-upper" ${genOptions.useUpper ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.lowercase')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-lower" ${genOptions.useLower ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.numbers')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-digits" ${genOptions.useDigits ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.symbols')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-symbols" ${genOptions.useSymbols ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.avoid_ambiguous')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-ambig" ${genOptions.avoidAmbiguous ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

// ─── SETTINGS VIEW (mySmart Style Accordions & Search) ──────────────────────

function renderSettingsView() {
  const query = settingsSearchQuery.toLowerCase().trim();

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
        <div class="sp-custom-select ${isLangSelectOpen ? 'open' : ''}" id="sp-setting-lang-dropdown">
          <button type="button" class="sp-custom-select-trigger" id="sp-custom-lang-trigger" aria-haspopup="listbox" aria-expanded="${isLangSelectOpen}">
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
        <div class="sp-custom-select ${isCustomSelectOpen ? 'open' : ''}" id="sp-setting-lock-interval-dropdown">
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
        <div class="sp-custom-select ${isAutolockSelectOpen ? 'open' : ''}" id="sp-setting-autolock-dropdown">
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
          ${isChangePwdOpen ? t('form.cancel_btn') : t('settings.change_pwd_btn')}
        </button>
      </div>
      <p class="sp-setting-desc">${t('settings.master_pwd_desc')}</p>

      ${
        isChangePwdOpen
          ? `
        <form id="sp-change-pwd-form" style="display:flex; flex-direction:column; gap:8px; margin-top:8px; padding:10px; background:var(--bg-surface); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
          <input type="password" id="sp-pwd-old" class="sp-input" placeholder="${t('settings.current_pwd_placeholder')}" required />
          <input type="password" id="sp-pwd-new" class="sp-input" placeholder="${t('settings.new_pwd_placeholder')}" required />
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
          <span class="sp-badge-info">${activeProj ? activeProj.name : '—'}</span>
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
          ${t('settings.check_status_btn')}
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

  // 3. Section: Tags Management (formerly Categories)
  const catItems = state.categories.filter(c => c !== 'All');
  const catListHtml = catItems.map(c => {
    const isDefault = c === 'Work' || c === 'Personal';
    const label = c === 'Work' ? t('categories.Work') : (c === 'Personal' ? t('categories.Personal') : c);
    const colorDef = getCategoryColorDef(c, state.categoryColors);
    const cssVars = getCategoryCssVars(colorDef);
    const isPickerOpen = activeColorPickerCat === c;
    const isEditing = editingTagId === c;

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
            const isSelected = color.id === selectedNewCatColor;
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
        const isSelected = exportSelectedTags.has(tag);
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
  if (exportSelectedTags.size === 0) {
    exportSummaryText = t('settings.export_tags_none_selected', { count: allProjectItems.length });
  } else {
    const matchingCount = allProjectItems.filter(item => {
      const itemTags = getItemTags(item);
      return itemTags.some(t => exportSelectedTags.has(t));
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
        <div class="sp-custom-select sp-custom-select-sm ${isExportFormatSelectOpen ? 'open' : ''}" id="sp-export-format-dropdown" style="width:105px; flex-shrink:0;">
          <button type="button" class="sp-custom-select-trigger" id="sp-export-format-trigger" aria-haspopup="listbox" aria-expanded="${isExportFormatSelectOpen}">
            <span class="sp-custom-select-value">${selectedExportFormat.toUpperCase()}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown" style="min-width:105px;">
            <div class="sp-custom-select-option ${selectedExportFormat === 'json' ? 'selected' : ''}" data-val="json" style="font-size:12px; padding:6px 10px;">
              <span>JSON</span>
              ${selectedExportFormat === 'json' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${selectedExportFormat === 'csv' ? 'selected' : ''}" data-val="csv" style="font-size:12px; padding:6px 10px;">
              <span>CSV</span>
              ${selectedExportFormat === 'csv' ? `<span style="color:var(--text-main);">${icons.iCheck}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- Advanced Export Options Toggle Link -->
      <div style="margin-top:8px;">
        <button type="button" class="sp-export-advanced-toggle" id="sp-export-advanced-toggle" style="background:none; border:none; padding:0; display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--text-dim); cursor:pointer; text-decoration:none; transition:color 0.15s ease;">
          <span class="sp-settings-item-arrow ${isExportAdvancedOpen ? 'open' : ''}" style="display:inline-flex; align-items:center; transform:${isExportAdvancedOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition:transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);">${icons.iChevronDown}</span>
          <span style="text-decoration:underline;">${t('settings.export_advanced_link')}</span>
          ${exportSelectedTags.size > 0 ? `<span class="sp-badge-info" style="font-size:10px; padding:1px 5px; margin-left:2px;">${exportSelectedTags.size}</span>` : ''}
        </button>
      </div>

      <!-- Collapsible Advanced Export Panel -->
      ${isExportAdvancedOpen ? `
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

    ${cachedVaultProfiles.length > 1 ? `
    <div class="sp-setting-row" data-search="удалить текущую базу данных delete database">
      <div class="sp-setting-header">
        <span class="sp-setting-label" style="color:var(--danger);">${t('settings.delete_current_vault_btn')}</span>
      </div>
      <p class="sp-setting-desc">${t('settings.delete_current_vault_desc')}</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-delete-current-vault" style="width:100%; justify-content:center; color:var(--danger); border-color:var(--danger);">
          ${icons.iTrash} ${t('settings.delete_current_vault_btn')} (${cachedVaultProfiles.find(p => p.id === cachedActiveVaultId)?.name || ''})
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
          const isOpen = query ? true : openSections.has(s.id);
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
        <p style="font-size: 11px;">${t('settings.no_search_results', { query: settingsSearchQuery })}</p>
      </div>
    `;

  return `
    <div style="display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; flex:1;">
      <!-- Settings Header Search Bar -->
      <div class="sp-search-bar" style="padding: 10px 16px 6px;">
        <div class="sp-search-input-wrap">
          <span class="sp-search-icon">${icons.iSearch}</span>
          <input type="text" id="sp-settings-search" class="sp-search-input" placeholder="${t('settings.search_placeholder')}" value="${settingsSearchQuery}" />
          ${settingsSearchQuery ? `<button class="sp-search-clear" id="sp-settings-search-clear">${icons.iX}</button>` : ''}
        </div>
      </div>

      <div class="sp-settings-container">
        ${listHtml}
      </div>
    </div>
  `;
}

// ─── PASS CLI SYNC HELPER ────────────────────────────────────────────────────

async function handleSyncPassProject(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  showToast('Синхронизация с ~/.password-store...');
  try {
    const passItems = await syncAllPassEntries(projectId);
    const otherItems = state.items.filter(i => i.projectId !== projectId);
    const updatedItems = [...otherItems, ...passItems];
    updateState({ items: updatedItems });
    await persistVaultChanges();
    showToast(`Загружено ${passItems.length} записей из pass`);
  } catch (err) {
    alert(
      'Ошибка подключения к PASS CLI:\n' +
      err.message +
      '\n\nДля подключения выполните в терминале:\ncd /Users/dima/Projects/SimplePassManager/native-host && ./install.sh'
    );
  }
}

// ─── EVENT ATTACHMENT ─────────────────────────────────────────────────────────

function attachEventHandlers() {
  // Burger & Drawer Navigation
  const burgerBtn = document.getElementById('sp-burger-btn');
  const closeDrawerBtn = document.getElementById('sp-close-drawer-btn');
  const drawerOverlay = document.getElementById('sp-drawer-overlay');

  if (burgerBtn) {
    burgerBtn.addEventListener('click', () => {
      isDrawerOpen = true;
      render();
    });
  }

  [closeDrawerBtn, drawerOverlay].forEach(el => {
    if (el) {
      el.addEventListener('click', () => {
        isDrawerOpen = false;
        render();
      });
    }
  });

  document.querySelectorAll('.sp-drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetNav = btn.dataset.nav;
      isDrawerOpen = false;
      if (targetNav === 'settings') {
        settingsSearchQuery = '';
      }
      if (state.activeTab === 'item-details' && targetNav !== 'item-details') {
        clearFormDraft();
      }
      updateState({ activeTab: targetNav, selectedItem: null, isProjectSwitcherOpen: false });
    });
  });

  // Recovery Phrase Backup Modal handlers
  const recoveryCloseBtn = document.getElementById('sp-recovery-modal-close');
  const recoveryConfirmBtn = document.getElementById('sp-btn-confirm-recovery-saved');
  [recoveryCloseBtn, recoveryConfirmBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        newlyCreatedRecoveryPhrase = null;
        render();
      });
    }
  });

  const recoveryCopyBtn = document.getElementById('sp-btn-copy-recovery-phrase');
  if (recoveryCopyBtn && newlyCreatedRecoveryPhrase) {
    recoveryCopyBtn.addEventListener('click', () => {
      copyToClipboard(newlyCreatedRecoveryPhrase);
      showToast(t('toasts.recovery_words_copied'));
    });
  }

  const recoveryDownloadBtn = document.getElementById('sp-btn-download-recovery-phrase');
  if (recoveryDownloadBtn && newlyCreatedRecoveryPhrase) {
    recoveryDownloadBtn.addEventListener('click', () => {
      const content = `SimplePass Recovery Key (12 Words)\nGenerated: ${new Date().toISOString()}\n\n${newlyCreatedRecoveryPhrase}\n\nВАЖНО: Храните этот файл в безопасном месте. Он восстановит доступ при утере мастер-пароля.`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simplepass-recovery-key-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Файл recovery-key.txt сохранён');
    });
  }

  // Top header actions
  const btnAdd = document.getElementById('sp-btn-add');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'item-details', selectedItem: null, isProjectSwitcherOpen: false });
    });
  }

  const btnEmptyAdd = document.getElementById('sp-empty-btn-add');
  if (btnEmptyAdd) {
    btnEmptyAdd.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'item-details', selectedItem: null, isProjectSwitcherOpen: false });
    });
  }

  const btnLock = document.getElementById('sp-btn-lock');
  if (btnLock) {
    btnLock.addEventListener('click', () => {
      lockVault();
    });
  }

  // Footer Project Badge click (Toggle Switcher)
  const projectContainer = document.getElementById('sp-project-container');
  if (projectContainer) {
    projectContainer.addEventListener('click', () => {
      updateState({ isProjectSwitcherOpen: !state.isProjectSwitcherOpen });
    });
  }

  const closeProjectPanelBtn = document.getElementById('sp-close-project-panel');
  if (closeProjectPanelBtn) {
    closeProjectPanelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement) document.activeElement.blur();
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      updateState({ isProjectSwitcherOpen: false });
    });
  }

  // Project item actions
  document.querySelectorAll('[data-action="select-project"]').forEach(el => {
    el.addEventListener('click', async () => {
      const pid = el.dataset.projectId;
      switchProject(pid);
      await persistVaultChanges();
    });
  });

  document.querySelectorAll('[data-action="rename-project"]').forEach(el => {
    el.addEventListener('click', async e => {
      e.stopPropagation();
      const pid = el.dataset.projectId;
      const proj = state.projects.find(p => p.id === pid);
      if (!proj) return;
      const newName = prompt('Новое имя базы данных:', proj.name);
      if (newName && newName.trim() && newName.trim() !== proj.name) {
        renameProject(pid, newName);
        await persistVaultChanges();
      }
    });
  });

  document.querySelectorAll('[data-action="delete-project"]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const pid = el.dataset.projectId;
      const proj = state.projects.find(p => p.id === pid);
      if (!proj) return;
      updateState({ projectToDelete: proj });
    });
  });

  // Create new project form
  const createProjForm = document.getElementById('sp-create-project-form');
  if (createProjForm) {
    createProjForm.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('sp-new-project-name');
      const name = input.value.trim();
      if (!name) return;
      const typeRadio = document.querySelector('input[name="sp-new-project-type"]:checked');
      const type = typeRadio ? typeRadio.value : 'browser';

      const newProj = createProject(name, type);
      await persistVaultChanges();

      if (type === 'pass_cli') {
        showToast(`База «${name}» создана (PASS CLI)`);
        handleSyncPassProject(newProj.id);
      } else {
        showToast(`База «${name}» создана`);
      }
    });
  }

  // PASS CLI sync button in switcher
  document.querySelectorAll('[data-action="sync-pass-project"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pid = btn.dataset.projectId;
      handleSyncPassProject(pid);
    });
  });

  // Cascade Delete Modal events
  const modalCancelBtn = document.getElementById('sp-modal-cancel-btn');
  const modalCloseBtn = document.getElementById('sp-modal-close-btn');
  [modalCancelBtn, modalCloseBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        updateState({ projectToDelete: null });
      });
    }
  });

  const deleteForm = document.getElementById('sp-delete-project-form');
  if (deleteForm) {
    deleteForm.addEventListener('submit', async e => {
      e.preventDefault();
      const typedName = document.getElementById('sp-delete-confirm-name').value;
      const enteredPwd = document.getElementById('sp-delete-confirm-pwd').value;
      const errBox = document.getElementById('sp-delete-modal-error');

      try {
        await deleteProjectCascade(state.projectToDelete.id, enteredPwd, typedName);
        await persistVaultChanges();
        showToast('База данных и связанные пароли удалены');
      } catch (err) {
        if (errBox) {
          errBox.innerText = err.message;
          errBox.style.display = 'block';
        } else {
          alert(err.message);
        }
      }
    });
  }

  // Vault search & category filters
  const searchInput = document.getElementById('sp-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      updateState({ searchQuery: e.target.value });
    });
  }

  const clearBtn = document.getElementById('sp-search-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      updateState({ searchQuery: '' });
    });
  }

  document.querySelectorAll('.sp-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      updateState({ activeCategory: pill.dataset.cat });
    });
  });

  const filterDomain = () => {
    const targetDomain = extractDomainName(activeTabDomain);
    if (!targetDomain) return;
    const isAlreadyFiltered = state.searchQuery.toLowerCase().trim() === targetDomain.toLowerCase();
    updateState({ searchQuery: isAlreadyFiltered ? '' : targetDomain });
  };

  const filterDomainBtn = document.getElementById('sp-filter-domain');
  if (filterDomainBtn) {
    filterDomainBtn.addEventListener('click', e => {
      e.stopPropagation();
      filterDomain();
    });
  }

  const activeDomainBanner = document.getElementById('sp-active-domain-banner');
  if (activeDomainBanner) {
    activeDomainBanner.addEventListener('click', () => {
      filterDomain();
    });
  }

  // Card clicks
  document.querySelectorAll('.sp-card').forEach(card => {
    const id = card.dataset.id;
    const item = state.items.find(i => i.id === id);

    card.querySelector('[data-action="view"]')?.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'item-details', selectedItem: item });
    });

    card.querySelector('[data-action="copy-user"]')?.addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(item.username);
      showToast(t('toasts.login_copied'));
    });

    card.querySelector('[data-action="copy-pwd"]')?.addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(item.password);
      showToast(t('toasts.password_copied'));
    });
  });

  // Delegated favicon error handling without inline onerror
  document.querySelectorAll('.sp-card-favicon').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      const fallback = img.nextElementSibling;
      if (fallback) fallback.style.display = 'inline';
    });
  });

  // Item form back & delete
  const btnBack = document.getElementById('sp-form-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      clearFormDraft();
      updateState({ activeTab: 'vault', selectedItem: null });
    });
  }

  const btnFormExportCsv = document.getElementById('sp-form-export-csv');
  if (btnFormExportCsv && state.selectedItem) {
    btnFormExportCsv.addEventListener('click', () => {
      downloadItemAsCsv(state.selectedItem);
    });
  }

  const btnDelete = document.getElementById('sp-form-delete');
  if (btnDelete && state.selectedItem) {
    btnDelete.addEventListener('click', () => {
      clearFormDraft();
      deleteItem(state.selectedItem.id);
    });
  }

  const btnToggleVis = document.getElementById('sp-toggle-pwd-vis');
  if (btnToggleVis) {
    btnToggleVis.addEventListener('click', () => {
      isPasswordVisible = !isPasswordVisible;
      const pwdInput = document.getElementById('sp-item-password');
      if (pwdInput) pwdInput.type = isPasswordVisible ? 'text' : 'password';
      btnToggleVis.innerHTML = isPasswordVisible ? icons.iEyeOff : icons.iEye;
    });
  }

  const btnGenInline = document.getElementById('sp-btn-gen-inline');
  if (btnGenInline) {
    btnGenInline.addEventListener('click', () => {
      const newPwd = generatePassword({ length: 22 });
      const pwdInput = document.getElementById('sp-item-password');
      if (pwdInput) {
        pwdInput.value = newPwd;
        pwdInput.type = 'text';
        isPasswordVisible = true;
        pwdInput.classList.remove('has-error');
        const pwdErr = document.getElementById('sp-item-password-error');
        if (pwdErr) pwdErr.style.display = 'none';
      }
      saveFormDraftFromDOM();
    });
  }

  // URL Input & Favicon Auto-resolution handlers
  const urlInput = document.getElementById('sp-item-url');
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const url = urlInput.value.trim();
      const domain = extractCleanDomain(url);
      const displayDomain = extractDomainName(url);
      const domainBadge = document.getElementById('sp-form-domain-badge');
      if (domainBadge) {
        if (displayDomain) {
          domainBadge.textContent = displayDomain;
          domainBadge.style.display = 'inline';
        } else {
          domainBadge.style.display = 'none';
        }
      }
      if (state.showFavicons && domain && cachedFavicons[domain]) {
        const preview = document.getElementById('sp-form-favicon-preview');
        if (preview) {
          preview.src = cachedFavicons[domain];
          preview.style.display = 'inline-block';
        }
        if (formDraft) {
          formDraft.domain = displayDomain;
          formDraft.favicon = cachedFavicons[domain];
        }
      }
    });

    urlInput.addEventListener('blur', async () => {
      if (!state.showFavicons) return;
      const url = urlInput.value.trim();
      const domain = extractCleanDomain(url);
      if (!domain) return;
      const hostNoPort = domain.split(':')[0];

      let fav =
        cachedFavicons[domain] ||
        cachedFavicons[hostNoPort] ||
        (await getCachedFavicon(domain)) ||
        (await getCachedFavicon(hostNoPort));

      if (!fav) {
        let currentTabFavicon = activeTabFavicon;
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          try {
            const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
            if (tabs && tabs[0] && tabs[0].favIconUrl) {
              const tabHost = extractCleanDomain(tabs[0].url);
              if (tabHost === domain || tabHost.split(':')[0] === hostNoPort) {
                currentTabFavicon = tabs[0].favIconUrl;
              }
            }
          } catch (_) {}
        }
        const res = await resolveFavicon(url, { forceRefresh: false, activeTabFavIconUrl: currentTabFavicon });
        if (res && res.favicon) {
          fav = res.favicon;
          cachedFavicons[domain] = fav;
          if (hostNoPort) cachedFavicons[hostNoPort] = fav;
        }
      }
      if (fav) {
        if (formDraft) {
          formDraft.domain = domain;
          formDraft.favicon = fav;
        }
        const preview = document.getElementById('sp-form-favicon-preview');
        if (preview) {
          preview.src = fav;
          preview.style.display = 'inline-block';
        }
      }
    });
  }

  // Refresh favicon icon button
  const refreshFaviconBtn = document.getElementById('sp-btn-refresh-favicon');
  if (refreshFaviconBtn) {
    refreshFaviconBtn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const currentUrlInput = document.getElementById('sp-item-url');
      const url = currentUrlInput ? currentUrlInput.value.trim() : '';
      const domain = extractCleanDomain(url);
      if (!domain) {
        showToast(t('toasts.favicon_empty_url'));
        return;
      }

      refreshFaviconBtn.classList.add('sp-spin');
      refreshFaviconBtn.disabled = true;

      try {
        let currentTabFavicon = activeTabFavicon;
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
          try {
            const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
            if (tabs && tabs[0]) {
              if (tabs[0].favIconUrl) currentTabFavicon = tabs[0].favIconUrl;
              const tabHost = extractCleanDomain(tabs[0].url);
              if (tabHost === domain || tabHost.split(':')[0] === domain.split(':')[0]) {
                try {
                  const contentResp = await new Promise(res => {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_FAVICON' }, res);
                  });
                  if (contentResp && contentResp.faviconUrl) {
                    currentTabFavicon = contentResp.faviconUrl;
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        const res = await resolveFavicon(url, { forceRefresh: true, activeTabFavIconUrl: currentTabFavicon });
        if (res && res.favicon) {
          const hostNoPort = domain.split(':')[0];
          cachedFavicons[domain] = res.favicon;
          if (res.domain) cachedFavicons[res.domain] = res.favicon;
          if (hostNoPort) cachedFavicons[hostNoPort] = res.favicon;

          const displayDomain = hostNoPort || domain;
          if (formDraft) {
            formDraft.domain = displayDomain;
            formDraft.favicon = res.favicon;
          }

          const domainBadge = document.getElementById('sp-form-domain-badge');
          if (domainBadge) {
            domainBadge.textContent = displayDomain;
            domainBadge.style.display = 'inline';
          }
          const preview = document.getElementById('sp-form-favicon-preview');
          if (preview) {
            preview.src = res.favicon;
            preview.style.display = 'inline-block';
          }

          const itemId = document.getElementById('sp-item-id')?.value;
          if (itemId) {
            const itemIdx = state.items.findIndex(i => i.id === itemId);
            if (itemIdx >= 0) {
              state.items[itemIdx].domain = displayDomain;
              state.items[itemIdx].favicon = res.favicon;
              await persistVaultChanges();
            }
          }

          showToast(t('toasts.favicon_updated'));
        } else {
          showToast(t('toasts.favicon_fetch_failed'));
        }
      } catch (_) {
        showToast(t('toasts.favicon_fetch_failed'));
      } finally {
        refreshFaviconBtn.classList.remove('sp-spin');
        refreshFaviconBtn.disabled = false;
      }
    });
  }

  // Project custom dropdown in Item Form
  const projectSelectWrap = document.getElementById('sp-project-select-wrap');
  const projectSelectTrigger = document.getElementById('sp-project-select-trigger');
  const projectDropdown = document.getElementById('sp-project-dropdown');
  const projectHiddenInput = document.getElementById('sp-item-project');
  const projectSelectLabel = document.getElementById('sp-project-select-label');

  if (projectSelectWrap && projectSelectTrigger && projectDropdown) {
    const toggleProjectDropdown = (e) => {
      e?.stopPropagation();
      const isOpen = projectDropdown.style.display === 'flex' || projectSelectWrap.classList.contains('open');
      if (isOpen) {
        projectDropdown.style.display = 'none';
        projectSelectWrap.classList.remove('open');
      } else {
        projectDropdown.style.display = 'flex';
        projectSelectWrap.classList.add('open');
        // close tag dropdown if open
        const tagDrop = document.getElementById('sp-tags-dropdown');
        if (tagDrop) {
          tagDrop.style.display = 'none';
          document.querySelector('.sp-tag-input-container')?.classList.remove('open');
        }
      }
    };

    projectSelectTrigger.addEventListener('click', toggleProjectDropdown);
    projectSelectTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleProjectDropdown();
      } else if (e.key === 'Escape') {
        projectDropdown.style.display = 'none';
        projectSelectWrap.classList.remove('open');
      }
    });

    projectDropdown.querySelectorAll('[data-action="select-form-project"]').forEach(optEl => {
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const pId = optEl.dataset.projectId;
        const pName = optEl.dataset.projectName;
        if (projectHiddenInput) projectHiddenInput.value = pId;
        if (projectSelectLabel) projectSelectLabel.textContent = pName;

        projectDropdown.querySelectorAll('[data-action="select-form-project"]').forEach(el => {
          const isCurrent = el.dataset.projectId === pId;
          el.classList.toggle('selected', isCurrent);
          const hasCheck = el.querySelector('.sp-opt-check');
          if (isCurrent && !hasCheck) {
            el.insertAdjacentHTML('beforeend', `<span class="sp-opt-check" style="color:var(--text-main); font-size:12px; display:flex; align-items:center;">${icons.iCheck}</span>`);
          } else if (!isCurrent && hasCheck) {
            hasCheck.remove();
          }
        });

        projectDropdown.style.display = 'none';
        projectSelectWrap.classList.remove('open');
        saveFormDraftFromDOM();
      });
    });
  }

  // Multi-Tag handlers in Item Form
  document.querySelectorAll('[data-action="remove-form-tag"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      saveFormDraftFromDOM();
      const tagToRemove = btn.dataset.tag;
      formSelectedTags = formSelectedTags.filter(t => t !== tagToRemove);
      if (formDraft) {
        formDraft.tags = [...formSelectedTags];
      }
      render();
    });
  });

  const tagSearchInput = document.getElementById('sp-tag-search-input');
  const tagDropdownToggle = document.getElementById('sp-tag-dropdown-toggle');
  const tagDropdown = document.getElementById('sp-tags-dropdown');
  const tagInputErr = document.getElementById('sp-tag-input-err');

  async function createAndSelectTag(newTagRaw) {
    const newTag = (newTagRaw || '').trim();
    if (!newTag) return;
    const validRes = validateTagName(newTag);
    if (!validRes.valid) {
      if (tagInputErr) {
        tagInputErr.innerText = validRes.error;
        tagInputErr.style.display = 'block';
      }
      return;
    }

    if (!state.categories.includes(newTag)) {
      state.categories.push(newTag);
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[newTag] = 'slate';
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
    }
    if (!formSelectedTags.includes(newTag)) {
      formSelectedTags.push(newTag);
    }
    if (formDraft) {
      formDraft.tags = [...formSelectedTags];
    }
    if (tagSearchInput) tagSearchInput.value = '';
    tagDropdown.style.display = 'none';
    const tagWrap = document.querySelector('.sp-tag-input-container');
    if (tagWrap) tagWrap.classList.remove('open');
    if (tagInputErr) tagInputErr.style.display = 'none';
    render();
  }

  function updateTagDropdown(filterText = '') {
    if (!tagDropdown) return;
    const query = filterText.trim().toLowerCase();
    const allTags = state.categories.filter(c => c !== 'All');
    const matchedTags = allTags.filter(t => !query || t.toLowerCase().includes(query));

    let html = '';

    // First item: Explicit action to create new tag
    const trimmed = filterText.trim();
    const exactExists = allTags.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (trimmed && !exactExists) {
      html += `
        <div class="sp-tag-drop-create sp-tag-drop-create-top" data-action="create-dropdown-tag" data-tag="${escapeHtml(trimmed)}">
          <span class="sp-tag-create-icon">${icons.iPlus}</span>
          <span class="sp-tag-create-text">${t('form.tags_create_option', { name: escapeHtml(trimmed) })}</span>
        </div>
      `;
    } else if (!trimmed) {
      html += `
        <div class="sp-tag-drop-create sp-tag-drop-create-top" data-action="prompt-create-tag">
          <span class="sp-tag-create-icon">${icons.iPlus}</span>
          <span class="sp-tag-create-text">${t('form.tags_create_new_action')}</span>
        </div>
      `;
    }

    if (matchedTags.length > 0) {
      html += matchedTags.map(tName => {
        const isSelected = formSelectedTags.includes(tName);
        const colorDef = getCategoryColorDef(tName, state.categoryColors);
        const cssVars = getCategoryCssVars(colorDef);
        const label = tName === 'Work' ? t('categories.Work') : (tName === 'Personal' ? t('categories.Personal') : tName);
        return `
          <div class="sp-tag-drop-item ${isSelected ? 'selected' : ''}" data-action="select-dropdown-tag" data-tag="${escapeHtml(tName)}">
            <span class="sp-pill sp-pill-tag-card" data-color-pill="true" style="${cssVars}; pointer-events:none;">
              <span class="sp-pill-dot" style="background-color:${colorDef.color};"></span>
              <span>${escapeHtml(label)}</span>
            </span>
            ${isSelected ? `<span style="color:var(--text-main); font-size:12px;">${icons.iCheck}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    if (!html) {
      html = `<div style="padding:8px 10px; font-size:11px; color:var(--text-dim);">${t('form.tags_no_tags')}</div>`;
    }

    tagDropdown.innerHTML = html;
    tagDropdown.style.display = 'block';
    const tagWrap = document.querySelector('.sp-tag-input-container');
    if (tagWrap) tagWrap.classList.add('open');
    if (projectDropdown) {
      projectDropdown.style.display = 'none';
      projectSelectWrap?.classList.remove('open');
    }

    tagDropdown.querySelectorAll('[data-action="select-dropdown-tag"]').forEach(itemEl => {
      itemEl.addEventListener('click', e => {
        e.stopPropagation();
        saveFormDraftFromDOM();
        const selTag = itemEl.dataset.tag;
        if (!formSelectedTags.includes(selTag)) {
          formSelectedTags.push(selTag);
        } else {
          formSelectedTags = formSelectedTags.filter(t => t !== selTag);
        }
        if (formDraft) {
          formDraft.tags = [...formSelectedTags];
        }
        tagDropdown.style.display = 'none';
        tagWrap?.classList.remove('open');
        if (tagInputErr) tagInputErr.style.display = 'none';
        render();
      });
    });

    tagDropdown.querySelectorAll('[data-action="prompt-create-tag"]').forEach(promptEl => {
      promptEl.addEventListener('click', async e => {
        e.stopPropagation();
        const inputName = window.prompt(t('form.tags_prompt_new'));
        if (inputName && inputName.trim()) {
          saveFormDraftFromDOM();
          await createAndSelectTag(inputName.trim());
        } else {
          tagSearchInput?.focus();
        }
      });
    });

    tagDropdown.querySelectorAll('[data-action="create-dropdown-tag"]').forEach(createEl => {
      createEl.addEventListener('click', async e => {
        e.stopPropagation();
        saveFormDraftFromDOM();
        await createAndSelectTag(createEl.dataset.tag);
      });
    });
  }

  if (tagSearchInput) {
    tagSearchInput.addEventListener('input', e => {
      if (tagInputErr) tagInputErr.style.display = 'none';
      updateTagDropdown(e.target.value);
    });

    tagSearchInput.addEventListener('focus', () => {
      updateTagDropdown(tagSearchInput.value);
    });

    tagSearchInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = tagSearchInput.value.trim();
        if (!val) return;
        saveFormDraftFromDOM();
        const allTags = state.categories.filter(c => c !== 'All');
        const matched = allTags.find(t => t.toLowerCase() === val.toLowerCase());
        if (matched) {
          if (!formSelectedTags.includes(matched)) {
            formSelectedTags.push(matched);
          }
          if (formDraft) {
            formDraft.tags = [...formSelectedTags];
          }
          tagSearchInput.value = '';
          tagDropdown.style.display = 'none';
          document.querySelector('.sp-tag-input-container')?.classList.remove('open');
          render();
        } else {
          await createAndSelectTag(val);
        }
      } else if (e.key === 'Escape') {
        if (tagDropdown) tagDropdown.style.display = 'none';
        document.querySelector('.sp-tag-input-container')?.classList.remove('open');
      }
    });
  }

  if (tagDropdownToggle && tagDropdown) {
    tagDropdownToggle.addEventListener('click', e => {
      e.stopPropagation();
      const tagWrap = document.querySelector('.sp-tag-input-container');
      if (tagDropdown.style.display === 'block') {
        tagDropdown.style.display = 'none';
        tagWrap?.classList.remove('open');
      } else {
        updateTagDropdown(tagSearchInput ? tagSearchInput.value : '');
      }
    });
  }

  // Close custom dropdowns on outside click
  document.addEventListener('click', e => {
    if (projectDropdown && (projectDropdown.style.display === 'flex' || projectSelectWrap?.classList.contains('open'))) {
      if (!e.target.closest('#sp-project-select-wrap')) {
        projectDropdown.style.display = 'none';
        projectSelectWrap?.classList.remove('open');
      }
    }
    if (tagDropdown && tagDropdown.style.display === 'block') {
      if (!e.target.closest('.sp-tag-input-container')) {
        tagDropdown.style.display = 'none';
        document.querySelector('.sp-tag-input-container')?.classList.remove('open');
      }
    }
    const langDrop = document.getElementById('sp-setting-lang-dropdown');
    if (langDrop && (langDrop.classList.contains('open') || isLangSelectOpen)) {
      if (!e.target.closest('#sp-setting-lang-dropdown')) {
        isLangSelectOpen = false;
        langDrop.classList.remove('open');
      }
    }
    const lockDrop = document.getElementById('sp-setting-lock-interval-dropdown');
    if (lockDrop && (lockDrop.classList.contains('open') || isCustomSelectOpen)) {
      if (!e.target.closest('#sp-setting-lock-interval-dropdown')) {
        isCustomSelectOpen = false;
        lockDrop.classList.remove('open');
      }
    }
    const exportDrop = document.getElementById('sp-export-format-dropdown');
    if (exportDrop && (exportDrop.classList.contains('open') || isExportFormatSelectOpen)) {
      if (!e.target.closest('#sp-export-format-dropdown')) {
        isExportFormatSelectOpen = false;
        exportDrop.classList.remove('open');
      }
    }
  });

  // CSV Import in Item Form
  const csvFileInput = document.getElementById('sp-csv-file-input');
  if (csvFileInput) {
    csvFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const activeProj = getActiveProject();
        const imported = parseCsvFile(text);
        imported.forEach(it => {
          it.projectId = activeProj ? activeProj.id : 'proj_default';
        });
        state.items = [...state.items, ...imported];
        await persistVaultChanges();
        notifyStateChange();
        showToast(`Импортировано ${imported.length} паролей в «${activeProj ? activeProj.name : 'базу'}»`);
        clearFormDraft();
        updateState({ activeTab: 'vault', selectedItem: null });
      } catch (err) {
        alert('Ошибка импорта CSV: ' + err.message);
      }
    });
  }

  function validateItemForm() {
    const titleInput = document.getElementById('sp-item-title');
    const pwdInput = document.getElementById('sp-item-password');
    const titleErr = document.getElementById('sp-item-title-error');
    const pwdErr = document.getElementById('sp-item-password-error');

    let isValid = true;
    let firstInvalidEl = null;

    const titleVal = titleInput ? titleInput.value.trim() : '';
    if (!titleVal) {
      isValid = false;
      if (titleInput) {
        titleInput.classList.add('has-error', 'sp-shake');
        setTimeout(() => titleInput.classList.remove('sp-shake'), 450);
        if (!firstInvalidEl) firstInvalidEl = titleInput;
      }
      if (titleErr) {
        titleErr.innerText = t('form.title_required');
        titleErr.style.display = 'block';
      }
    } else {
      if (titleInput) titleInput.classList.remove('has-error');
      if (titleErr) titleErr.style.display = 'none';
    }

    const pwdVal = pwdInput ? pwdInput.value : '';
    if (!pwdVal) {
      isValid = false;
      if (pwdInput) {
        pwdInput.classList.add('has-error', 'sp-shake');
        setTimeout(() => pwdInput.classList.remove('sp-shake'), 450);
        if (!firstInvalidEl) firstInvalidEl = pwdInput;
      }
      if (pwdErr) {
        pwdErr.innerText = t('form.password_required');
        pwdErr.style.display = 'block';
      }
    } else {
      if (pwdInput) pwdInput.classList.remove('has-error');
      if (pwdErr) pwdErr.style.display = 'none';
    }

    if (!isValid) {
      if (firstInvalidEl) {
        firstInvalidEl.focus();
      }
      showToast(t('toasts.fill_required_fields'));
      return false;
    }

    return true;
  }

  const titleInput = document.getElementById('sp-item-title');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      if (titleInput.value.trim()) {
        titleInput.classList.remove('has-error');
        const titleErr = document.getElementById('sp-item-title-error');
        if (titleErr) titleErr.style.display = 'none';
      }
    });
  }

  const pwdInput = document.getElementById('sp-item-password');
  if (pwdInput) {
    pwdInput.addEventListener('input', () => {
      if (pwdInput.value) {
        pwdInput.classList.remove('has-error');
        const pwdErr = document.getElementById('sp-item-password-error');
        if (pwdErr) pwdErr.style.display = 'none';
      }
    });
  }

  const itemForm = document.getElementById('sp-item-form');
  if (itemForm) {
    itemForm.addEventListener('input', () => {
      saveFormDraftFromDOM();
    });

    itemForm.addEventListener('submit', e => {
      e.preventDefault();
      if (!validateItemForm()) {
        return;
      }
      const tags = [...formSelectedTags];
      const url = document.getElementById('sp-item-url').value.trim();
      const domain = extractCleanDomain(url);
      saveItem({
        id: document.getElementById('sp-item-id').value,
        projectId: document.getElementById('sp-item-project').value,
        title: document.getElementById('sp-item-title').value.trim(),
        url,
        domain,
        favicon: formDraft?.favicon || (domain && cachedFavicons[domain]) || '',
        username: document.getElementById('sp-item-username').value.trim(),
        password: document.getElementById('sp-item-password').value,
        category: tags[0] || '',
        tags,
        notes: document.getElementById('sp-item-notes').value.trim()
      });
      clearFormDraft();
    });
  }

  // ─── Generator Tab controls (Smooth 60fps Interactive Live-Update) ───
  function updateGeneratorLiveUI() {
    currentGeneratedPassword = generatePassword(genOptions);
    const disp = document.getElementById('sp-gen-display');
    if (disp) disp.innerText = currentGeneratedPassword;
    const lenVal = document.getElementById('sp-length-val');
    if (lenVal) lenVal.innerText = genOptions.length;
  }

  const sliderLen = document.getElementById('sp-slider-len');
  if (sliderLen) {
    sliderLen.addEventListener('input', e => {
      genOptions.length = parseInt(e.target.value, 10);
      updateGeneratorLiveUI();
    });
  }

  ['upper', 'lower', 'digits', 'symbols', 'ambig'].forEach(type => {
    const chk = document.getElementById(`sp-chk-${type}`);
    if (chk) {
      chk.addEventListener('change', e => {
        if (type === 'upper') genOptions.useUpper = e.target.checked;
        if (type === 'lower') genOptions.useLower = e.target.checked;
        if (type === 'digits') genOptions.useDigits = e.target.checked;
        if (type === 'symbols') genOptions.useSymbols = e.target.checked;
        if (type === 'ambig') genOptions.avoidAmbiguous = e.target.checked;
        updateGeneratorLiveUI();
      });
    }
  });

  const btnGenRefresh = document.getElementById('sp-gen-refresh');
  if (btnGenRefresh) {
    btnGenRefresh.addEventListener('click', () => {
      updateGeneratorLiveUI();
    });
  }

  const btnGenCopy = document.getElementById('sp-gen-copy');
  if (btnGenCopy) {
    btnGenCopy.addEventListener('click', () => {
      copyToClipboard(currentGeneratedPassword);
      showToast(t('toasts.password_copied'));
    });
  }

  // ─── Settings tab handlers ───
  const settingsSearchInput = document.getElementById('sp-settings-search');
  if (settingsSearchInput) {
    settingsSearchInput.addEventListener('input', e => {
      settingsSearchQuery = e.target.value;
      render();
    });
  }

  const settingsSearchClear = document.getElementById('sp-settings-search-clear');
  if (settingsSearchClear) {
    settingsSearchClear.addEventListener('click', () => {
      settingsSearchQuery = '';
      render();
    });
  }

  // Custom Select Dropdown for Language in Settings
  const customLangSelect = document.getElementById('sp-setting-lang-dropdown');
  const customLangTrigger = document.getElementById('sp-custom-lang-trigger');
  if (customLangSelect && customLangTrigger) {
    customLangTrigger.addEventListener('click', e => {
      e.stopPropagation();
      isLangSelectOpen = !isLangSelectOpen;
      customLangSelect.classList.toggle('open', isLangSelectOpen);
      const lockDrop = document.getElementById('sp-setting-lock-interval-dropdown');
      if (lockDrop && isCustomSelectOpen) {
        isCustomSelectOpen = false;
        lockDrop.classList.remove('open');
      }
      const exportDrop = document.getElementById('sp-export-format-dropdown');
      if (exportDrop && isExportFormatSelectOpen) {
        isExportFormatSelectOpen = false;
        exportDrop.classList.remove('open');
      }
    });

    customLangSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const lang = opt.dataset.val;
        isLangSelectOpen = false;
        if (lang && SUPPORTED_LANGUAGES.includes(lang)) {
          setLanguage(lang);
          updateState({ language: lang });
          const cfg = await getStoredConfig();
          await saveStoredConfig({ ...cfg, language: lang });
          showToast(t('toasts.language_changed'));
          render();
        }
      });
    });
  }

  // Theme Toggle Handler in Settings
  const themeToggle = document.getElementById('sp-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('change', async e => {
      const newTheme = e.target.checked ? 'dark' : 'light';
      applyTheme(newTheme);
      updateState({ theme: newTheme });
      const cfg = await getStoredConfig();
      await saveStoredConfig({ ...cfg, theme: newTheme });
      showToast(newTheme === 'dark' ? 'Включена тёмная тема' : 'Включена светлая тема');
    });
  }

  // Show Favicons Toggle Handler in Settings
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

  // Show Card Tags Toggle Handler in Settings
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

  // Settings section toggle handler
  document.querySelectorAll('[data-action="toggle-section"]').forEach(header => {
    header.addEventListener('click', () => {
      const sectionId = header.dataset.sectionId;
      if (openSections.has(sectionId)) {
        openSections.delete(sectionId);
      } else {
        openSections.add(sectionId);
      }
      render();
    });
  });

  // Custom Select Dropdown for Lock Interval
  const customLockSelect = document.getElementById('sp-setting-lock-interval-dropdown');
  const customLockTrigger = document.getElementById('sp-custom-lock-trigger');
  if (customLockSelect && customLockTrigger) {
    customLockTrigger.addEventListener('click', e => {
      e.stopPropagation();
      isCustomSelectOpen = !isCustomSelectOpen;
      customLockSelect.classList.toggle('open', isCustomSelectOpen);
      const langDrop = document.getElementById('sp-setting-lang-dropdown');
      if (langDrop && isLangSelectOpen) {
        isLangSelectOpen = false;
        langDrop.classList.remove('open');
      }
      const exportDrop = document.getElementById('sp-export-format-dropdown');
      if (exportDrop && isExportFormatSelectOpen) {
        isExportFormatSelectOpen = false;
        exportDrop.classList.remove('open');
      }
    });

    customLockSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const val = opt.dataset.val;
        state.lockInterval = val;
        isCustomSelectOpen = false;
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, lockInterval: val });
        if (state.rawMek) {
          const session = await createSession(state.rawMek, val);
          updateState({ sessionExpiresAt: session.expiresAt });
        } else if (state.isUnlocked) {
          showToast(t('errors.session_invalid') || 'Ошибка сессии. Пожалуйста, выполните вход заново.');
        }
        if (val === '1day') {
          showToast(`⚠️ ${t('settings.interval_1day_warning') || 'Ключ хранилища будет сохранён на устройстве до истечения интервала'}`);
        } else {
          showToast(t('toasts.interval_updated') || 'Периодичность проверки обновлена');
        }
        render();
      });
    });
  }

  // Custom Select Dropdown for Inactivity Autolock
  const customAutolockSelect = document.getElementById('sp-setting-autolock-dropdown');
  const customAutolockTrigger = document.getElementById('sp-custom-autolock-trigger');
  if (customAutolockSelect && customAutolockTrigger) {
    customAutolockTrigger.addEventListener('click', e => {
      e.stopPropagation();
      isAutolockSelectOpen = !isAutolockSelectOpen;
      customAutolockSelect.classList.toggle('open', isAutolockSelectOpen);
      const lockDrop = document.getElementById('sp-setting-lock-interval-dropdown');
      if (lockDrop && isCustomSelectOpen) {
        isCustomSelectOpen = false;
        lockDrop.classList.remove('open');
      }
      const langDrop = document.getElementById('sp-setting-lang-dropdown');
      if (langDrop && isLangSelectOpen) {
        isLangSelectOpen = false;
        langDrop.classList.remove('open');
      }
      const exportDrop = document.getElementById('sp-export-format-dropdown');
      if (exportDrop && isExportFormatSelectOpen) {
        isExportFormatSelectOpen = false;
        exportDrop.classList.remove('open');
      }
    });

    customAutolockSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const val = Number(opt.dataset.val);
        state.autolockMinutes = val;
        isAutolockSelectOpen = false;
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, autolockMinutes: val });
        if (state.isUnlocked) {
          startAutolock({
            idleMinutes: val,
            onLock: () => lockVault()
          });
        }
        showToast(t('toasts.interval_updated') || 'Периодичность проверки обновлена');
        render();
      });
    });
  }

  // Custom Select Dropdown for Export Format in Settings
  const customExportSelect = document.getElementById('sp-export-format-dropdown');
  const customExportTrigger = document.getElementById('sp-export-format-trigger');
  if (customExportSelect && customExportTrigger) {
    customExportTrigger.addEventListener('click', e => {
      e.stopPropagation();
      isExportFormatSelectOpen = !isExportFormatSelectOpen;
      customExportSelect.classList.toggle('open', isExportFormatSelectOpen);
      const langDrop = document.getElementById('sp-setting-lang-dropdown');
      if (langDrop && isLangSelectOpen) {
        isLangSelectOpen = false;
        langDrop.classList.remove('open');
      }
      const lockDrop = document.getElementById('sp-setting-lock-interval-dropdown');
      if (lockDrop && isCustomSelectOpen) {
        isCustomSelectOpen = false;
        lockDrop.classList.remove('open');
      }
    });

    customExportSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        selectedExportFormat = opt.dataset.val || 'json';
        isExportFormatSelectOpen = false;
        render();
      });
    });
  }

  // Tag Management Handlers in Settings
  // Inline Rename Handlers
  document.querySelectorAll('[data-action="start-tag-rename"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      editingTagId = btn.dataset.cat;
      render();
      setTimeout(() => {
        const inp = document.getElementById('sp-rename-tag-input');
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    });
  });

  const btnCancelTagRename = document.getElementById('sp-btn-cancel-tag-rename');
  if (btnCancelTagRename) {
    btnCancelTagRename.addEventListener('click', e => {
      e.stopPropagation();
      editingTagId = null;
      render();
    });
  }

  async function handleSaveTagRename(oldName) {
    const inp = document.getElementById('sp-rename-tag-input');
    const errBox = document.getElementById('sp-rename-tag-err');
    if (!inp) return;
    const newName = inp.value.trim();

    if (!newName) {
      if (errBox) {
        errBox.innerText = 'Название не может быть пустым';
        errBox.style.display = 'block';
      }
      return;
    }

    if (newName === oldName) {
      editingTagId = null;
      render();
      return;
    }

    const validRes = validateTagName(newName);
    if (!validRes.valid) {
      if (errBox) {
        errBox.innerText = validRes.error;
        errBox.style.display = 'block';
      }
      return;
    }

    const exists = state.categories.some(c => c.toLowerCase() === newName.toLowerCase() && c.toLowerCase() !== oldName.toLowerCase());
    if (exists) {
      if (errBox) {
        errBox.innerText = 'Метка с таким именем уже существует';
        errBox.style.display = 'block';
      }
      return;
    }

    // Rename in state.categories
    state.categories = state.categories.map(c => (c === oldName ? newName : c));

    // Transfer color
    if (state.categoryColors && state.categoryColors[oldName]) {
      const colorVal = state.categoryColors[oldName];
      delete state.categoryColors[oldName];
      state.categoryColors[newName] = colorVal;
    }

    // Update in all items
    state.items = state.items.map(it => {
      const itemTags = getItemTags(it);
      const updatedTags = [...new Set(itemTags.map(t => (t === oldName ? newName : t)))];
      const updatedCat = it.category === oldName ? newName : it.category;
      return {
        ...it,
        category: updatedCat,
        tags: updatedTags
      };
    });

    if (state.activeCategory === oldName) {
      state.activeCategory = newName;
    }

    await persistVaultChanges();
    const cfg = await getStoredConfig();
    await saveStoredConfig({
      ...cfg,
      categories: state.categories.filter(c => c !== 'All'),
      categoryColors: state.categoryColors
    });

    editingTagId = null;
    showToast(t('settings.cat_renamed') || 'Метка переименована');
    render();
  }

  const btnSaveTagRename = document.getElementById('sp-btn-save-tag-rename');
  if (btnSaveTagRename) {
    btnSaveTagRename.addEventListener('click', async e => {
      e.stopPropagation();
      const oldName = btnSaveTagRename.dataset.oldName || editingTagId;
      await handleSaveTagRename(oldName);
    });
  }

  const renameTagInput = document.getElementById('sp-rename-tag-input');
  if (renameTagInput) {
    renameTagInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const oldName = editingTagId;
        await handleSaveTagRename(oldName);
      } else if (e.key === 'Escape') {
        editingTagId = null;
        render();
      }
    });
  }

  const btnAddCat = document.getElementById('sp-btn-add-cat');
  const newCatInput = document.getElementById('sp-new-cat-name');
  const catErr = document.getElementById('sp-cat-err');
  if (btnAddCat && newCatInput) {
    const handleAddTag = async () => {
      const name = newCatInput.value.trim();
      if (!name) return;
      const validRes = validateTagName(name);
      if (!validRes.valid) {
        if (catErr) {
          catErr.innerText = validRes.error;
          catErr.style.display = 'block';
        }
        return;
      }
      if (state.categories.some(c => c.toLowerCase() === name.toLowerCase())) {
        if (catErr) {
          catErr.innerText = 'Метка с таким именем уже существует';
          catErr.style.display = 'block';
        }
        return;
      }
      state.categories.push(name);
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[name] = selectedNewCatColor;
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
      showToast(`Метка «${name}» добавлена`);
      render();
    };

    btnAddCat.addEventListener('click', handleAddTag);
    newCatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    });
  }

  // Color selection for new category
  document.querySelectorAll('[data-action="select-new-cat-color"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedNewCatColor = btn.dataset.colorId;
      render();
    });
  });

  // Toggle category color picker tray
  document.querySelectorAll('[data-action="toggle-cat-color-picker"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      activeColorPickerCat = activeColorPickerCat === cat ? null : cat;
      render();
    });
  });

  // Set color for existing category
  document.querySelectorAll('[data-action="set-cat-color"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const colorId = btn.dataset.colorId;
      if (!state.categoryColors) state.categoryColors = {};
      state.categoryColors[cat] = colorId;
      activeColorPickerCat = null;
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categoryColors: state.categoryColors
      });
      showToast(t('settings.cat_color_updated'));
      render();
    });
  });

  document.querySelectorAll('.sp-cat-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const catToDelete = btn.dataset.cat;
      if (catToDelete === 'Work' || catToDelete === 'Personal') return;
      state.categories = state.categories.filter(c => c !== catToDelete);
      if (state.categoryColors) {
        delete state.categoryColors[catToDelete];
      }
      state.items = state.items.map(it => {
        const itemTags = getItemTags(it);
        const filtered = itemTags.filter(t => t !== catToDelete);
        const finalTags = filtered.length > 0 ? filtered : ['Work'];
        return {
          ...it,
          tags: finalTags,
          category: it.category === catToDelete ? finalTags[0] : it.category
        };
      });
      if (state.activeCategory === catToDelete) {
        state.activeCategory = 'All';
      }
      await persistVaultChanges();
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All'),
        categoryColors: state.categoryColors
      });
      showToast(`Метка «${catToDelete}» удалена`);
      render();
    });
  });

  const btnToggleChangePwd = document.getElementById('sp-btn-toggle-change-pwd');
  if (btnToggleChangePwd) {
    btnToggleChangePwd.addEventListener('click', () => {
      isChangePwdOpen = !isChangePwdOpen;
      render();
      if (isChangePwdOpen) {
        setTimeout(() => {
          const form = document.getElementById('sp-change-pwd-form');
          if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 30);
      }
    });
  }

  const changePwdForm = document.getElementById('sp-change-pwd-form');
  if (changePwdForm) {
    changePwdForm.addEventListener('submit', async e => {
      e.preventDefault();
      const oldPwd = document.getElementById('sp-pwd-old').value;
      const newPwd = document.getElementById('sp-pwd-new').value;
      const newPwd2 = document.getElementById('sp-pwd-new2').value;
      const errBox = document.getElementById('sp-change-pwd-err');

      // Verify old password cryptographically via MEK unwrap
      const envelope = await getStoredVault();
      let currentMek = state.rawMek;
      try {
        currentMek = await unwrapMekWithPassword(envelope, oldPwd);
      } catch (_) {
        if (errBox) {
          errBox.innerText = t('errors.invalid_master_pwd') || 'Неверный текущий мастер-пароль';
          errBox.style.display = 'block';
        }
        return;
      }

      const pwdVal = validateMasterPassword(newPwd);
      if (!pwdVal.valid) {
        if (errBox) {
          errBox.innerText = pwdVal.error;
          errBox.style.display = 'block';
        }
        return;
      }
      if (newPwd !== newPwd2) {
        if (errBox) {
          errBox.innerText = t('errors.pwd_mismatch') || 'Введенные новые пароли не совпадают';
          errBox.style.display = 'block';
        }
        return;
      }

      try {
        // Re-wrap only the keyByPassword slot with AAD!
        const newKeyByPassword = await wrapMek(currentMek, newPwd, 'mek-pwd');
        state.rawMek = currentMek;
        if (!state.keySlots) {
          state.keySlots = {
            keyByPassword: envelope.keyByPassword,
            keyByRecovery: envelope.keyByRecovery ? { ...envelope.keyByRecovery, aad: envelope.keyByRecovery.aad ?? false } : null
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
        isChangePwdOpen = false;
        updateState({
          rawMek: currentMek,
          keySlots: state.keySlots,
          sessionExpiresAt: session.expiresAt
        });
        showToast(t('toasts.pwd_changed_success') || 'Мастер-пароль успешно изменён');
      } catch (err) {
        if (errBox) {
          errBox.innerText = 'Ошибка: ' + err.message;
          errBox.style.display = 'block';
        }
      }
    });
  }

  const btnLockNow = document.getElementById('sp-btn-lock-now');
  if (btnLockNow) {
    btnLockNow.addEventListener('click', () => {
      lockVault();
    });
  }

  const btnOpenSwitcher = document.getElementById('sp-btn-open-switcher');
  if (btnOpenSwitcher) {
    btnOpenSwitcher.addEventListener('click', () => {
      updateState({ isProjectSwitcherOpen: true });
    });
  }

  const btnExportAdvancedToggle = document.getElementById('sp-export-advanced-toggle');
  if (btnExportAdvancedToggle) {
    btnExportAdvancedToggle.addEventListener('click', e => {
      e.preventDefault();
      isExportAdvancedOpen = !isExportAdvancedOpen;
      render();
    });
  }

  const btnExportSelectAllTags = document.getElementById('sp-export-select-all-tags');
  if (btnExportSelectAllTags) {
    btnExportSelectAllTags.addEventListener('click', e => {
      e.preventDefault();
      const allProjectItems = getActiveProjectItems();
      const tags = Array.from(new Set([
        ...state.categories.filter(c => c !== 'All'),
        ...allProjectItems.flatMap(i => getItemTags(i))
      ])).filter(Boolean);
      tags.forEach(t => exportSelectedTags.add(t));
      render();
    });
  }

  const btnExportClearTags = document.getElementById('sp-export-clear-tags');
  if (btnExportClearTags) {
    btnExportClearTags.addEventListener('click', e => {
      e.preventDefault();
      exportSelectedTags.clear();
      render();
    });
  }

  document.querySelectorAll('[data-action="toggle-export-tag"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const tag = btn.dataset.tag;
      if (!tag) return;
      if (exportSelectedTags.has(tag)) {
        exportSelectedTags.delete(tag);
      } else {
        exportSelectedTags.add(tag);
      }
      render();
    });
  });

  const btnExportUnified = document.getElementById('sp-btn-export-unified');
  if (btnExportUnified) {
    btnExportUnified.addEventListener('click', () => {
      const format = selectedExportFormat || 'json';
      const activeProj = getActiveProject();
      const projectItems = getActiveProjectItems();
      const allItems = projectItems.length > 0 ? projectItems : state.items;

      let itemsToExport = allItems;
      if (exportSelectedTags.size > 0) {
        itemsToExport = allItems.filter(item => {
          const itemTags = getItemTags(item);
          return itemTags.some(t => exportSelectedTags.has(t));
        });
        if (itemsToExport.length === 0) {
          showToast(t('settings.export_no_matching_items'));
          return;
        }
      }

      const projName = activeProj?.name ? activeProj.name.replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '_') : 'passwords';
      const tagSuffix = exportSelectedTags.size === 1
        ? `-${Array.from(exportSelectedTags)[0]}`
        : (exportSelectedTags.size > 1 ? '-filtered' : '');

      if (format === 'csv') {
        const csvContent = itemsToCsv(itemsToExport);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `passwords-${projName}${tagSuffix}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('settings.export_csv_success'));
      } else {
        const jsonContent = itemsToBitwardenJson(itemsToExport);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `passwords-${projName}${tagSuffix}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('settings.export_json_success'));
      }
    });
  }

  const btnDownloadCsvTemplate = document.getElementById('sp-download-csv-template');
  if (btnDownloadCsvTemplate) {
    btnDownloadCsvTemplate.addEventListener('click', e => {
      e.preventDefault();
      const templateContent = 'login, pass, name, tag, url, note\r\nuser@example.com, P@ssw0rd123!, Google, Work, https://google.com, Primary work account\r\n';
      const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'simplepass-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const btnTriggerImportUnified = document.getElementById('sp-btn-trigger-import-unified');
  const importUnifiedFileInput = document.getElementById('sp-import-unified-file-input');
  if (btnTriggerImportUnified && importUnifiedFileInput) {
    btnTriggerImportUnified.addEventListener('click', () => {
      importUnifiedFileInput.value = '';
      importUnifiedFileInput.click();
    });

    importUnifiedFileInput.addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async evt => {
        try {
          const content = evt.target.result;
          const activeProj = getActiveProject();
          const targetProjId = activeProj ? activeProj.id : (state.projects[0]?.id || 'proj_default');
          const fileName = (file.name || '').toLowerCase();
          const isJson = fileName.endsWith('.json') || (!fileName.endsWith('.csv') && content.trim().startsWith('{'));

          let importedItems = [];
          let newCategories = [];

          if (isJson) {
            const parsed = JSON.parse(content);
            if (parsed.encrypted === true && Array.isArray(parsed.items)) {
              alert(t('toasts.bitwarden_encrypted_err'));
              return;
            }
            if (Array.isArray(parsed.items)) {
              // Bitwarden export or item list
              const res = bitwardenJsonToItems(parsed, targetProjId);
              importedItems = res.items;
              newCategories = res.newCategories;
            } else if (Array.isArray(parsed)) {
              importedItems = parsed.map((item, idx) => ({
                id: item.id || `item_${Date.now()}_${idx}`,
                projectId: targetProjId,
                title: item.title || item.name || 'Untitled',
                username: item.username || item.login || '',
                password: item.password || item.pass || '',
                url: item.url || '',
                notes: item.notes || '',
                category: (Array.isArray(item.tags) && item.tags[0]) || item.category || 'Work',
                tags: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags : [item.category || 'Work'],
                updatedAt: new Date().toISOString()
              }));
            } else if (parsed.projects && Array.isArray(parsed.items)) {
              importedItems = parsed.items.map(item => ({
                ...item,
                projectId: targetProjId
              }));
            } else {
              alert('Неизвестный формат JSON файла');
              return;
            }
          } else {
            // CSV format
            const res = csvToItems(content, targetProjId);
            importedItems = res.items;
            newCategories = res.newCategories;
          }

          if (!importedItems || importedItems.length === 0) {
            alert(t('settings.csv_import_empty'));
            return;
          }

          // Register any newly discovered tags
          if (newCategories && newCategories.length > 0) {
            let catsChanged = false;
            newCategories.forEach(tag => {
              if (!state.categories.some(c => c.toLowerCase() === tag.toLowerCase())) {
                state.categories.push(tag);
                catsChanged = true;
              }
            });
            if (catsChanged) {
              const cfg = await getStoredConfig();
              await saveStoredConfig({
                ...cfg,
                categories: state.categories.filter(c => c !== 'All')
              });
            }
          }

          const updatedItems = [...state.items, ...importedItems];
          updateState({ items: updatedItems });
          await persistVaultChanges();

          showToast(t('settings.csv_import_success', { count: importedItems.length }));
          render();
        } catch (err) {
          alert('Ошибка при импорте: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  const btnDeleteCurrentVault = document.getElementById('sp-btn-delete-current-vault');
  if (btnDeleteCurrentVault) {
    btnDeleteCurrentVault.addEventListener('click', async () => {
      const activeId = await getActiveVaultId();
      const profiles = await getVaultProfiles();
      const currentProfile = profiles.find(p => p.id === activeId);
      const name = currentProfile ? currentProfile.name : '';
      if (confirm(`Удалить текущую базу «${name}»? Другие базы данных останутся сохранены.`)) {
        await deleteVaultProfile(activeId);
        await destroySession();
        window.location.reload();
      }
    });
  }

  const btnResetAll = document.getElementById('sp-btn-reset-all');
  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      const confirmText = prompt('ВНИМАНИЕ: Для полного сброса всех данных введите СБРОС:');
      if (confirmText === 'СБРОС') {
        await clearStoredVault();
        await destroySession();
        window.location.reload();
      }
    });
  }

  // ─── PASS CLI Settings Actions ───
  const btnCheckPassHost = document.getElementById('sp-btn-check-pass-host');
  if (btnCheckPassHost) {
    btnCheckPassHost.addEventListener('click', async () => {
      showToast('Проверка Native Host...');
      const status = await checkPassHostStatus();
      updateState({ passHostStatus: status });
      if (status && status.ok) {
        showToast(`PASS подключен: найдено ${status.entriesCount} записей`);
      } else {
        showToast('Native Host не отвечает: требуется ./install.sh');
      }
    });
  }

  const btnShowPassInstructions = document.getElementById('sp-btn-show-pass-instructions');
  if (btnShowPassInstructions) {
    btnShowPassInstructions.addEventListener('click', () => {
      updateState({ isShowPassInstructions: true });
    });
  }

  const btnClosePassInstructions = document.getElementById('sp-btn-close-pass-instructions');
  const btnAckPassInstructions = document.getElementById('sp-btn-ack-pass-instructions');
  [btnClosePassInstructions, btnAckPassInstructions].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        updateState({ isShowPassInstructions: false });
      });
    }
  });

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

// Start
init();
