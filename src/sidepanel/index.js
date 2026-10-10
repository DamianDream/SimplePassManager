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
  decryptVaultWithRecovery,
  rekeyVault,
  generateTunnelKeyPair,
  encryptTunnelPayload,
  decryptTunnelPayload
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
  passFormatToItem
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

const rootEl = document.getElementById('sp-app-root');

// Active tab information (queried on launch)
let activeTabDomain = '';
let activeTabId = null;

// Drawer / Menu state (mySmart style)
let isDrawerOpen = false;

// Failed unlock attempt counter & lockout state
let failedAttempts = 0;
let isRecoveryViewActive = false;
let newlyCreatedRecoveryPhrase = null;

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
let openAccordions = new Set(['security']);
let isChangePwdOpen = false;
let isCustomSelectOpen = false;

// ─── E2EE BROWSER-TO-BROWSER TUNNEL STATE ───
// Side A: Sending party (holds secret item, connects to Side B's tunnel)
let sendTunnelModalState = {
  isOpen: false,
  item: null,
  peerPublicKey: '',
  encryptedPacket: '',
  status: 'awaiting_tunnel', // 'awaiting_tunnel' | 'ready_to_send' | 'sent'
  error: ''
};

// Side B: Receiving party (opens tunnel, receives encrypted payload into memory)
let receiveTunnelModalState = {
  isOpen: false,
  keyPair: null,
  tunnelToken: '', // invitation code containing Side B public key
  status: 'waiting', // 'waiting' | 'received'
  decryptedItem: null,
  error: ''
};

// ─── INITIALIZATION ──────────────────────────────────────────────────────────

async function init() {
  // Query active tab domain from background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' }, response => {
      if (response && response.domain) {
        activeTabDomain = response.domain;
        activeTabId = response.tabId;
        render();
      }
    });
  }

  const storedVault = await getStoredVault();
  const storedConfig = await getStoredConfig();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('sp_failed_attempts', res => {
      failedAttempts = res.sp_failed_attempts || 0;
      if (!state.isUnlocked) render();
    });
  }

  const userCategories = storedConfig.categories || ['Work', 'Personal'];
  const fullCategories = ['All', ...userCategories.filter(c => c !== 'All')];

  updateState({
    isInitialized: storedVault !== null,
    lockInterval: storedConfig.lockInterval || '3days',
    categories: fullCategories
  });

  // Attempt to restore active session (e.g. valid within 3 days)
  if (storedVault) {
    const session = await restoreSession();
    if (session && session.masterPassword) {
      try {
        const decrypted = await decryptVault(storedVault, session.masterPassword);
        const normalized = normalizeVaultData(decrypted);

        const initialProjectId =
          storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
            ? storedConfig.latestProjectId
            : normalized.projects[0].id;

        updateState({
          isUnlocked: true,
          masterPassword: session.masterPassword,
          projects: normalized.projects,
          items: normalized.items,
          activeProjectId: initialProjectId,
          sessionExpiresAt: session.expiresAt
        });
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

  subscribe(() => render());
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

async function handleUnlock(password) {
  clearFieldErrors();
  if (failedAttempts >= 3) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', 'Ввод пароля заблокирован после 3 неверных попыток. Используйте ключ восстановления.');
    renderAuthScreen();
    return;
  }

  if (!password) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', 'Введите мастер-пароль');
    return;
  }

  try {
    const envelope = await getStoredVault();
    const decrypted = await decryptVault(envelope, password);
    const normalized = normalizeVaultData(decrypted);
    const storedConfig = await getStoredConfig();

    const initialProjectId =
      storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
        ? storedConfig.latestProjectId
        : normalized.projects[0].id;

    // Reset failed attempts counter on success
    failedAttempts = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ sp_failed_attempts: 0 });
    }

    // Create session (default 3 days or configured interval)
    const session = await createSession(password, state.lockInterval || '3days');

    updateState({
      isUnlocked: true,
      masterPassword: password,
      projects: normalized.projects,
      items: normalized.items,
      activeProjectId: initialProjectId,
      sessionExpiresAt: session.expiresAt
    });
  } catch (err) {
    failedAttempts++;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ sp_failed_attempts: failedAttempts });
    }

    if (failedAttempts >= 3) {
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

  // Generate 12-word recovery phrase and encrypt with Dual-Key Envelope
  const recoveryPhrase = generateRecoveryPhrase();
  const encrypted = await encryptVault(initialData, password, recoveryPhrase);
  await saveStoredVault(encrypted);
  await saveStoredConfig({
    activeProjectId: projId,
    latestProjectId: projId,
    lockInterval: '3days'
  });

  const session = await createSession(password, '3days');
  failedAttempts = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ sp_failed_attempts: 0 });
  }

  // Display 12-word recovery phrase modal to user before final unlock
  newlyCreatedRecoveryPhrase = recoveryPhrase;
  updateState({
    isInitialized: true,
    isUnlocked: true,
    masterPassword: password,
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
    const { vaultData } = await decryptVaultWithRecovery(envelope, normPhrase);
    const normalized = normalizeVaultData(vaultData);

    // Re-encrypt vault with new password and new recovery phrase
    const newRecoveryPhrase = generateRecoveryPhrase();
    const rekeyedEnvelope = await encryptVault(normalized, newPassword, newRecoveryPhrase);
    await saveStoredVault(rekeyedEnvelope);

    // Reset failed attempts
    failedAttempts = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ sp_failed_attempts: 0 });
    }

    const session = await createSession(newPassword, '3days');
    isRecoveryViewActive = false;
    newlyCreatedRecoveryPhrase = newRecoveryPhrase;

    updateState({
      isUnlocked: true,
      masterPassword: newPassword,
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
  if (!state.masterPassword) return;
  const vaultData = {
    version: 2,
    updatedAt: new Date().toISOString(),
    projects: state.projects,
    items: state.items
  };
  const encrypted = await encryptVault(vaultData, state.masterPassword);
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
  let itemToSave = { ...itemData, projectId, updatedAt: new Date().toISOString() };

  if (existingIdx >= 0) {
    updatedItems[existingIdx] = itemToSave;
  } else {
    itemToSave.id = 'item_' + Date.now();
    updatedItems.unshift(itemToSave);
  }

  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();

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

function triggerAutofill(item) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && activeTabId) {
    chrome.runtime.sendMessage(
      {
        type: 'AUTOFILL_LOGIN',
        tabId: activeTabId,
        username: item.username,
        password: item.password
      },
      response => {
        if (response && response.success) {
          showToast('Форма успешно заполнена!');
        } else {
          showToast('Скопировано в буфер (поля не найдены)');
          copyToClipboard(item.password);
        }
      }
    );
  } else {
    copyToClipboard(item.password);
    showToast('Пароль скопирован в буфер');
  }
}

function showToast(text) {
  let toast = document.getElementById('sp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-toast';
    toast.style.cssText = `
      position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%);
      background: var(--accent); color: var(--accent-text, #121316); font-size: 12px; font-weight: 700;
      padding: 8px 16px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);
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
  let sectionTitle = 'Пароли';
  if (state.activeTab === 'vault') {
    sectionTitle = `Пароли (${activeItems.length})`;
  } else if (state.activeTab === 'generator') {
    sectionTitle = 'Генератор пароля';
  } else if (state.activeTab === 'settings') {
    sectionTitle = 'Настройки';
  } else if (state.activeTab === 'item-details') {
    sectionTitle = state.selectedItem ? 'Редактирование' : 'Новый пароль';
  }

  rootEl.innerHTML = `
    <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <!-- Top Bar (mySmart style: Burger + Current Section Title + Action Icons) -->
      <header class="sp-header">
        <div class="sp-header-left">
          <button class="sp-btn-icon" id="sp-burger-btn" title="Меню">${icons.iMenu}</button>
          <span class="sp-header-title" id="sp-header-title">${sectionTitle}</span>
        </div>
        <div class="sp-header-actions">
          <button class="sp-btn-icon" id="sp-btn-open-tunnel-receive" title="Принять пароль (E2EE туннель)">${icons.iTunnel}</button>
          <button class="sp-btn-icon" id="sp-btn-add" title="Добавить пароль">${icons.iPlus}</button>
          <button class="sp-btn-icon" id="sp-btn-lock" title="Заблокировать">${icons.iLock}</button>
        </div>
      </header>

      <!-- Slide-Over Drawer Navigation (mySmart style) -->
      <div class="sp-drawer-overlay ${isDrawerOpen ? 'open' : ''}" id="sp-drawer-overlay"></div>
      <aside class="sp-drawer ${isDrawerOpen ? 'open' : ''}" id="sp-drawer">
        <div class="sp-drawer-header">
          <span class="sp-drawer-heading">Меню</span>
          <button class="sp-btn-icon" id="sp-close-drawer-btn" title="Закрыть">${icons.iX}</button>
        </div>
        <nav class="sp-drawer-menu">
          <button class="sp-drawer-item ${state.activeTab === 'vault' ? 'active' : ''}" data-nav="vault">
            <span class="sp-drawer-item-icon">${icons.iKey}</span>
            <span>Пароли</span>
            <span class="sp-drawer-item-badge">${activeItems.length}</span>
          </button>
          <button class="sp-drawer-item ${state.activeTab === 'generator' ? 'active' : ''}" data-nav="generator">
            <span class="sp-drawer-item-icon">${icons.iDice}</span>
            <span>Генератор пароля</span>
          </button>
          <button class="sp-drawer-item ${state.activeTab === 'settings' ? 'active' : ''}" data-nav="settings">
            <span class="sp-drawer-item-icon">${icons.iSettings}</span>
            <span>Настройки</span>
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
          <span>${activeItems.length} паролей в базе</span>
        </div>
        <div class="sp-footer-right">
          <div class="sp-project-badge ${state.isProjectSwitcherOpen ? 'active' : ''}" id="sp-project-container" title="База данных (Проект)">
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

      <!-- E2EE Tunnel Modals (Party A Sender & Party B Receiver) -->
      ${renderSendTunnelModal()}
      ${renderReceiveTunnelModal()}

      <!-- 12-Word Recovery Key Backup Modal (shown on profile creation or recovery rekey) -->
      ${renderRecoveryBackupModal()}
    </div>
  `;

  attachEventHandlers();

  if (activeElId) {
    const el = document.getElementById(activeElId);
    if (el) {
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
  if (!state.isInitialized) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;border-radius:12px;display:block;" alt="Logo" /></div>
          <h2 class="sp-auth-title">Создание профиля</h2>
          <p class="sp-auth-desc">Задайте имя первого профиля и мастер-пароль для шифрования AES-256-GCM.</p>
          <form class="sp-auth-form" id="sp-init-form" novalidate>
            <div>
              <input type="text" id="sp-init-proj-name" class="sp-input" placeholder="Название профиля" />
              <div class="sp-field-error" id="sp-err-proj-name"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd" class="sp-input" placeholder="Мастер-пароль (более 8 симв. + спецсимвол)" />
              <div class="sp-field-error" id="sp-err-pwd"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd2" class="sp-input" placeholder="Повторите мастер-пароль" />
              <div class="sp-field-error" id="sp-err-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              Создать профиль
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

  // 2. Recovery screen view
  if (isRecoveryViewActive) {
    rootEl.innerHTML = `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;border-radius:10px;display:block;" alt="Logo" /></div>
          <h2 class="sp-auth-title">Восстановление доступа</h2>
          <p class="sp-auth-desc">Введите ваш секретный ключ из 12 слов и задайте новый мастер-пароль.</p>

          <form class="sp-auth-form" id="sp-recovery-form" novalidate>
            <div>
              <textarea id="sp-recover-phrase" class="sp-input" style="height: 72px; resize:none; font-family:monospace; font-size:12px; line-height:1.4;" placeholder="12 слов через пробел (например: abandon ability able ...)"></textarea>
              <div class="sp-field-error" id="sp-err-recover-phrase"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd" class="sp-input" placeholder="Новый мастер-пароль (>8 симв. + спецсимвол)" />
              <div class="sp-field-error" id="sp-err-recover-pwd"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd2" class="sp-input" placeholder="Повторите новый мастер-пароль" />
              <div class="sp-field-error" id="sp-err-recover-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iUnlock} Восстановить доступ
            </button>
            <div style="text-align:center; margin-top: 6px;">
              <button type="button" class="sp-link-btn" id="sp-btn-cancel-recovery">Вернуться ко входу</button>
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

  // 3. Normal Lock Screen with failed attempt lockout and inline "Забыли пароль?"
  const isLockedOut = failedAttempts >= 3;

  rootEl.innerHTML = `
    <div class="sp-auth-screen">
      <div class="sp-auth-box">
        <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;border-radius:12px;display:block;" alt="Logo" /></div>
        <h2 class="sp-auth-title">SimplePass заблокирован</h2>
        <p class="sp-auth-desc">Введите мастер-пароль для разблокировки записей</p>

        ${isLockedOut ? `
          <div class="sp-lockout-alert">
            <strong>🔒 Ввод пароля заблокирован!</strong><br>
            Превышен лимит 3 неудачных попыток ввода. Доступ к хранилищу возможен только по секретному ключу восстановления (12 слов).
          </div>
        ` : ''}

        <form class="sp-auth-form" id="sp-unlock-form" novalidate>
          <div>
            <input type="password" id="sp-unlock-pwd" class="sp-input" placeholder="Мастер-пароль" ${isLockedOut ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'autofocus'} />
            <div class="sp-field-error" id="sp-err-unlock" ${failedAttempts > 0 && !isLockedOut ? 'style="display:block;"' : ''}>${failedAttempts > 0 && !isLockedOut ? `Неверный мастер-пароль. Попытка ${failedAttempts} из 3.` : ''}</div>
          </div>

          <div id="sp-forgot-pwd-wrap" style="text-align:center; margin-top:-4px; margin-bottom:4px; display:${failedAttempts > 0 || isLockedOut ? 'block' : 'none'};">
            <button type="button" class="sp-link-btn" id="sp-forgot-pwd">Забыли пароль?</button>
          </div>

          ${isLockedOut ? `
            <button type="button" class="sp-btn-primary" id="sp-btn-goto-recovery" style="justify-content:center; margin-top: 6px;">
              ${icons.iKey} Восстановить по ключу (12 слов)
            </button>
          ` : `
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iUnlock} Разблокировать
            </button>
          `}
        </form>
      </div>
    </div>
  `;

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

  const gotoRecoveryBtn = document.getElementById('sp-btn-goto-recovery');
  if (gotoRecoveryBtn) {
    gotoRecoveryBtn.addEventListener('click', () => {
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

function renderVaultView() {
  const query = state.searchQuery.toLowerCase().trim();
  const cat = state.activeCategory;
  const projectItems = getActiveProjectItems();

  const filteredItems = projectItems.filter(item => {
    const matchesCat = cat === 'All' || item.category === cat;
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.username && item.username.toLowerCase().includes(query)) ||
      (item.url && item.url.toLowerCase().includes(query));
    return matchesCat && matchesQuery;
  });

  let activeDomainNotice = '';
  if (activeTabDomain) {
    const domainMatches = projectItems.filter(
      i => i.url && i.url.toLowerCase().includes(activeTabDomain.toLowerCase())
    );
    if (domainMatches.length > 0) {
      activeDomainNotice = `
        <div style="background: rgba(244, 230, 73, 0.12); border: 1px solid var(--accent); padding: 6px 12px; margin: 8px 14px 0; border-radius: 8px; font-size: 11px; display: flex; align-items: center; justify-content: space-between;">
          <span style="color: var(--accent); font-weight: 600;">Найдено для ${activeTabDomain}: ${domainMatches.length}</span>
          <button class="sp-btn-icon" id="sp-filter-domain" style="width:20px;height:20px;" title="Показать">${icons.iGlobe}</button>
        </div>
      `;
    }
  }

  const pillsHtml = state.categories
    .map(c => `<button class="sp-pill ${c === state.activeCategory ? 'active' : ''}" data-cat="${c}">${c}</button>`)
    .join('');

  const cardsHtml =
    filteredItems.length === 0
      ? `
      <div class="sp-empty-state">
        <div class="sp-empty-icon">${icons.iKey}</div>
        <p style="font-size: 13px; font-weight: 600;">Нет паролей в этой базе</p>
        <p style="font-size: 11px;">Нажмите «+» вверху, чтобы добавить запись</p>
      </div>
    `
      : filteredItems
          .map(item => {
            const letter = item.title ? item.title[0] : '?';
            return `
        <div class="sp-card" data-id="${item.id}">
          <div class="sp-card-left" data-action="view">
            <div class="sp-card-avatar">${letter}</div>
            <div class="sp-card-meta">
              <span class="sp-card-title">${item.title}</span>
              <span class="sp-card-sub">${item.username || item.url || 'Нет логина'}</span>
            </div>
          </div>
          <div class="sp-card-actions">
            <button class="sp-btn-icon" data-action="share" title="Поделиться (PIN-код)">${icons.iShare}</button>
            <button class="sp-btn-icon" data-action="autofill" title="Заполнить на сайте">${icons.iZap}</button>
            <button class="sp-btn-icon" data-action="copy-user" title="Копировать логин">${icons.iCopy}</button>
            <button class="sp-btn-icon" data-action="copy-pwd" title="Копировать пароль">${icons.iKey}</button>
          </div>
        </div>
      `;
          })
          .join('');

  return `
    <div class="sp-search-bar">
      <div class="sp-search-input-wrap">
        <span class="sp-search-icon">${icons.iSearch}</span>
        <input type="text" id="sp-search-input" class="sp-search-input" placeholder="Поиск паролей..." value="${state.searchQuery}" />
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
        ? `<span class="sp-badge-pass">PASS CLI</span>`
        : `<span class="sp-badge-browser">Браузер</span>`;

      return `
      <div class="sp-project-item ${isActive ? 'active' : ''}" data-project-id="${p.id}">
        <div class="sp-project-item-left" data-action="select-project" data-project-id="${p.id}">
          <div class="sp-radio-indicator"></div>
          <div class="sp-project-info">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="sp-project-name">${p.name}</span>
              ${typeBadge}
            </div>
            <span class="sp-project-meta">${count} паролей</span>
          </div>
        </div>
        <div class="sp-project-item-actions">
          ${
            p.type === 'pass_cli'
              ? `<button class="sp-btn-icon" data-action="sync-pass-project" data-project-id="${p.id}" title="Синхронизировать с ~/.password-store">${icons.iRefresh}</button>`
              : ''
          }
          <button class="sp-btn-icon" data-action="rename-project" data-project-id="${p.id}" title="Переименовать">${icons.iEdit}</button>
          ${
            state.projects.length > 1
              ? `<button class="sp-btn-icon" data-action="delete-project" data-project-id="${p.id}" title="Удалить проект">${icons.iTrash}</button>`
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
        <span class="sp-panel-title">${icons.iFolder} Базы данных (Проекты)</span>
        <button class="sp-btn-icon" id="sp-close-project-panel">${icons.iX}</button>
      </div>

      <div class="sp-project-list">
        ${projectItemsHtml}
      </div>

      <div class="sp-new-project-card">
        <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:8px;">
          Создать новую базу
        </span>
        <form id="sp-create-project-form" style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:8px;">
            <input type="text" id="sp-new-project-name" class="sp-input" placeholder="Название базы (напр. Work)" required style="flex:1;" />
            <button type="submit" class="sp-btn-primary" style="padding:8px 12px; white-space:nowrap;">
              ${icons.iPlus} Создать
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:12px; margin-top:2px;">
            <label style="font-size:11px; color:var(--text-dim); display:flex; align-items:center; gap:4px; cursor:pointer;">
              <input type="radio" name="sp-new-project-type" value="browser" checked style="accent-color:var(--accent);" />
              <span>Браузер (AES-256)</span>
            </label>
            <label style="font-size:11px; color:var(--text-dim); display:flex; align-items:center; gap:4px; cursor:pointer;" title="Синхронизация с локальным ~/.password-store через Native Messaging">
              <input type="radio" name="sp-new-project-type" value="pass_cli" style="accent-color:var(--accent);" />
              <span>Локальный PASS CLI</span>
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
          <span class="sp-modal-title">${icons.iTrash} Удаление базы</span>
          <button class="sp-btn-icon" id="sp-modal-cancel-btn">${icons.iX}</button>
        </div>

        <div class="sp-modal-danger-box">
          <strong>Внимание: Каскадное удаление!</strong><br>
          База «<strong>${proj.name}</strong>» и все привязанные к ней пароли (<strong>${count} шт.</strong>) будут удалены безвозвратно.
        </div>

        <form id="sp-delete-project-form" style="display:flex; flex-direction:column; gap:10px;">
          <div class="sp-form-group">
            <label class="sp-label">Введите «<strong>${proj.name}</strong>» для подтверждения:</label>
            <input type="text" id="sp-delete-confirm-name" class="sp-input" placeholder="${proj.name}" required />
          </div>

          <div class="sp-form-group">
            <label class="sp-label">Введите мастер-пароль:</label>
            <input type="password" id="sp-delete-confirm-pwd" class="sp-input" placeholder="Мастер-пароль" required />
          </div>

          <div id="sp-delete-modal-error" style="display:none; font-size:11px; color:var(--danger);"></div>

          <div style="display:flex; gap:8px; margin-top:4px;">
            <button type="button" class="sp-btn-secondary" id="sp-modal-close-btn" style="flex:1; justify-content:center;">
              Отмена
            </button>
            <button type="submit" class="sp-btn-danger" style="flex:1; justify-content:center;">
              Удалить всё
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
          <span class="sp-modal-title" style="color:var(--accent);">${icons.iFolder} Подключение UNIX PASS CLI</span>
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

// ─── E2EE BROWSER-TO-BROWSER TUNNEL LOGIC ────────────────────────────────────

/**
 * Side A: Sender initiates sending a password through an E2EE tunnel.
 */
function openSendTunnelModal(item) {
  sendTunnelModalState = {
    isOpen: true,
    item,
    peerPublicKey: '',
    encryptedPacket: '',
    status: 'awaiting_tunnel',
    error: ''
  };
  render();
}

function closeSendTunnelModal() {
  sendTunnelModalState = {
    isOpen: false,
    item: null,
    peerPublicKey: '',
    encryptedPacket: '',
    status: 'awaiting_tunnel',
    error: ''
  };
  render();
}

/**
 * Side B: Receiver creates an ephemeral E2EE tunnel and waits for transmission.
 */
async function openReceiveTunnelModal() {
  try {
    const keyPairInfo = await generateTunnelKeyPair();
    // Tunnel token encodes Side B's ephemeral ECDH public key
    const tunnelToken = `SPTUN_KEY:${keyPairInfo.publicKeyBase64}`;

    receiveTunnelModalState = {
      isOpen: true,
      keyPair: keyPairInfo.keyPair,
      tunnelToken,
      status: 'waiting',
      decryptedItem: null,
      error: ''
    };
    render();
  } catch (err) {
    showToast('Ошибка создания туннеля: ' + err.message);
  }
}

function closeReceiveTunnelModal() {
  // Ephemeral keys are immediately garbage collected and destroyed
  receiveTunnelModalState = {
    isOpen: false,
    keyPair: null,
    tunnelToken: '',
    status: 'waiting',
    decryptedItem: null,
    error: ''
  };
  render();
}

function renderSendTunnelModal() {
  if (!sendTunnelModalState.isOpen || !sendTunnelModalState.item) return '';

  const { item, status, encryptedPacket, error } = sendTunnelModalState;

  return `
    <div class="sp-modal-overlay" id="sp-send-tunnel-overlay" style="z-index: 200;">
      <div class="sp-modal-content" style="max-width:350px;">
        <div class="sp-modal-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="sp-modal-title" style="color:var(--accent);">${icons.iTunnel} Передача через E2EE туннель</span>
          </div>
          <button class="sp-btn-icon" id="sp-send-tunnel-close">${icons.iX}</button>
        </div>

        <div style="font-size:12px; color:var(--text-muted); line-height:1.4;">
          Передача пароля <b>«${escapeHtml(item.title)}»</b> защищена сквозным шифрованием (ECDH + AES-256-GCM).
        </div>

        ${status === 'awaiting_tunnel' ? `
          <div class="sp-tunnel-box">
            <div class="sp-tunnel-status-bar">
              <span class="sp-tunnel-pulse-dot"></span>
              <span>Шаг 1: Подключение к туннелю Стороны Б</span>
            </div>
            <p style="font-size:11px; color:var(--text-muted); margin-top:2px; line-height:1.4;">
              Запросите у принимающей стороны код/ссылку открытого туннеля и вставьте её ниже:
            </p>
            <textarea id="sp-send-peer-key-input" class="sp-tunnel-code-area" placeholder="Вставьте код туннеля (SPTUN_KEY:...)"></textarea>
            ${error ? `<div style="font-size:11px; color:var(--danger);">${escapeHtml(error)}</div>` : ''}
          </div>

          <button class="sp-btn-primary" id="sp-btn-connect-and-encrypt" style="justify-content:center; width:100%;">
            ${icons.iZap} Установить защищенное соединение и зашифровать
          </button>
        ` : `
          <div class="sp-tunnel-box">
            <div class="sp-tunnel-status-bar" style="color:var(--success);">
              <span class="sp-tunnel-pulse-dot success"></span>
              <span>Туннель защищен • Пароль готов к передаче</span>
            </div>
            <p style="font-size:11px; color:var(--text-muted); line-height:1.4;">
              Данные зашифрованы ключом принимающего браузера. Передайте зашифрованный пакет в туннель:
            </p>
            <textarea readonly class="sp-tunnel-code-area" style="user-select:all;">${encryptedPacket}</textarea>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="sp-btn-primary" id="sp-btn-copy-tunnel-packet" style="justify-content:center; font-size:12px;">
              ${icons.iCopy} Скопировать зашифрованный пакет в туннель
            </button>
            <button class="sp-btn-secondary" id="sp-btn-close-send-tunnel" style="justify-content:center; font-size:12px;">
              Закрыть туннель
            </button>
          </div>
        `}

        <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-top:10px;">
          <span class="sp-tunnel-badge">🔒 Zero-Knowledge RAM-to-RAM</span>
        </div>
      </div>
    </div>
  `;
}

function renderReceiveTunnelModal() {
  if (!receiveTunnelModalState.isOpen) return '';

  const { tunnelToken, decryptedItem, error } = receiveTunnelModalState;

  return `
    <div class="sp-modal-overlay" id="sp-receive-tunnel-overlay" style="z-index: 200;">
      <div class="sp-modal-content" style="max-width:350px;">
        <div class="sp-modal-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="sp-modal-title" style="color:var(--accent);">${icons.iTunnel} E2EE туннель приема</span>
          </div>
          <button class="sp-btn-icon" id="sp-receive-tunnel-close">${icons.iX}</button>
        </div>

        ${!decryptedItem ? `
          <div style="font-size:12px; color:var(--text-muted); line-height:1.4;">
            Безопасный туннель открыт. Скопируйте ссылку/код туннеля и передайте отправителю.
          </div>

          <div class="sp-tunnel-box">
            <div class="sp-tunnel-status-bar">
              <span class="sp-tunnel-pulse-dot"></span>
              <span>Ожидание передачи в туннель...</span>
            </div>
            <p style="font-size:11px; color:var(--text-muted); line-height:1.3;">
              Ваш ключ туннеля (передайте отправителю):
            </p>
            <textarea readonly class="sp-tunnel-code-area" style="height:54px; user-select:all;">${tunnelToken}</textarea>
            <button class="sp-btn-secondary" id="sp-btn-copy-tunnel-token" style="justify-content:center; font-size:11px; padding:5px 8px;">
              ${icons.iCopy} Скопировать код туннеля
            </button>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
            <label class="sp-label" style="margin:0;">Полученный зашифрованный пакет из туннеля:</label>
            <textarea id="sp-receive-packet-input" class="sp-tunnel-code-area" placeholder="Вставьте полученный пакет (SPTUN1:...)"></textarea>
            ${error ? `<div style="font-size:11px; color:var(--danger);">${escapeHtml(error)}</div>` : ''}

            <button class="sp-btn-primary" id="sp-btn-decrypt-tunnel-packet" style="justify-content:center;">
              ${icons.iUnlock} Принять и расшифровать
            </button>
          </div>
        ` : `
          <div class="sp-tunnel-status-bar" style="color:var(--success); margin-bottom:8px;">
            <span class="sp-tunnel-pulse-dot success"></span>
            <span>Пароль успешно получен по E2EE туннелю!</span>
          </div>

          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:12px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:var(--text-dim);">Название:</span>
              <span style="font-weight:700; color:var(--text-main); font-size:13px;">${escapeHtml(decryptedItem.title)}</span>
            </div>
            ${decryptedItem.username ? `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:var(--text-dim);">Логин:</span>
              <span style="font-family:monospace; color:var(--text-muted); font-size:12px;">${escapeHtml(decryptedItem.username)}</span>
            </div>` : ''}
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:var(--text-dim);">Пароль:</span>
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-family:monospace; font-weight:700; color:var(--accent); font-size:13px;" id="sp-tunnel-decrypted-pwd">${escapeHtml(decryptedItem.password)}</span>
                <button class="sp-btn-icon" id="sp-btn-copy-tunnel-pwd" title="Копировать">${icons.iCopy}</button>
              </div>
            </div>
            ${decryptedItem.url ? `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:var(--text-dim);">URL:</span>
              <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(decryptedItem.url)}</span>
            </div>` : ''}
            ${decryptedItem.notes ? `
            <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">
              Заметки: <span style="color:var(--text-muted);">${escapeHtml(decryptedItem.notes)}</span>
            </div>` : ''}
          </div>

          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="sp-btn-primary" id="sp-btn-save-tunnel-item" style="flex:1; justify-content:center; font-size:12px;">
              ${icons.iPlus} Сохранить в профиль
            </button>
            <button class="sp-btn-secondary" id="sp-btn-finish-tunnel" style="padding:6px 12px; font-size:12px;">
              Закрыть туннель
            </button>
          </div>
        `}

        <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-top:10px;">
          <span class="sp-tunnel-badge">⚡ Туннель закрывается после завершения</span>
        </div>
      </div>
    </div>
  `;
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
          <span class="sp-modal-title" style="color:var(--accent);">${icons.iKey} Секретный ключ (12 слов)</span>
          <button class="sp-btn-icon" id="sp-recovery-modal-close">${icons.iX}</button>
        </div>

        <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">
          Сохраните этот ключ в надёжном месте! Он понадобится для восстановления доступа, если вы забудете мастер-пароль или база будет заблокирована после 3 неверных попыток.
        </p>

        <div class="sp-recovery-grid">
          ${wordsGridHtml}
        </div>

        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="sp-btn-secondary" id="sp-btn-copy-recovery-phrase" style="flex:1; justify-content:center; font-size:12px;">
            ${icons.iCopy} Скопировать 12 слов
          </button>
          <button class="sp-btn-secondary" id="sp-btn-download-recovery-phrase" style="flex:1; justify-content:center; font-size:12px;">
            ${icons.iDownload} Скачать .txt
          </button>
        </div>

        <button class="sp-btn-primary" id="sp-btn-confirm-recovery-saved" style="width:100%; justify-content:center; margin-top:12px;">
          ${icons.iCheck} Я сохранил ключ восстановления
        </button>
      </div>
    </div>
  `;
}

// ─── ITEM FORM VIEW (ADD / EDIT) ─────────────────────────────────────────────

function renderItemFormView() {
  const activeProj = getActiveProject();
  const item = state.selectedItem || {
    id: '',
    projectId: activeProj ? activeProj.id : 'proj_default',
    title: '',
    username: '',
    password: '',
    url: activeTabDomain ? `https://${activeTabDomain}` : '',
    category: 'Work',
    notes: ''
  };

  const isNew = !item.id;

  return `
    <div class="sp-view-container">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <button class="sp-btn-secondary" id="sp-form-back" style="padding:6px 10px;">
          ${icons.iX} Назад
        </button>
        <h3 style="font-size:14px; font-weight:700;">${isNew ? 'Новая запись' : 'Редактирование'}</h3>
        <div style="display:flex; gap:6px;">
          ${!isNew ? `<button type="button" class="sp-btn-secondary" id="sp-form-share" style="padding:6px 10px;" title="Поделиться (PIN-код)">${icons.iShare}</button>` : ''}
          ${!isNew ? `<button type="button" class="sp-btn-danger" id="sp-form-delete" style="padding:6px 10px;" title="Удалить">${icons.iTrash}</button>` : '<div></div>'}
        </div>
      </div>

      ${
        isNew
          ? `
        <div style="background:var(--bg-surface); border:1px dashed var(--border-subtle); border-radius:var(--radius-sm); padding:10px 12px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:12px; font-weight:600; color:var(--text-main);">Импорт паролей из CSV</div>
            <div style="font-size:11px; color:var(--text-dim);">Chrome, Bitwarden, 1Password...</div>
          </div>
          <label class="sp-btn-secondary" style="padding:5px 10px; font-size:11px; cursor:pointer;">
            ${icons.iDownload} Выбрать CSV
            <input type="file" id="sp-csv-file-input" accept=".csv,text/csv" style="display:none;" />
          </label>
        </div>
      `
          : ''
      }

      <form id="sp-item-form" style="display:flex; flex-direction:column; gap:12px;">
        <input type="hidden" id="sp-item-id" value="${item.id}" />

        <div class="sp-form-group">
          <label class="sp-label">База данных (Проект)</label>
          <select id="sp-item-project" class="sp-input">
            ${state.projects
              .map(p => `<option value="${p.id}" ${p.id === item.projectId ? 'selected' : ''}>${p.name}</option>`)
              .join('')}
          </select>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">Название *</label>
          <input type="text" id="sp-item-title" class="sp-input" value="${item.title}" placeholder="Например: GitHub, Pipedrive" required />
        </div>

        <div class="sp-form-group">
          <label class="sp-label">Веб-сайт / URL</label>
          <input type="text" id="sp-item-url" class="sp-input" value="${item.url}" placeholder="https://..." />
        </div>

        <div class="sp-form-group">
          <label class="sp-label">Логин / Email</label>
          <input type="text" id="sp-item-username" class="sp-input" value="${item.username}" placeholder="user@example.com" />
        </div>

        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label class="sp-label">Пароль *</label>
            <button type="button" class="sp-btn-icon" id="sp-btn-gen-inline" style="width:auto; height:20px; font-size:11px; gap:4px;" title="Сгенерировать случайный пароль">
              ${icons.iDice} Сгенерировать
            </button>
          </div>
          <div class="sp-input-with-action">
            <input type="${isPasswordVisible ? 'text' : 'password'}" id="sp-item-password" class="sp-input" value="${item.password}" required style="padding-right: 36px;" />
            <button type="button" class="sp-input-action-btn" id="sp-toggle-pwd-vis">
              ${isPasswordVisible ? icons.iEyeOff : icons.iEye}
            </button>
          </div>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">Категория</label>
          <select id="sp-item-category" class="sp-input">
            ${state.categories
              .filter(c => c !== 'All')
              .map(c => `<option value="${c}" ${(item.category === c || (!item.category && c === 'Work')) ? 'selected' : ''}>${c}</option>`)
              .join('')}
          </select>
        </div>

        <div class="sp-form-group">
          <label class="sp-label">Заметки / Доп. инфо</label>
          <textarea id="sp-item-notes" class="sp-input" rows="3" placeholder="OTP-секрет, кодовые фразы...">${item.notes || ''}</textarea>
        </div>

        <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top:8px;">
          Сохранить
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

  const strength = evaluatePasswordStrength(currentGeneratedPassword);

  return `
    <div class="sp-view-container">
      <div class="sp-gen-result-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; font-weight:700; color:${strength.color}; text-transform:uppercase;">
            ${strength.label} (${strength.score}/100)
          </span>
          <div style="display:flex; gap:4px;">
            <button class="sp-btn-icon" id="sp-gen-refresh" title="Сгенерировать новый">${icons.iRefresh}</button>
            <button class="sp-btn-icon" id="sp-gen-copy" title="Копировать">${icons.iCopy}</button>
          </div>
        </div>
        <div class="sp-gen-password-display" id="sp-gen-display">${currentGeneratedPassword}</div>
        <div class="sp-strength-meter">
          <div class="sp-strength-bar" style="width:${strength.score}%; background-color:${strength.color};"></div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <label class="sp-label" style="margin:0;">Длина пароля</label>
            <span style="font-size:13px; font-weight:700; color:var(--accent);" id="sp-length-val">${genOptions.length}</span>
          </div>
          <input type="range" id="sp-slider-len" min="8" max="64" value="${genOptions.length}" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
        </div>

        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Прописные буквы (A-Z)</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-upper" ${genOptions.useUpper ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Строчные буквы (a-z)</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-lower" ${genOptions.useLower ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Цифры (0-9)</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-digits" ${genOptions.useDigits ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Спецсимволы (!@#$%^&*)</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-symbols" ${genOptions.useSymbols ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Исключить неоднозначные (0, O, 1, l)</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-ambig" ${genOptions.avoidAmbiguous ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
      </div>

      <button class="sp-btn-primary" id="sp-gen-use-btn" style="justify-content:center; margin-top:10px;">
        ${icons.iCopy} Скопировать пароль
      </button>
    </div>
  `;
}

// ─── SETTINGS VIEW (mySmart Style Accordions & Search) ──────────────────────

function renderSettingsView() {
  const query = settingsSearchQuery.toLowerCase().trim();

  // Calculate session status text
  let sessionStatusText = 'Активна';
  if (state.lockInterval === 'session') {
    sessionStatusText = 'Активна (до закрытия браузера)';
  } else if (state.sessionExpiresAt) {
    const diffMs = state.sessionExpiresAt - Date.now();
    if (diffMs > 0) {
      const hours = Math.round(diffMs / (3600 * 1000));
      if (hours >= 24) {
        const days = Math.round(hours / 24);
        sessionStatusText = `Активна (~${days} дн.)`;
      } else {
        sessionStatusText = `Активна (~${hours} ч.)`;
      }
    } else {
      sessionStatusText = 'Истекла';
    }
  }

  const intervalLabels = {
    session: 'Каждый раз при новой сессии браузера',
    '1day': 'Раз в день (24 часа)',
    '3days': 'Раз в три дня (по умолчанию, 72 часа)',
    '1week': 'Раз в неделю (7 дней)',
    '1month': 'Раз в месяц (30 дней)'
  };
  const selectedIntervalLabel = intervalLabels[state.lockInterval] || intervalLabels['3days'];

  // 1. Accordion: Security & Session
  const secHtml = `
    <div class="sp-setting-row" data-search="проверка пароля сессия тайм-аут 3 дня день неделя месяц безопасность">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iKey} Проверка мастер-пароля</span>
        <span class="sp-badge-info">${LOCK_INTERVALS[state.lockInterval]?.id === '3days' ? 'Раз в 3 дня' : (state.lockInterval || '3days')}</span>
      </div>
      <p class="sp-setting-desc">Периодичность, с которой расширение запрашивает мастер-пароль.</p>
      <div class="sp-setting-control">
        <div class="sp-custom-select ${isCustomSelectOpen ? 'open' : ''}" id="sp-setting-lock-interval-dropdown">
          <button type="button" class="sp-custom-select-trigger" id="sp-custom-lock-trigger">
            <span class="sp-custom-select-value">${selectedIntervalLabel}</span>
            <span class="sp-custom-select-arrow">${icons.iChevronDown}</span>
          </button>
          <div class="sp-custom-select-dropdown">
            <div class="sp-custom-select-option ${state.lockInterval === 'session' ? 'selected' : ''}" data-val="session">
              <span>Каждый раз при новой сессии браузера</span>
              ${state.lockInterval === 'session' ? `<span style="color:var(--accent);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '1day' ? 'selected' : ''}" data-val="1day">
              <span>Раз в день (24 часа)</span>
              ${state.lockInterval === '1day' ? `<span style="color:var(--accent);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '3days' ? 'selected' : ''}" data-val="3days">
              <span>Раз в три дня (по умолчанию, 72 часа)</span>
              ${state.lockInterval === '3days' ? `<span style="color:var(--accent);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '1week' ? 'selected' : ''}" data-val="1week">
              <span>Раз в неделю (7 дней)</span>
              ${state.lockInterval === '1week' ? `<span style="color:var(--accent);">${icons.iCheck}</span>` : ''}
            </div>
            <div class="sp-custom-select-option ${state.lockInterval === '1month' ? 'selected' : ''}" data-val="1month">
              <span>Раз в месяц (30 дней)</span>
              ${state.lockInterval === '1month' ? `<span style="color:var(--accent);">${icons.iCheck}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-setting-row" data-search="статус сессия время активности">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iShield} Статус текущей сессии</span>
        <span style="font-size:11px; font-weight:600; color:var(--success);">${sessionStatusText}</span>
      </div>
      <p class="sp-setting-desc">Пока сессия активна, секреты доступны без повторного ввода пароля.</p>
    </div>

    <div class="sp-setting-row" data-search="сменить мастер пароль ключ безопасность">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iEdit} Мастер-пароль</span>
        <button class="sp-btn-secondary" id="sp-btn-toggle-change-pwd" style="padding:4px 8px; font-size:11px;">
          ${isChangePwdOpen ? 'Отмена' : 'Сменить'}
        </button>
      </div>
      <p class="sp-setting-desc">Смена главного пароля с перешифрованием всех баз данных.</p>

      ${
        isChangePwdOpen
          ? `
        <form id="sp-change-pwd-form" style="display:flex; flex-direction:column; gap:8px; margin-top:8px; padding:10px; background:var(--bg-surface); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
          <input type="password" id="sp-pwd-old" class="sp-input" placeholder="Текущий мастер-пароль" required />
          <input type="password" id="sp-pwd-new" class="sp-input" placeholder="Новый пароль (более 8 симв. + спецсимвол)" required />
          <input type="password" id="sp-pwd-new2" class="sp-input" placeholder="Повторите новый пароль" required />
          <div id="sp-change-pwd-err" style="display:none; font-size:11px; color:var(--danger);"></div>
          <button type="submit" class="sp-btn-primary" style="justify-content:center; padding:6px 12px; margin-top:4px;">
            Сохранить новый пароль
          </button>
        </form>
      `
          : ''
      }
    </div>

    <div class="sp-setting-row" data-search="заблокировать блокировка выйти заморозить">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iLock} Блокировка хранилища</span>
        <button class="sp-btn-danger" id="sp-btn-lock-now" style="padding:4px 10px; font-size:11px;">
          Заблокировать сейчас
        </button>
      </div>
      <p class="sp-setting-desc">Мгновенный сброс активной сессии и возврат к экрану ввода пароля.</p>
    </div>
  `;

  // 2. Accordion: Databases & Storage
  const activeProj = getActiveProject();
  const hostConnected = !!(state.passHostStatus && state.passHostStatus.ok);

  const dbHtml = `
    <div class="sp-setting-row" data-search="база данных проект хранилище active project pass">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iFolder} Текущая база (Проект)</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="sp-badge-info">${activeProj ? activeProj.name : '—'}</span>
          ${activeProj && activeProj.type === 'pass_cli' ? '<span class="sp-badge-pass">PASS CLI</span>' : '<span class="sp-badge-browser">Браузер</span>'}
        </div>
      </div>
      <p class="sp-setting-desc">Всего создано баз: ${state.projects.length} шт. Паролей в текущей: ${getActiveProjectItems().length} шт.</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-open-switcher" style="width:100%; justify-content:center;">
          ${icons.iFolder} Управление базами в футере
        </button>
      </div>
    </div>

    <div class="sp-setting-row" data-search="хранилище тип локальное браузер pass cli синхронизация gpg native">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iShield} Интеграция с UNIX PASS CLI</span>
        <span style="font-size:11px; font-weight:600; color:${hostConnected ? 'var(--success)' : '#f59e0b'};">
          ${hostConnected ? `✓ Подключен (v${state.passHostStatus.version})` : '⚠ Native Host не обнаружен'}
        </span>
      </div>
      <p class="sp-setting-desc">
        Хранение паролей в локальной файловой системе (<code>~/.password-store</code>) с общим доступом из разных браузеров и консоли.
      </p>

      <div class="sp-host-status-box">
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">Каталог хранилища:</span>
          <span><code>${state.passHostStatus?.storePath || '~/.password-store'}</code></span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">Утилита pass:</span>
          <span style="color:${state.passHostStatus?.passInstalled ? 'var(--success)' : 'var(--danger)'};">
            ${state.passHostStatus?.passInstalled ? '✓ Установлена' : '✗ Не найдена'}
          </span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">Утилита GPG:</span>
          <span style="color:${state.passHostStatus?.gpgInstalled ? 'var(--success)' : 'var(--danger)'};">
            ${state.passHostStatus?.gpgInstalled ? '✓ Установлена' : '✗ Не найдена'}
          </span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">Записей в PASS:</span>
          <span style="font-weight:600;">${state.passHostStatus?.entriesCount ?? 0} шт.</span>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="sp-btn-secondary" id="sp-btn-check-pass-host" style="flex:1; justify-content:center; font-size:11px; padding:6px 8px;">
          ${icons.iRefresh} Проверить статус
        </button>
        <button class="sp-btn-secondary" id="sp-btn-show-pass-instructions" style="flex:1; justify-content:center; font-size:11px; padding:6px 8px;">
          Инструкция
        </button>
      </div>

      ${
        activeProj && activeProj.type === 'pass_cli'
          ? `
        <button class="sp-btn-primary" id="sp-btn-sync-active-pass" style="width:100%; justify-content:center; font-size:11px; padding:7px 10px; margin-top:4px;">
          ${icons.iRefresh} Синхронизировать активную базу с ~/.password-store
        </button>
      `
          : ''
      }
    </div>
  `;

  // 3. Accordion: Categories Management
  const catItems = state.categories.filter(c => c !== 'All');
  const catListHtml = catItems.map(c => {
    const isDefault = c === 'Work' || c === 'Personal';
    return `
      <div class="sp-cat-item ${isDefault ? 'default' : ''}">
        <span>${c} ${isDefault ? '<span style="font-size:10px; color:var(--text-dim);">(базовая)</span>' : ''}</span>
        ${!isDefault ? `<button type="button" class="sp-cat-del-btn" data-cat="${c}" title="Удалить категорию">${icons.iTrash}</button>` : ''}
      </div>
    `;
  }).join('');

  const catHtml = `
    <div class="sp-setting-row" data-search="категории папки управление добавить категории work personal">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iFolder} Категории записей</span>
        <span class="sp-badge-info">${catItems.length} шт.</span>
      </div>
      <p class="sp-setting-desc">По умолчанию создаются только «Work» и «Personal». Вы можете добавить любые свои категории.</p>

      <div class="sp-cat-list">
        ${catListHtml}
      </div>

      <div style="display:flex; gap:6px; margin-top:10px;">
        <input type="text" id="sp-new-cat-name" class="sp-input" placeholder="Название новой категории..." style="flex:1;" />
        <button type="button" class="sp-btn-primary" id="sp-btn-add-cat" style="white-space:nowrap; padding:6px 12px; font-size:12px;">
          ${icons.iPlus} Добавить
        </button>
      </div>
      <div id="sp-cat-err" style="display:none; font-size:11px; color:var(--danger); margin-top:4px;"></div>
    </div>
  `;

  // 4. Accordion: Backup & Data Transfer
  const backupHtml = `
    <div class="sp-setting-row" data-search="экспорт бэкап json резервная копия скачать">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iDownload} Зашифрованный JSON бэкап</span>
      </div>
      <p class="sp-setting-desc">Полный снимок всех ваших баз и паролей в зашифрованном виде (AES-256-GCM).</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-export-json" style="width:100%; justify-content:center;">
          ${icons.iDownload} Экспортировать JSON
        </button>
      </div>
    </div>

    <div class="sp-setting-row" data-search="экспорт pass unix password store txt текст">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iDownload} Экспорт в формат UNIX pass</span>
      </div>
      <p class="sp-setting-desc">Выгрузка активной базы в стандартный текстовый формат менеджера PASS.</p>
      <div class="sp-setting-control">
        <button class="sp-btn-secondary" id="sp-btn-export-pass" style="width:100%; justify-content:center;">
          ${icons.iDownload} Экспортировать формат PASS (.txt)
        </button>
      </div>
    </div>

    <div class="sp-setting-row" data-search="импорт восстановить загрузить файл backup">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iUpload} Импорт данных</span>
      </div>
      <p class="sp-setting-desc">Восстановление из ранее сохраненного зашифрованного файла JSON.</p>
      <div class="sp-setting-control">
        <input type="file" id="sp-import-file-input" style="display:none;" accept=".json,.txt" />
        <button class="sp-btn-secondary" id="sp-btn-trigger-import" style="width:100%; justify-content:center;">
          ${icons.iUpload} Выбрать файл для импорта
        </button>
      </div>
    </div>
  `;

  // 4. Accordion: About & Reset
  const aboutHtml = `
    <div class="sp-setting-row" data-search="версия simplepass лицензия open source mit инфо">
      <div class="sp-setting-header">
        <span class="sp-setting-label">SimplePass Manager</span>
        <span class="sp-badge-info">v1.0.0</span>
      </div>
      <p class="sp-setting-desc">
        Открытый менеджер паролей с нулевым разглашением (Zero-Knowledge). Пароли не отправляются на сторонние серверы.
      </p>
    </div>

    <div class="sp-setting-row" data-search="шифрование криптография алгоритм aes pbkdf2">
      <div class="sp-setting-header">
        <span class="sp-setting-label">${icons.iShield} Спецификация шифрования</span>
      </div>
      <p class="sp-setting-desc" style="font-family:monospace; font-size:10px; line-height:1.5;">
        Алгоритм: AES-256-GCM (12-byte random IV)<br>
        Деривация: PBKDF2 (SHA-256, 600 000 раундов)<br>
        Стандарт: W3C Web Cryptography API
      </p>
    </div>

    <div class="sp-setting-row" data-search="сброс удалить все данные стереть очистить">
      <div class="sp-setting-header">
        <span class="sp-setting-label" style="color:var(--danger);">${icons.iTrash} Полный сброс хранилища</span>
      </div>
      <p class="sp-setting-desc">Удалит все созданные базы, настройки и пароли из браузера.</p>
      <div class="sp-setting-control">
        <button class="sp-btn-danger" id="sp-btn-reset-all" style="width:100%; justify-content:center;">
          Удалить все данные
        </button>
      </div>
    </div>
  `;

  const sections = [
    {
      id: 'security',
      title: 'Безопасность и Сессия',
      icon: icons.iShield,
      content: secHtml,
      keywords: 'пароль сессия 3 дня тайм-аут блокировка безопасность смена'
    },
    {
      id: 'databases',
      title: 'Базы данных и Проекты',
      icon: icons.iFolder,
      content: dbHtml,
      keywords: 'база проект хранилище список pass'
    },
    {
      id: 'categories',
      title: 'Управление категориями',
      icon: icons.iFolder,
      content: catHtml,
      keywords: 'категории папки work personal создать добавить'
    },
    {
      id: 'backup',
      title: 'Резервное копирование и Экспорт',
      icon: icons.iDownload,
      content: backupHtml,
      keywords: 'бэкап экспорт импорт json pass txt'
    },
    {
      id: 'about',
      title: 'О программе и Лицензия',
      icon: icons.iGlobe,
      content: aboutHtml,
      keywords: 'версия лицензия шифрование сброс о программе mit'
    }
  ];

  // Filter sections by search query
  const filteredSections = sections.filter(s => {
    if (!query) return true;
    return (
      s.title.toLowerCase().includes(query) ||
      s.keywords.toLowerCase().includes(query) ||
      s.content.toLowerCase().includes(query)
    );
  });

  const accordionsHtml = filteredSections.length
    ? filteredSections
        .map(s => {
          const isOpen = query ? true : openAccordions.has(s.id);
          return `
        <div class="sp-accordion ${isOpen ? 'open' : ''}" data-accordion-id="${s.id}">
          <button type="button" class="sp-accordion-header" data-action="toggle-accordion" data-accordion-id="${s.id}">
            <div class="sp-accordion-title-wrap">
              ${s.icon}
              <span>${s.title}</span>
            </div>
            <span class="sp-accordion-icon">▾</span>
          </button>
          <div class="sp-accordion-body">
            ${s.content}
          </div>
        </div>
      `;
        })
        .join('')
    : `
      <div class="sp-empty-state" style="height: 180px;">
        <div class="sp-empty-icon">${icons.iSearch}</div>
        <p style="font-size: 13px; font-weight: 600;">Настройки не найдены</p>
        <p style="font-size: 11px;">По запросу «${settingsSearchQuery}» ничего не найдено</p>
      </div>
    `;

  return `
    <div style="display:flex; flex-direction:column; height:100%; overflow:hidden;">
      <!-- Settings Header Search Bar (mySmart Style) -->
      <div class="sp-search-bar" style="padding: 10px 14px 6px;">
        <div class="sp-search-input-wrap">
          <span class="sp-search-icon">${icons.iSearch}</span>
          <input type="text" id="sp-settings-search" class="sp-search-input" placeholder="Поиск настроек (безопасность, сессия, экспорт)..." value="${settingsSearchQuery}" />
          ${settingsSearchQuery ? `<button class="sp-search-clear" id="sp-settings-search-clear">${icons.iX}</button>` : ''}
        </div>
      </div>

      <div class="sp-settings-container">
        ${accordionsHtml}
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
      showToast('12 слов скопированы в буфер');
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
    closeProjectPanelBtn.addEventListener('click', () => {
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

  const filterDomainBtn = document.getElementById('sp-filter-domain');
  if (filterDomainBtn) {
    filterDomainBtn.addEventListener('click', () => {
      updateState({ searchQuery: activeTabDomain });
    });
  }

  // Card clicks
  document.querySelectorAll('.sp-card').forEach(card => {
    const id = card.dataset.id;
    const item = state.items.find(i => i.id === id);

    card.querySelector('[data-action="view"]')?.addEventListener('click', () => {
      updateState({ activeTab: 'item-details', selectedItem: item });
    });

    card.querySelector('[data-action="share"]')?.addEventListener('click', e => {
      e.stopPropagation();
      openSendTunnelModal(item);
    });

    card.querySelector('[data-action="autofill"]')?.addEventListener('click', e => {
      e.stopPropagation();
      triggerAutofill(item);
    });

    card.querySelector('[data-action="copy-user"]')?.addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(item.username);
      showToast('Логин скопирован');
    });

    card.querySelector('[data-action="copy-pwd"]')?.addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(item.password);
      showToast('Пароль скопирован');
    });
  });

  // Header receive tunnel button
  const btnReceiveTunnel = document.getElementById('sp-btn-open-tunnel-receive');
  if (btnReceiveTunnel) {
    btnReceiveTunnel.addEventListener('click', () => {
      openReceiveTunnelModal();
    });
  }

  // Item form back & delete
  const btnBack = document.getElementById('sp-form-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      updateState({ activeTab: 'vault', selectedItem: null });
    });
  }

  const btnFormShare = document.getElementById('sp-form-share');
  if (btnFormShare && state.selectedItem) {
    btnFormShare.addEventListener('click', () => {
      openSendTunnelModal(state.selectedItem);
    });
  }

  const btnDelete = document.getElementById('sp-form-delete');
  if (btnDelete && state.selectedItem) {
    btnDelete.addEventListener('click', () => {
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
      }
    });
  }

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
        updateState({ activeTab: 'vault', selectedItem: null });
      } catch (err) {
        alert('Ошибка импорта CSV: ' + err.message);
      }
    });
  }

  const itemForm = document.getElementById('sp-item-form');
  if (itemForm) {
    itemForm.addEventListener('submit', e => {
      e.preventDefault();
      saveItem({
        id: document.getElementById('sp-item-id').value,
        projectId: document.getElementById('sp-item-project').value,
        title: document.getElementById('sp-item-title').value.trim(),
        url: document.getElementById('sp-item-url').value.trim(),
        username: document.getElementById('sp-item-username').value.trim(),
        password: document.getElementById('sp-item-password').value,
        category: document.getElementById('sp-item-category').value,
        notes: document.getElementById('sp-item-notes').value.trim()
      });
    });
  }

  // ─── Generator Tab controls (Smooth 60fps Interactive Live-Update) ───
  function updateGeneratorLiveUI() {
    currentGeneratedPassword = generatePassword(genOptions);
    const disp = document.getElementById('sp-gen-display');
    if (disp) disp.innerText = currentGeneratedPassword;
    const lenVal = document.getElementById('sp-length-val');
    if (lenVal) lenVal.innerText = genOptions.length;
    const strength = evaluatePasswordStrength(currentGeneratedPassword);
    const bar = document.querySelector('.sp-strength-bar');
    if (bar) {
      bar.style.width = `${strength.score}%`;
      bar.style.backgroundColor = strength.color;
    }
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
  const btnGenUse = document.getElementById('sp-gen-use-btn');
  [btnGenCopy, btnGenUse].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        copyToClipboard(currentGeneratedPassword);
        showToast('Пароль скопирован в буфер');
      });
    }
  });

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

  document.querySelectorAll('[data-action="toggle-accordion"]').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.accordionId;
      if (openAccordions.has(id)) {
        openAccordions.delete(id);
      } else {
        openAccordions.add(id);
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
    });

    customLockSelect.querySelectorAll('.sp-custom-select-option').forEach(opt => {
      opt.addEventListener('click', async e => {
        e.stopPropagation();
        const val = opt.dataset.val;
        state.lockInterval = val;
        isCustomSelectOpen = false;
        const cfg = await getStoredConfig();
        await saveStoredConfig({ ...cfg, lockInterval: val });
        if (state.masterPassword) {
          const session = await createSession(state.masterPassword, val);
          updateState({ sessionExpiresAt: session.expiresAt });
        }
        showToast('Периодичность проверки обновлена');
        render();
      });
    });
  }

  // Category Management Handlers in Settings
  const btnAddCat = document.getElementById('sp-btn-add-cat');
  const newCatInput = document.getElementById('sp-new-cat-name');
  const catErr = document.getElementById('sp-cat-err');
  if (btnAddCat && newCatInput) {
    btnAddCat.addEventListener('click', async () => {
      const name = newCatInput.value.trim();
      if (!name) return;
      if (state.categories.some(c => c.toLowerCase() === name.toLowerCase())) {
        if (catErr) {
          catErr.innerText = 'Категория с таким именем уже существует';
          catErr.style.display = 'block';
        }
        return;
      }
      state.categories.push(name);
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All')
      });
      showToast(`Категория «${name}» добавлена`);
      render();
    });
  }

  document.querySelectorAll('.sp-cat-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const catToDelete = btn.dataset.cat;
      if (catToDelete === 'Work' || catToDelete === 'Personal') return;
      state.categories = state.categories.filter(c => c !== catToDelete);
      state.items = state.items.map(it => {
        if (it.category === catToDelete) {
          return { ...it, category: 'Work' };
        }
        return it;
      });
      await persistVaultChanges();
      const cfg = await getStoredConfig();
      await saveStoredConfig({
        ...cfg,
        categories: state.categories.filter(c => c !== 'All')
      });
      showToast(`Категория «${catToDelete}» удалена`);
      render();
    });
  });

  // ─── E2EE Tunnel Send Modal Listeners (Side A) ───
  const sendTunnelCloseBtn = document.getElementById('sp-send-tunnel-close');
  const sendTunnelOverlay = document.getElementById('sp-send-tunnel-overlay');
  const btnCloseSendTunnel = document.getElementById('sp-btn-close-send-tunnel');

  [sendTunnelCloseBtn, sendTunnelOverlay, btnCloseSendTunnel].forEach(el => {
    if (el) {
      el.addEventListener('click', e => {
        if (e.target === el) closeSendTunnelModal();
      });
    }
  });

  const btnConnectAndEncrypt = document.getElementById('sp-btn-connect-and-encrypt');
  if (btnConnectAndEncrypt && sendTunnelModalState.item) {
    btnConnectAndEncrypt.addEventListener('click', async () => {
      const rawInput = document.getElementById('sp-send-peer-key-input')?.value.trim();
      if (!rawInput) {
        sendTunnelModalState.error = 'Вставьте код или ссылку туннеля принимающей стороны';
        render();
        return;
      }

      let peerPublicKey = rawInput;
      if (rawInput.startsWith('SPTUN_KEY:')) {
        peerPublicKey = rawInput.slice(10).trim();
      }

      try {
        const { tunnelPacket } = await encryptTunnelPayload(sendTunnelModalState.item, peerPublicKey);
        sendTunnelModalState.peerPublicKey = peerPublicKey;
        sendTunnelModalState.encryptedPacket = tunnelPacket;
        sendTunnelModalState.status = 'ready_to_send';
        sendTunnelModalState.error = '';
        render();
      } catch (err) {
        sendTunnelModalState.error = 'Не удалось подключиться к туннелю: ' + err.message;
        render();
      }
    });
  }

  const btnCopyTunnelPacket = document.getElementById('sp-btn-copy-tunnel-packet');
  if (btnCopyTunnelPacket && sendTunnelModalState.encryptedPacket) {
    btnCopyTunnelPacket.addEventListener('click', () => {
      copyToClipboard(sendTunnelModalState.encryptedPacket);
      showToast('Зашифрованный пакет скопирован');
    });
  }

  // ─── E2EE Tunnel Receive Modal Listeners (Side B) ───
  const receiveTunnelCloseBtn = document.getElementById('sp-receive-tunnel-close');
  const receiveTunnelOverlay = document.getElementById('sp-receive-tunnel-overlay');
  const btnFinishTunnel = document.getElementById('sp-btn-finish-tunnel');

  [receiveTunnelCloseBtn, receiveTunnelOverlay, btnFinishTunnel].forEach(el => {
    if (el) {
      el.addEventListener('click', e => {
        if (e.target === el) closeReceiveTunnelModal();
      });
    }
  });

  const btnCopyTunnelToken = document.getElementById('sp-btn-copy-tunnel-token');
  if (btnCopyTunnelToken && receiveTunnelModalState.tunnelToken) {
    btnCopyTunnelToken.addEventListener('click', () => {
      copyToClipboard(receiveTunnelModalState.tunnelToken);
      showToast('Код туннеля скопирован в буфер');
    });
  }

  const btnDecryptTunnelPacket = document.getElementById('sp-btn-decrypt-tunnel-packet');
  if (btnDecryptTunnelPacket && receiveTunnelModalState.keyPair) {
    btnDecryptTunnelPacket.addEventListener('click', async () => {
      const rawPacket = document.getElementById('sp-receive-packet-input')?.value.trim();
      if (!rawPacket) {
        receiveTunnelModalState.error = 'Вставьте полученный зашифрованный пакет из туннеля';
        render();
        return;
      }

      try {
        const decrypted = await decryptTunnelPayload(rawPacket, receiveTunnelModalState.keyPair.privateKey);
        receiveTunnelModalState.decryptedItem = decrypted;
        receiveTunnelModalState.status = 'received';
        receiveTunnelModalState.error = '';
        render();
      } catch (err) {
        receiveTunnelModalState.error = 'Ошибка расшифровки туннеля: ' + err.message;
        render();
      }
    });
  }

  const btnCopyTunnelPwd = document.getElementById('sp-btn-copy-tunnel-pwd');
  if (btnCopyTunnelPwd && receiveTunnelModalState.decryptedItem) {
    btnCopyTunnelPwd.addEventListener('click', () => {
      copyToClipboard(receiveTunnelModalState.decryptedItem.password);
      showToast('Пароль скопирован в буфер');
    });
  }

  const btnSaveTunnelItem = document.getElementById('sp-btn-save-tunnel-item');
  if (btnSaveTunnelItem && receiveTunnelModalState.decryptedItem) {
    btnSaveTunnelItem.addEventListener('click', async () => {
      const activeProj = getActiveProject();
      const itemToSave = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        projectId: activeProj ? activeProj.id : 'proj_default',
        title: receiveTunnelModalState.decryptedItem.title || 'Полученный пароль',
        username: receiveTunnelModalState.decryptedItem.username || '',
        password: receiveTunnelModalState.decryptedItem.password || '',
        url: receiveTunnelModalState.decryptedItem.url || '',
        notes: receiveTunnelModalState.decryptedItem.notes || '',
        category: 'Work',
        updatedAt: new Date().toISOString()
      };
      state.items.push(itemToSave);
      await persistVaultChanges();
      closeReceiveTunnelModal();
      showToast(`Пароль сохранён в «${activeProj ? activeProj.name : 'базу'}»!`);
    });
  }

  const btnToggleChangePwd = document.getElementById('sp-btn-toggle-change-pwd');
  if (btnToggleChangePwd) {
    btnToggleChangePwd.addEventListener('click', () => {
      isChangePwdOpen = !isChangePwdOpen;
      render();
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

      if (oldPwd !== state.masterPassword) {
        if (errBox) {
          errBox.innerText = 'Неверный текущий мастер-пароль';
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
          errBox.innerText = 'Введенные новые пароли не совпадают';
          errBox.style.display = 'block';
        }
        return;
      }

      try {
        state.masterPassword = newPwd;
        await persistVaultChanges();
        const session = await createSession(newPwd, state.lockInterval || '3days');
        isChangePwdOpen = false;
        updateState({
          masterPassword: newPwd,
          sessionExpiresAt: session.expiresAt
        });
        showToast('Мастер-пароль успешно изменён');
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

  const btnExportJson = document.getElementById('sp-btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', async () => {
      const envelope = await getStoredVault();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simplepass-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const btnExportPass = document.getElementById('sp-btn-export-pass');
  if (btnExportPass) {
    btnExportPass.addEventListener('click', () => {
      let combined = '';
      const activeProj = getActiveProject();
      const projectItems = getActiveProjectItems();
      projectItems.forEach(item => {
        combined += `=== ${activeProj.name}/${item.category}/${item.title} ===\n${itemToPassFormat(item)}\n\n`;
      });
      const blob = new Blob([combined], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simplepass-${activeProj.name}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const btnTriggerImport = document.getElementById('sp-btn-trigger-import');
  const importFileInput = document.getElementById('sp-import-file-input');
  if (btnTriggerImport && importFileInput) {
    btnTriggerImport.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async evt => {
        try {
          const content = evt.target.result;
          if (file.name.endsWith('.json')) {
            const parsed = JSON.parse(content);
            if (parsed.iv && parsed.salt && parsed.ciphertext) {
              const decrypted = await decryptVault(parsed, state.masterPassword);
              const normalized = normalizeVaultData(decrypted);
              updateState({
                projects: normalized.projects,
                items: normalized.items
              });
              await persistVaultChanges();
              showToast('Импорт зашифрованного JSON выполнен');
            } else if (parsed.projects && parsed.items) {
              const normalized = normalizeVaultData(parsed);
              updateState({
                projects: normalized.projects,
                items: normalized.items
              });
              await persistVaultChanges();
              showToast('Импорт данных выполнен');
            } else {
              alert('Неверный формат JSON файла');
            }
          } else {
            alert('Поддерживаются только .json файлы');
          }
        } catch (err) {
          alert('Ошибка при импорте: ' + err.message);
        }
      };
      reader.readAsText(file);
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
