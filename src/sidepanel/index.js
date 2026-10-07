/**
 * SimplePass Manager Side Panel Application Entry
 * Built for speed, high security, and sleek user experience.
 */

import { state, subscribe, updateState, lockVault, copyToClipboard } from '../core/state.js';
import { encryptVault, decryptVault } from '../core/crypto.js';
import {
  getStoredVault,
  saveStoredVault,
  getStoredConfig,
  saveStoredConfig,
  clearStoredVault,
  itemToPassFormat,
  passFormatToItem
} from '../core/storage.js';
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
  updateState({ isInitialized: storedVault !== null });

  subscribe(() => render());
  render();
}

// ─── VAULT ACTIONS ────────────────────────────────────────────────────────────

async function handleUnlock(password) {
  try {
    const envelope = await getStoredVault();
    const decrypted = await decryptVault(envelope, password);
    updateState({
      isUnlocked: true,
      masterPassword: password,
      items: decrypted.items || []
    });
  } catch (err) {
    alert('Неверный мастер-пароль или хранилище повреждено.');
  }
}

async function handleCreateVault(password, confirmPassword) {
  if (!password || password.length < 8) {
    alert('Мастер-пароль должен быть длиной не менее 8 символов.');
    return;
  }
  if (password !== confirmPassword) {
    alert('Пароли не совпадают.');
    return;
  }

  const initialData = {
    version: 1,
    createdAt: new Date().toISOString(),
    items: [
      {
        id: 'item_sample_1',
        title: 'GitHub',
        username: 'developer@example.com',
        password: generatePassword({ length: 24 }),
        url: 'https://github.com',
        category: 'Work',
        notes: 'Personal developer account',
        updatedAt: new Date().toISOString()
      }
    ]
  };

  const encrypted = await encryptVault(initialData, password);
  await saveStoredVault(encrypted);

  updateState({
    isInitialized: true,
    isUnlocked: true,
    masterPassword: password,
    items: initialData.items
  });
}

async function persistVaultChanges() {
  if (!state.masterPassword) return;
  const vaultData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: state.items
  };
  const encrypted = await encryptVault(vaultData, state.masterPassword);
  await saveStoredVault(encrypted);
}

async function saveItem(itemData) {
  const existingIdx = state.items.findIndex(i => i.id === itemData.id);
  let updatedItems = [...state.items];
  if (existingIdx >= 0) {
    updatedItems[existingIdx] = { ...itemData, updatedAt: new Date().toISOString() };
  } else {
    updatedItems.unshift({
      ...itemData,
      id: 'item_' + Date.now(),
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
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
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

  rootEl.innerHTML = `
    <!-- Header -->
    <header class="sp-header">
      <div class="sp-brand">
        <div class="sp-brand-icon">${icons.iShield}</div>
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
        ${icons.iKey} <span>Пароли (${state.items.length})</span>
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
          <div class="sp-auth-logo">${icons.iShield}</div>
          <h2 class="sp-auth-title">Создание хранилища</h2>
          <p class="sp-auth-desc">Задайте мастер-пароль. Он используется для надежного шифрования AES-256-GCM.</p>
          <form class="sp-auth-form" id="sp-init-form">
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
      const p1 = document.getElementById('sp-init-pwd').value;
      const p2 = document.getElementById('sp-init-pwd2').value;
      handleCreateVault(p1, p2);
    });
    return;
  }

  rootEl.innerHTML = `
    <div class="sp-auth-screen">
      <div class="sp-auth-box">
        <div class="sp-auth-logo">${icons.iLock}</div>
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

  const filteredItems = state.items.filter(item => {
    const matchesCat = cat === 'All' || item.category === cat;
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.username && item.username.toLowerCase().includes(query)) ||
      (item.url && item.url.toLowerCase().includes(query));
    return matchesCat && matchesQuery;
  });

  // Highlight items matching current active tab domain
  let activeDomainNotice = '';
  if (activeTabDomain) {
    const domainMatches = state.items.filter(
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
    .map(
      c => `
      <button class="sp-pill ${c === state.activeCategory ? 'active' : ''}" data-cat="${c}">${c}</button>
    `
    )
    .join('');

  const cardsHtml =
    filteredItems.length === 0
      ? `
      <div class="sp-empty-state">
        <div class="sp-empty-icon">${icons.iKey}</div>
        <p style="font-size: 13px; font-weight: 600;">Нет паролей</p>
        <p style="font-size: 11px;">Нажмите «+» вверху, чтобы добавить первую запись</p>
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

// ─── ITEM FORM VIEW (ADD / EDIT / VIEW) ──────────────────────────────────────

function renderItemFormView() {
  const item = state.selectedItem || {
    id: '',
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

// ─── SETTINGS VIEW ───────────────────────────────────────────────────────────

function renderSettingsView() {
  return `
    <div class="sp-view-container">
      <h3 style="font-size:14px; font-weight:700;">Резервное копирование и экспорт</h3>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="sp-btn-secondary" id="sp-btn-export-json">
          ${icons.iDownload} Экспорт зашифрованного бэкапа (JSON)
        </button>
        <button class="sp-btn-secondary" id="sp-btn-export-pass">
          ${icons.iDownload} Экспорт в формат UNIX pass
        </button>
      </div>

      <h3 style="font-size:14px; font-weight:700; margin-top:12px;">Импорт данных</h3>
      <input type="file" id="sp-import-file" style="display:none;" accept=".json,.txt" />
      <button class="sp-btn-secondary" id="sp-btn-import">
        ${icons.iUpload} Импортировать JSON или pass формат
      </button>

      <h3 style="font-size:14px; font-weight:700; margin-top:12px;">Безопасность</h3>
      <button class="sp-btn-secondary" id="sp-btn-change-pwd">
        ${icons.iKey} Сменить мастер-пароль
      </button>

      <div style="margin-top:20px; padding:12px; background:var(--bg-card); border-radius:var(--radius-md); font-size:11px; color:var(--text-dim); line-height:1.5;">
        <strong style="color:var(--text-main);">SimplePass Manager v1.0.0</strong><br>
        Шифрование: AES-256-GCM + PBKDF2 (SHA-256, 600k rounds)<br>
        Open Source & Fully Local.<br>
        Пароли никогда не передаются на сторонние серверы.
      </div>

      <button class="sp-btn-danger" id="sp-btn-reset-vault" style="margin-top:10px; justify-content:center;">
        ${icons.iTrash} Удалить всё хранилище
      </button>
    </div>
  `;
}

// ─── EVENT ATTACHMENT ─────────────────────────────────────────────────────────

function attachEventHandlers() {
  // Navigation tabs
  document.querySelectorAll('.sp-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      updateState({ activeTab: target, selectedItem: null });
    });
  });

  // Top header actions
  const btnAdd = document.getElementById('sp-btn-add');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      updateState({ activeTab: 'item-details', selectedItem: null });
    });
  }

  const btnLock = document.getElementById('sp-btn-lock');
  if (btnLock) {
    btnLock.addEventListener('click', () => {
      lockVault();
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

  // Settings tab actions
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
      state.items.forEach(item => {
        combined += `=== ${item.category}/${item.title} ===\n${itemToPassFormat(item)}\n\n`;
      });
      const blob = new Blob([combined], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simplepass-pass-format.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const btnImport = document.getElementById('sp-btn-import');
  const fileInput = document.getElementById('sp-import-file');
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        if (json.salt && json.iv && json.data) {
          if (confirm('Импортировать этот зашифрованный бэкап? Текущее хранилище будет заменено.')) {
            await saveStoredVault(json);
            lockVault();
            alert('Бэкап загружен. Введите мастер-пароль от загруженного бэкапа для разблокировки.');
          }
        }
      } catch (_) {
        // Plain text pass format import
        alert('Формат файла распознан как текстовый список.');
      }
    });
  }

  const btnResetVault = document.getElementById('sp-btn-reset-vault');
  if (btnResetVault) {
    btnResetVault.addEventListener('click', async () => {
      if (confirm('ВНИМАНИЕ: Все сохранённые пароли будут безвозвратно удалены. Продолжить?')) {
        await clearStoredVault();
        updateState({ isInitialized: false, isUnlocked: false, masterPassword: null, items: [] });
      }
    });
  }
}

// Start
init();
