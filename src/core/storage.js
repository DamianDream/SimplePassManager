/**
 * Storage and Multi-Project Synchronization Engine
 * Handles chrome.storage persistence, project isolation, cascade deletion, and data migration.
 */

import { decryptVault, encryptVault } from './crypto.js';

const STORAGE_VAULT_KEY = 'sp_encrypted_vault';
const STORAGE_CONFIG_KEY = 'sp_user_config';

export const DEFAULT_CONFIG = {
  activeProjectId: 'proj_default',
  latestProjectId: 'proj_default',
  lockInterval: '3days',
  clipboardClearSeconds: 30,
  theme: 'light',
  language: 'ru',
  defaultCategory: 'Work',
  categories: ['Work', 'Personal']
};

const storageAPI = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
  ? chrome.storage.local
  : {
      get: (keys, cb) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => {
            const v = localStorage.getItem(k);
            if (v) res[k] = JSON.parse(v);
          });
        } else if (typeof keys === 'string') {
          const v = localStorage.getItem(keys);
          if (v) res[keys] = JSON.parse(v);
        }
        cb(res);
      },
      set: (obj, cb) => {
        Object.entries(obj).forEach(([k, v]) => {
          localStorage.setItem(k, JSON.stringify(v));
        });
        if (cb) cb();
      },
      remove: (key, cb) => {
        localStorage.removeItem(key);
        if (cb) cb();
      }
    };

export function getStoredVault() {
  return new Promise(resolve => {
    storageAPI.get(STORAGE_VAULT_KEY, res => {
      resolve(res[STORAGE_VAULT_KEY] || null);
    });
  });
}

export function saveStoredVault(envelope) {
  return new Promise(resolve => {
    storageAPI.set({ [STORAGE_VAULT_KEY]: envelope }, () => {
      resolve();
    });
  });
}

export function getStoredConfig() {
  return new Promise(resolve => {
    storageAPI.get(STORAGE_CONFIG_KEY, res => {
      resolve({ ...DEFAULT_CONFIG, ...(res[STORAGE_CONFIG_KEY] || {}) });
    });
  });
}

export function saveStoredConfig(config) {
  return new Promise(resolve => {
    storageAPI.set({ [STORAGE_CONFIG_KEY]: config }, () => {
      resolve();
    });
  });
}

export function clearStoredVault() {
  return new Promise(resolve => {
    storageAPI.remove(STORAGE_VAULT_KEY, () => {
      resolve();
    });
  });
}

/**
 * Normalizes vault data ensuring multi-project support and backward compatibility.
 */
export function normalizeVaultData(data, initialProjectName = 'main') {
  const now = new Date().toISOString();
  let projects = data.projects || [];
  let items = data.items || [];

  // Migration from v1 or empty: create default project if none exist
  if (!projects.length) {
    const defaultProj = {
      id: 'proj_default',
      name: initialProjectName,
      type: 'browser', // 'browser' | 'local_pass'
      createdAt: now,
      updatedAt: now
    };
    projects = [defaultProj];
  }

  const defaultProjId = projects[0].id;

  // Ensure every item is associated with a project
  items = items.map(item => {
    if (!item.projectId) {
      return { ...item, projectId: defaultProjId };
    }
    return item;
  });

  return {
    version: 2,
    createdAt: data.createdAt || now,
    updatedAt: now,
    projects,
    items
  };
}

/**
 * Verifies if entered password can decrypt current stored vault.
 * Returns true if valid, false otherwise.
 */
export async function verifyMasterPassword(enteredPassword) {
  try {
    const envelope = await getStoredVault();
    if (!envelope) return false;
    await decryptVault(envelope, enteredPassword);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Format converter: converts items to/from UNIX pass format
 */
export function itemToPassFormat(item) {
  let content = `${item.password}\n`;
  if (item.username) content += `login: ${item.username}\n`;
  if (item.url) content += `url: ${item.url}\n`;
  if (item.category) content += `category: ${item.category}\n`;
  if (item.notes) content += `notes: ${item.notes}\n`;
  return content;
}

export function passFormatToItem(title, content, projectId = 'proj_default') {
  const lines = content.trim().split('\n');
  const password = lines[0] || '';
  const item = {
    id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    projectId,
    title: title || 'Untitled',
    password,
    username: '',
    url: '',
    category: 'General',
    notes: '',
    updatedAt: new Date().toISOString()
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      if (key === 'login' || key === 'username' || key === 'user' || key === 'email') {
        item.username = val;
      } else if (key === 'url' || key === 'website' || key === 'link') {
        item.url = val;
      } else if (key === 'category' || key === 'folder') {
        item.category = val;
      } else if (key === 'notes' || key === 'note') {
        item.notes = (item.notes ? item.notes + '\n' : '') + val;
      } else {
        item.notes = (item.notes ? item.notes + '\n' : '') + line;
      }
    } else {
      item.notes = (item.notes ? item.notes + '\n' : '') + line;
    }
  }

  return item;
}
