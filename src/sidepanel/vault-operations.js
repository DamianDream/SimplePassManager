/**
 * SimplePass Manager - Central Vault Operations & Persistence
 */

import { state, updateState, lockVault, getActiveProject } from '../core/state.js';
import { encryptVaultWithMek } from '../core/crypto.js';
import { saveStoredVault, getStoredConfig, saveStoredConfig } from '../core/storage.js';
import { t } from '../core/i18n.js';
import { panelState } from './panel-state.js';
import { showToast } from './render-utils.js';
import { extractCleanDomain } from '../core/domain.js';
import { resolveFavicon, getCachedFavicon } from '../core/favicon.js';
import { saveItemToPassCli, deleteItemFromPassCli, syncAllPassEntries } from '../core/pass-native.js';
import { requestPermission } from '../core/permissions.js';

let persistChain = Promise.resolve();

async function doPersistVaultChanges() {
  if (!state.rawMek || !state.keySlots) {
    showToast(t('toasts.session_invalid') || 'Session invalid or expired');
    await lockVault();
    return;
  }

  const isV3 = Boolean(state.keySlots && state.keySlots.keyByPassword && state.keySlots.keyByPassword.aad);
  const vaultData = {
    version: isV3 ? 3 : 2,
    updatedAt: new Date().toISOString(),
    projects: state.projects,
    items: state.items,
    trash: state.trash || []
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

export function persistVaultChanges() {
  persistChain = persistChain.then(() => doPersistVaultChanges()).catch(err => {
    console.error('persistVaultChanges failed:', err);
    showToast(t('toasts.save_failed') || 'Failed to save vault data');
    throw err;
  });
  return persistChain;
}

export async function saveItem(itemData, { renderApp } = {}) {
  const activeProj = getActiveProject();
  const projectId = itemData.projectId || (activeProj ? activeProj.id : 'proj_default');
  const proj = state.projects.find(p => p.id === projectId);

  const existingIdx = state.items.findIndex(i => i.id === itemData.id);
  let updatedItems = [...state.items];

  let passwordHistory = [];
  if (existingIdx >= 0) {
    const oldItem = state.items[existingIdx];
    passwordHistory = Array.isArray(oldItem.passwordHistory) ? [...oldItem.passwordHistory] : [];
    if (oldItem.password && itemData.password && oldItem.password !== itemData.password) {
      passwordHistory.unshift({
        password: oldItem.password,
        createdAt: oldItem.updatedAt || new Date().toISOString()
      });
      if (passwordHistory.length > 5) {
        passwordHistory = passwordHistory.slice(0, 5);
      }
    }
  } else if (Array.isArray(itemData.passwordHistory)) {
    passwordHistory = itemData.passwordHistory;
  }

  const domain = extractCleanDomain(itemData.url);
  const domainNoPort = domain ? domain.split(':')[0] : '';
  let favicon = itemData.favicon || '';
  if (!favicon && domain) {
    favicon =
      panelState.cachedFavicons[domain] ||
      panelState.cachedFavicons[domainNoPort] ||
      (await getCachedFavicon(domain)) ||
      (await getCachedFavicon(domainNoPort)) ||
      '';
  }

  let itemToSave = {
    ...itemData,
    passwordHistory,
    domain: domain || itemData.domain || '',
    favicon: favicon || (existingIdx >= 0 ? state.items[existingIdx].favicon : '') || '',
    projectId,
    updatedAt: new Date().toISOString()
  };

  if (itemToSave.domain && itemToSave.favicon) {
    panelState.cachedFavicons[itemToSave.domain] = itemToSave.favicon;
    if (domainNoPort) panelState.cachedFavicons[domainNoPort] = itemToSave.favicon;
  }

  if (existingIdx >= 0) {
    updatedItems[existingIdx] = itemToSave;
  } else {
    itemToSave.id = 'item_' + Date.now();
    updatedItems.unshift(itemToSave);
  }

  updateState({ items: updatedItems, activeTab: 'vault', selectedItem: null, isEditing: false });
  await persistVaultChanges();
  if (renderApp) renderApp();

  // If favicon wasn't cached yet, fetch in background and persist
  if (state.showFavicons && domain && !itemToSave.favicon) {
    resolveFavicon(itemData.url, {
      forceRefresh: false,
      activeTabFavIconUrl: panelState.activeTabFavicon,
      useExternalServices: state.useExternalIcons === true
    })
      .then(async res => {
        if (res && res.favicon) {
          panelState.cachedFavicons[domain] = res.favicon;
          if (domainNoPort) panelState.cachedFavicons[domainNoPort] = res.favicon;
          const idx = state.items.findIndex(i => i.id === itemToSave.id);
          if (idx >= 0) {
            state.items[idx].favicon = res.favicon;
            state.items[idx].domain = domain;
            await persistVaultChanges();
            if (renderApp) renderApp();
          }
        }
      })
      .catch(() => {});
  }

  if (proj && proj.type === 'pass_cli') {
    try {
      await saveItemToPassCli(itemToSave);
      showToast(t('toasts.pass_saved_sync'));
    } catch (err) {
      console.warn('PASS CLI sync error:', err);
      showToast(t('toasts.pass_saved') + ' (PASS: ' + err.message + ')');
    }
  } else {
    showToast(t('toasts.pass_saved'));
  }
}

export async function deleteItem(id, { renderApp } = {}) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const proj = state.projects.find(p => p.id === item.projectId);

  // Soft-delete to state.trash with deletedAt
  const trashItem = {
    ...item,
    deletedAt: new Date().toISOString()
  };
  const updatedTrash = [trashItem, ...(state.trash || [])];
  const updatedItems = state.items.filter(i => i.id !== id);

  updateState({
    items: updatedItems,
    trash: updatedTrash,
    activeTab: 'vault',
    selectedItem: null,
    isEditing: false
  });
  await persistVaultChanges();
  if (renderApp) renderApp();

  if (proj && proj.type === 'pass_cli' && item) {
    try {
      await deleteItemFromPassCli(item);
      showToast(t('toasts.pass_deleted_sync'));
    } catch (err) {
      console.warn('PASS CLI delete error:', err);
      showToast(t('trash.deleted_toast') || t('toasts.item_deleted'));
    }
  } else {
    showToast(t('trash.deleted_toast') || t('toasts.item_deleted'));
  }
}

export async function restoreTrashItem(id, { renderApp } = {}) {
  const item = (state.trash || []).find(i => i.id === id);
  if (!item) return;

  const { deletedAt, ...restoredItem } = item;
  restoredItem.updatedAt = new Date().toISOString();

  const updatedTrash = (state.trash || []).filter(i => i.id !== id);
  const updatedItems = [restoredItem, ...state.items];

  updateState({
    items: updatedItems,
    trash: updatedTrash
  });
  await persistVaultChanges();
  showToast(t('trash.restored_toast') || 'Restored from trash');
  if (renderApp) renderApp();
}

export async function permanentDeleteTrashItem(id, { renderApp } = {}) {
  if (!confirm(t('trash.delete_perm_confirm') || t('toasts.delete_confirm'))) return;
  const updatedTrash = (state.trash || []).filter(i => i.id !== id);
  updateState({ trash: updatedTrash });
  await persistVaultChanges();
  showToast(t('trash.perm_deleted_toast') || 'Item permanently deleted');
  if (renderApp) renderApp();
}

export async function emptyTrash({ renderApp } = {}) {
  if (!confirm(t('trash.empty_confirm') || 'Empty trash?')) return;
  updateState({ trash: [] });
  await persistVaultChanges();
  showToast(t('trash.emptied_toast') || 'Trash emptied');
  if (renderApp) renderApp();
}

export function downloadItemAsCsv(item, { renderApp } = {}) {
  if (!item) return;
  const safeName = (item.title || 'password').replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '_');
  panelState.exportModalData = {
    format: 'csv',
    items: [item],
    fileName: `password-${safeName}`
  };
  if (renderApp) renderApp();
}

export function syncCachedFaviconsFromItems(items) {
  if (!Array.isArray(items)) return;
  items.forEach(it => {
    if (it.domain && it.favicon) {
      panelState.cachedFavicons[it.domain] = it.favicon;
      const noPort = it.domain.split(':')[0];
      if (noPort !== it.domain) {
        panelState.cachedFavicons[noPort] = it.favicon;
      }
    }
  });
}

export function parseCsvFile(csvContent) {
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
    throw new Error(t('settings.csv_import_empty') || 'CSV file is empty');
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
    throw new Error(t('toasts.csv_header_err'));
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const password = colPass !== -1 ? (row[colPass] || '') : '';
    const title = colTitle !== -1 ? (row[colTitle] || '') : '';
    if (!password && !title) continue;

    items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: title || 'Untitled',
      password: password,
      username: colUser !== -1 ? (row[colUser] || '') : '',
      url: colUrl !== -1 ? (row[colUrl] || '') : '',
      notes: colNotes !== -1 ? (row[colNotes] || '') : '',
      category: colCategory !== -1 && row[colCategory] ? row[colCategory].trim() : '',
      tags: colCategory !== -1 && row[colCategory] ? [row[colCategory].trim()] : [],
      updatedAt: new Date().toISOString()
    });
  }

  return items;
}

export async function handleSyncPassProject(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  if (!state.hasNativeMessagingPermission) {
    const granted = await requestPermission('nativeMessaging');
    if (!granted) {
      showToast(t('toasts.native_permission_denied'));
      return;
    }
    updateState({ hasNativeMessagingPermission: true });
  }
  showToast(t('toasts.pass_syncing'));
  try {
    const passItems = await syncAllPassEntries(projectId);
    const otherItems = state.items.filter(i => i.projectId !== projectId);
    const updatedItems = [...otherItems, ...passItems];
    updateState({ items: updatedItems });
    await persistVaultChanges();
    showToast(t('toasts.pass_sync_loaded', { count: passItems.length }));
  } catch (err) {
    alert(t('toasts.pass_conn_err', { message: err.message }));
  }
}

