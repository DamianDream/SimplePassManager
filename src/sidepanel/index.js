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
import { encryptVault, decryptVault } from '../core/crypto.js';
import {
  getStoredVault,
  saveStoredVault,
  getStoredConfig,
  saveStoredConfig,
  clearStoredVault,
  normalizeVaultData,
  itemToPassFormat,
  passFormatToItem
} from '../core/storage.js';
import { createSession, restoreSession, destroySession } from '../core/session.js';
import { generatePassword, evaluatePasswordStrength } from '../core/generator.js';
import * as icons from '../icons/icons.js';

const rootEl = document.getElementById('sp-app-root');

// Active tab information (queried on launch)
let activeTabDomain = '';
let activeTabId = null;

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

  updateState({
    isInitialized: storedVault !== null,
    lockInterval: storedConfig.lockInterval || '3days'
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

  subscribe(() => render());
  render();
}

// ─── VAULT ACTIONS ────────────────────────────────────────────────────────────

async function handleUnlock(password) {
  try {
    const envelope = await getStoredVault();
    const decrypted = await decryptVault(envelope, password);
    const normalized = normalizeVaultData(decrypted);
    const storedConfig = await getStoredConfig();

    const initialProjectId =
      storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
        ? storedConfig.latestProjectId
        : normalized.projects[0].id;

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
    alert('Неверный мастер-пароль или хранилище повреждено.');
  }
}

async function handleCreateVault(projectName, password, confirmPassword) {
  if (!password || password.length < 8) {
    alert('Мастер-пароль должен быть длиной не менее 8 символов.');
    return;
  }
  if (password !== confirmPassword) {
    alert('Пароли не совпадают.');
    return;
  }

  const projId = 'proj_' + Date.now();
  const now = new Date().toISOString();

  const initialProject = {
    id: projId,
    name: projectName.trim() || 'Основной',
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

  const encrypted = await encryptVault(initialData, password);
  await saveStoredVault(encrypted);
  await saveStoredConfig({
    activeProjectId: projId,
    latestProjectId: projId,
    lockInterval: '3days'
  });

  const session = await createSession(password, '3days');

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

  const existingIdx = state.items.findIndex(i => i.id === itemData.id);
  let updatedItems = [...state.items];

  if (existingIdx >= 0) {
    updatedItems[existingIdx] = {
      ...itemData,
      projectId,
      updatedAt: new Date().toISOString()
    };
  } else {
    updatedItems.unshift({
      ...itemData,
      id: 'item_' + Date.now(),
      projectId,
      updatedAt: new Date().toISOString()
    });
  }

  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();
}

async function deleteItem(id) {
  if (!confirm('Вы уверены, что хотите удалить этот пароль?')) return;
  const updatedItems = state.items.filter(i => i.id !== id);
  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();
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
      background: #06b6d4; color: #fff; font-size: 12px; font-weight: 600;
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

  const activeProj = getActiveProject();
  const activeItems = getActiveProjectItems();

  rootEl.innerHTML = `
    <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <!-- Header -->
      <header class="sp-header">
        <div class="sp-brand">
          <div class="sp-brand-icon"><img src="icons/icon-32.png" style="width:24px;height:24px;border-radius:6px;display:block;" alt="Logo" /></div>
          <span>SimplePass</span>
        </div>
        <div class="sp-header-actions">
          <button class="sp-btn-icon" id="sp-btn-add" title="Добавить пароль">${icons.iPlus}</button>
          <button class="sp-btn-icon" id="sp-btn-lock" title="Заблокировать">${icons.iLock}</button>
        </div>
      </header>

      <!-- Nav Tabs -->
      <nav class="sp-nav">
        <button class="sp-nav-tab ${state.activeTab === 'vault' ? 'active' : ''}" data-tab="vault">
          ${icons.iKey} <span>Пароли (${activeItems.length})</span>
        </button>
        <button class="sp-nav-tab ${state.activeTab === 'generator' ? 'active' : ''}" data-tab="generator">
          ${icons.iDice} <span>Генератор</span>
        </button>
        <button class="sp-nav-tab ${state.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
          ${icons.iSettings} <span>Настройки</span>
        </button>
      </nav>

      <!-- Tab View Container -->
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
    </div>
  `;

  attachEventHandlers();
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
          <h2 class="sp-auth-title">Создание хранилища</h2>
          <p class="sp-auth-desc">Задайте имя первой базы данных и мастер-пароль для шифрования AES-256-GCM.</p>
          <form class="sp-auth-form" id="sp-init-form">
            <input type="text" id="sp-init-proj-name" class="sp-input" placeholder="Название базы (например: Основной)" value="Основной" required />
            <input type="password" id="sp-init-pwd" class="sp-input" placeholder="Мастер-пароль (от 8 симв.)" required />
            <input type="password" id="sp-init-pwd2" class="sp-input" placeholder="Повторите мастер-пароль" required />
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              Создать хранилище
            </button>
          </form>
        </div>
      </div>
    `;
    document.getElementById('sp-init-form').addEventListener('submit', e => {
      e.preventDefault();
      const proj = document.getElementById('sp-init-proj-name').value;
      const p1 = document.getElementById('sp-init-pwd').value;
      const p2 = document.getElementById('sp-init-pwd2').value;
      handleCreateVault(proj, p1, p2);
    });
    return;
  }

  rootEl.innerHTML = `
    <div class="sp-auth-screen">
      <div class="sp-auth-box">
        <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;border-radius:12px;display:block;" alt="Logo" /></div>
        <h2 class="sp-auth-title">SimplePass заблокирован</h2>
        <p class="sp-auth-desc">Введите мастер-пароль для разблокировки записей</p>
        <form class="sp-auth-form" id="sp-unlock-form">
          <input type="password" id="sp-unlock-pwd" class="sp-input" placeholder="Мастер-пароль" autofocus required />
          <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
            ${icons.iUnlock} Разблокировать
          </button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('sp-unlock-form').addEventListener('submit', e => {
    e.preventDefault();
    const p = document.getElementById('sp-unlock-pwd').value;
    handleUnlock(p);
  });
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
        <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid var(--accent); padding: 6px 12px; margin: 8px 14px 0; border-radius: 8px; font-size: 11px; display: flex; align-items: center; justify-content: space-between;">
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
      return `
      <div class="sp-project-item ${isActive ? 'active' : ''}" data-project-id="${p.id}">
        <div class="sp-project-item-left" data-action="select-project" data-project-id="${p.id}">
          <div class="sp-radio-indicator"></div>
          <div class="sp-project-info">
            <span class="sp-project-name">${p.name}</span>
            <span class="sp-project-meta">${count} паролей • ${p.type === 'browser' ? 'Браузер' : 'PASS CLI'}</span>
          </div>
        </div>
        <div class="sp-project-item-actions">
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
        <form id="sp-create-project-form" style="display:flex; gap:8px;">
          <input type="text" id="sp-new-project-name" class="sp-input" placeholder="Название базы (напр. Work)" required style="flex:1;" />
          <button type="submit" class="sp-btn-primary" style="padding:8px 12px; white-space:nowrap;">
            ${icons.iPlus} Создать
          </button>
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
    category: 'General',
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
        ${!isNew ? `<button class="sp-btn-danger" id="sp-form-delete" style="padding:6px 10px;">${icons.iTrash}</button>` : '<div></div>'}
      </div>

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
              .map(c => `<option value="${c}" ${item.category === c ? 'selected' : ''}>${c}</option>`)
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

      <div style="display:flex; flex-direction:column; gap:12px;">
        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between;">
            <label class="sp-label">Длина пароля</label>
            <span style="font-size:12px; font-weight:700; color:var(--accent);" id="sp-length-val">${genOptions.length}</span>
          </div>
          <input type="range" id="sp-slider-len" min="8" max="64" value="${genOptions.length}" style="width:100%; accent-color:var(--accent);" />
        </div>

        <label class="sp-checkbox-row">
          <span>Прописные буквы (A-Z)</span>
          <input type="checkbox" id="sp-chk-upper" ${genOptions.useUpper ? 'checked' : ''} />
        </label>
        <label class="sp-checkbox-row">
          <span>Строчные буквы (a-z)</span>
          <input type="checkbox" id="sp-chk-lower" ${genOptions.useLower ? 'checked' : ''} />
        </label>
        <label class="sp-checkbox-row">
          <span>Цифры (0-9)</span>
          <input type="checkbox" id="sp-chk-digits" ${genOptions.useDigits ? 'checked' : ''} />
        </label>
        <label class="sp-checkbox-row">
          <span>Спецсимволы (!@#$%^&*)</span>
          <input type="checkbox" id="sp-chk-symbols" ${genOptions.useSymbols ? 'checked' : ''} />
        </label>
        <label class="sp-checkbox-row">
          <span>Исключить неоднозначные (0, O, 1, l)</span>
          <input type="checkbox" id="sp-chk-ambig" ${genOptions.avoidAmbiguous ? 'checked' : ''} />
        </label>
      </div>

      <button class="sp-btn-primary" id="sp-gen-use-btn" style="justify-content:center; margin-top:10px;">
        ${icons.iCopy} Скопировать пароль
      </button>
    </div>
  `;
}

// ─── SETTINGS VIEW (PLACEHOLDER FOR STEP 3) ──────────────────────────────────

function renderSettingsView() {
  return `
    <div class="sp-view-container">
      <h3 style="font-size:14px; font-weight:700;">Настройки SimplePass</h3>
      <p style="font-size:12px; color:var(--text-muted);">
        В Шаге 3 здесь будет развернута структурированная панель настроек с поиском и аккордеонами.
      </p>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
        <button class="sp-btn-secondary" id="sp-btn-export-json">
          ${icons.iDownload} Экспорт зашифрованного бэкапа (JSON)
        </button>
        <button class="sp-btn-secondary" id="sp-btn-export-pass">
          ${icons.iDownload} Экспорт в формат UNIX pass
        </button>
      </div>

      <div style="margin-top:20px; padding:12px; background:var(--bg-card); border-radius:var(--radius-md); font-size:11px; color:var(--text-dim); line-height:1.5;">
        <strong style="color:var(--text-main);">SimplePass Manager v1.0.0</strong><br>
        Шифрование: AES-256-GCM + PBKDF2 (SHA-256, 600k rounds)<br>
        Периодичность проверки пароля: раз в 3 дня (по умолчанию).
      </div>
    </div>
  `;
}

// ─── EVENT ATTACHMENT ─────────────────────────────────────────────────────────

function attachEventHandlers() {
  // Navigation tabs
  document.querySelectorAll('.sp-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      updateState({ activeTab: target, selectedItem: null, isProjectSwitcherOpen: false });
    });
  });

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
      createProject(name, 'browser');
      await persistVaultChanges();
      showToast(`База «${name}» создана`);
    });
  }

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

  // Item form back & delete
  const btnBack = document.getElementById('sp-form-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      updateState({ activeTab: 'vault', selectedItem: null });
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

  // Generator Tab controls
  const sliderLen = document.getElementById('sp-slider-len');
  if (sliderLen) {
    sliderLen.addEventListener('input', e => {
      genOptions.length = parseInt(e.target.value, 10);
      document.getElementById('sp-length-val').innerText = genOptions.length;
      currentGeneratedPassword = generatePassword(genOptions);
      render();
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
        currentGeneratedPassword = generatePassword(genOptions);
        render();
      });
    }
  });

  const btnGenRefresh = document.getElementById('sp-gen-refresh');
  if (btnGenRefresh) {
    btnGenRefresh.addEventListener('click', () => {
      currentGeneratedPassword = generatePassword(genOptions);
      render();
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

  // Settings tab temporary exports
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
}

// Start
init();
