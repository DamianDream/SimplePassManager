/**
 * Storage and Multi-Project Synchronization Engine
 * Handles chrome.storage persistence, project isolation, cascade deletion, and data migration.
 */

import { decryptVault, encryptVault } from './crypto.js';

const STORAGE_VAULT_KEY = 'sp_encrypted_vault';
const STORAGE_CONFIG_KEY = 'sp_user_config';
export const STORAGE_VAULT_PROFILES_KEY = 'sp_vault_profiles';
export const STORAGE_ACTIVE_VAULT_ID_KEY = 'sp_active_vault_id';

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

const memoryStore = new Map();
const hasLocalStorage = typeof localStorage !== 'undefined';

const storageAPI = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
  ? chrome.storage.local
  : {
      get: (keys, cb) => {
        const res = {};
        const getItem = (k) => {
          if (hasLocalStorage) return localStorage.getItem(k);
          return memoryStore.has(k) ? memoryStore.get(k) : null;
        };
        if (Array.isArray(keys)) {
          keys.forEach(k => {
            const v = getItem(k);
            if (v) res[k] = JSON.parse(v);
          });
        } else if (typeof keys === 'string') {
          const v = getItem(keys);
          if (v) res[keys] = JSON.parse(v);
        } else if (typeof keys === 'object' && keys !== null) {
          Object.keys(keys).forEach(k => {
            const v = getItem(k);
            res[k] = v ? JSON.parse(v) : keys[k];
          });
        }
        cb(res);
      },
      set: (obj, cb) => {
        Object.entries(obj).forEach(([k, v]) => {
          const serialized = JSON.stringify(v);
          if (hasLocalStorage) {
            localStorage.setItem(k, serialized);
          } else {
            memoryStore.set(k, serialized);
          }
        });
        if (cb) cb();
      },
      remove: (key, cb) => {
        const removeKey = (k) => {
          if (hasLocalStorage) {
            localStorage.removeItem(k);
          } else {
            memoryStore.delete(k);
          }
        };
        if (Array.isArray(key)) {
          key.forEach(removeKey);
        } else {
          removeKey(key);
        }
        if (cb) cb();
      }
    };

/**
 * Returns all registered vault profiles.
 * Backwards compatible: if legacy sp_encrypted_vault exists without profiles,
 * a default profile is synthesized and registered.
 */
export function getVaultProfiles() {
  return new Promise(resolve => {
    storageAPI.get([STORAGE_VAULT_PROFILES_KEY, STORAGE_VAULT_KEY], res => {
      let profiles = res[STORAGE_VAULT_PROFILES_KEY];
      const legacyVault = res[STORAGE_VAULT_KEY];

      if ((!profiles || profiles.length === 0) && legacyVault) {
        profiles = [
          {
            id: 'vault_default',
            name: 'Основная база',
            storageKey: STORAGE_VAULT_KEY,
            createdAt: new Date().toISOString()
          }
        ];
        storageAPI.set({
          [STORAGE_VAULT_PROFILES_KEY]: profiles,
          [STORAGE_ACTIVE_VAULT_ID_KEY]: 'vault_default'
        }, () => {
          resolve(profiles);
        });
        return;
      }

      resolve(profiles && Array.isArray(profiles) ? profiles : []);
    });
  });
}

/**
 * Returns the currently active vault profile ID.
 */
export function getActiveVaultId() {
  return new Promise(resolve => {
    storageAPI.get([STORAGE_ACTIVE_VAULT_ID_KEY, STORAGE_VAULT_PROFILES_KEY, STORAGE_VAULT_KEY], res => {
      const activeId = res[STORAGE_ACTIVE_VAULT_ID_KEY];
      const profiles = res[STORAGE_VAULT_PROFILES_KEY] || [];

      if (activeId && profiles.some(p => p.id === activeId)) {
        resolve(activeId);
        return;
      }
      if (profiles.length > 0) {
        resolve(profiles[0].id);
        return;
      }
      if (res[STORAGE_VAULT_KEY]) {
        resolve('vault_default');
        return;
      }
      resolve(null);
    });
  });
}

/**
 * Sets the active vault profile ID.
 */
export function setActiveVaultId(vaultId) {
  return new Promise(resolve => {
    storageAPI.set({ [STORAGE_ACTIVE_VAULT_ID_KEY]: vaultId }, () => {
      resolve();
    });
  });
}

/**
 * Reads encrypted vault envelope from storage.
 * If vaultId is provided, reads that specific vault; otherwise reads active vault.
 */
export async function getStoredVault(vaultId) {
  const profiles = await getVaultProfiles();
  let targetKey = STORAGE_VAULT_KEY;

  if (vaultId) {
    const found = profiles.find(p => p.id === vaultId);
    if (found) targetKey = found.storageKey;
  } else {
    const activeId = await getActiveVaultId();
    if (activeId) {
      const found = profiles.find(p => p.id === activeId);
      if (found) targetKey = found.storageKey;
    }
  }

  return new Promise(resolve => {
    storageAPI.get(targetKey, res => {
      if (res[targetKey] !== undefined && res[targetKey] !== null) {
        resolve(res[targetKey]);
      } else if (targetKey !== STORAGE_VAULT_KEY) {
        storageAPI.get(STORAGE_VAULT_KEY, legacyRes => {
          resolve(legacyRes[STORAGE_VAULT_KEY] || null);
        });
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Saves encrypted vault envelope to storage.
 * Updates target vault without modifying other vaults.
 */
export async function saveStoredVault(envelope, vaultId) {
  let targetVaultId = vaultId || (await getActiveVaultId());
  let profiles = await getVaultProfiles();

  if (!targetVaultId) {
    targetVaultId = 'vault_default';
  }

  let profile = profiles.find(p => p.id === targetVaultId);
  let storageKey = profile
    ? profile.storageKey
    : (targetVaultId === 'vault_default' ? STORAGE_VAULT_KEY : `sp_vault_${targetVaultId}`);

  if (!profile) {
    profile = {
      id: targetVaultId,
      name: 'Основная база',
      storageKey,
      createdAt: new Date().toISOString()
    };
    profiles = [...profiles, profile];
  }

  return new Promise(resolve => {
    storageAPI.set({
      [storageKey]: envelope,
      [STORAGE_VAULT_PROFILES_KEY]: profiles,
      [STORAGE_ACTIVE_VAULT_ID_KEY]: targetVaultId
    }, () => {
      resolve(profile);
    });
  });
}

/**
 * Creates a brand new vault profile and stores its initial envelope.
 * Leaves all existing vault databases completely untouched!
 */
export async function createVaultProfile(name, envelope) {
  const profiles = await getVaultProfiles();
  const id = 'vault_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const storageKey = `sp_vault_${id}`;
  const profileName = (name && name.trim()) || `База ${profiles.length + 1}`;

  const newProfile = {
    id,
    name: profileName,
    storageKey,
    createdAt: new Date().toISOString()
  };

  const updatedProfiles = [...profiles, newProfile];

  return new Promise(resolve => {
    storageAPI.set({
      [storageKey]: envelope,
      [STORAGE_VAULT_PROFILES_KEY]: updatedProfiles,
      [STORAGE_ACTIVE_VAULT_ID_KEY]: id
    }, () => {
      resolve(newProfile);
    });
  });
}

/**
 * Deletes a specific vault profile and its stored data.
 * If the active vault was deleted, points active to an existing profile.
 */
export async function deleteVaultProfile(vaultId) {
  const profiles = await getVaultProfiles();
  const targetIndex = profiles.findIndex(p => p.id === vaultId);
  if (targetIndex === -1) return profiles;

  const targetProfile = profiles[targetIndex];
  const updatedProfiles = profiles.filter(p => p.id !== vaultId);

  const activeId = await getActiveVaultId();
  let nextActiveId = activeId;
  if (activeId === vaultId) {
    nextActiveId = updatedProfiles.length > 0 ? updatedProfiles[0].id : null;
  }

  return new Promise(resolve => {
    storageAPI.remove(targetProfile.storageKey, () => {
      const updates = {
        [STORAGE_VAULT_PROFILES_KEY]: updatedProfiles
      };
      if (nextActiveId) {
        updates[STORAGE_ACTIVE_VAULT_ID_KEY] = nextActiveId;
      }
      storageAPI.set(updates, () => {
        if (!nextActiveId) {
          storageAPI.remove([STORAGE_ACTIVE_VAULT_ID_KEY, STORAGE_VAULT_KEY], () => {
            resolve(updatedProfiles);
          });
        } else {
          resolve(updatedProfiles);
        }
      });
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

/**
 * Completely wipes all vault databases and profiles from storage.
 */
export async function clearStoredVault() {
  const profiles = await getVaultProfiles();
  const keysToRemove = [STORAGE_VAULT_KEY, STORAGE_VAULT_PROFILES_KEY, STORAGE_ACTIVE_VAULT_ID_KEY];
  profiles.forEach(p => {
    if (p.storageKey && !keysToRemove.includes(p.storageKey)) {
      keysToRemove.push(p.storageKey);
    }
  });

  return new Promise(resolve => {
    storageAPI.remove(keysToRemove, () => {
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
export async function verifyMasterPassword(enteredPassword, vaultId) {
  try {
    const envelope = await getStoredVault(vaultId);
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

/**
 * Escapes a single CSV cell according to RFC 4180.
 * @param {any} val
 * @returns {string}
 */
export function escapeCsvCell(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parses a CSV string into a 2D array of string cells according to RFC 4180.
 * Correctly handles quotes, commas, escaped quotes ("") and multiline cell content.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (!text || typeof text !== 'string') return [];

  // Remove potential BOM header
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  // Push final cell and row
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Exports items to CSV format with strict column order:
 * login, pass, name, tag, url, note
 * @param {Array<any>} items
 * @returns {string}
 */
export function itemsToCsv(items = []) {
  const header = 'login,pass,name,tag,url,note';
  const rows = items.map(item => {
    const login = escapeCsvCell(item.username || '');
    const pass = escapeCsvCell(item.password || '');
    const name = escapeCsvCell(item.title || '');
    const tags = Array.isArray(item.tags) && item.tags.length > 0
      ? item.tags.join(', ')
      : (item.category || '');
    const tag = escapeCsvCell(tags);
    const url = escapeCsvCell(item.url || '');
    const note = escapeCsvCell(item.notes || '');
    return `${login},${pass},${name},${tag},${url},${note}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Converts parsed CSV text into SimplePass items.
 * Strict column order: login, pass, name, tag, url, note
 * Automatically detects and skips optional header row.
 * @param {string} csvText
 * @param {string} [projectId='proj_default']
 * @returns {{ items: Array<any>, newCategories: string[] }}
 */
export function csvToItems(csvText, projectId = 'proj_default') {
  const rows = parseCsv(csvText);
  if (!rows || rows.length === 0) return { items: [], newCategories: [] };

  let startIndex = 0;
  // Check if first row is header
  const firstRow = rows[0].map(c => c.trim().toLowerCase());
  if (
    firstRow[0] === 'login' &&
    (firstRow[1] === 'pass' || firstRow[1] === 'password')
  ) {
    startIndex = 1;
  }

  const items = [];
  const discoveredTags = new Set();
  const now = new Date().toISOString();

  for (let r = startIndex; r < rows.length; r++) {
    const row = rows[r];
    // Skip empty lines
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) {
      continue;
    }

    const login = (row[0] || '').trim();
    const pass = row[1] !== undefined ? row[1] : '';
    const name = (row[2] || '').trim();
    const tagRaw = (row[3] || '').trim();
    const url = (row[4] || '').trim();
    const note = row[5] !== undefined ? row[5] : '';

    // If completely blank row
    if (!login && !pass && !name && !url && !note) {
      continue;
    }

    // Parse tags: split by comma or semicolon
    let tags = tagRaw ? tagRaw.split(/[,;]+/).map(t => t.trim()).filter(Boolean) : [];
    // Validate tag format: only letters, digits and Cyrillic/Ukrainian characters up to 30 chars
    tags = tags
      .map(t => t.replace(/[^a-zA-Z0-9\u0400-\u04FF]/g, '').slice(0, 30))
      .filter(Boolean);

    if (tags.length === 0) {
      tags = ['Work'];
    }

    tags.forEach(t => discoveredTags.add(t));

    const itemTitle = name || login || (url ? url.replace(/^https?:\/\//, '').split('/')[0] : 'Untitled');

    items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + r,
      projectId,
      title: itemTitle,
      username: login,
      password: pass,
      category: tags[0] || 'Work',
      tags,
      url,
      notes: note,
      updatedAt: now
    });
  }

  return { items, newCategories: Array.from(discoveredTags) };
}

/**
 * Converts a parsed Bitwarden JSON export object into SimplePass items and detected categories.
 * Supports folders -> tags mapping, login credentials, URIs, notes, and timestamps.
 * @param {any} bwData
 * @param {string} [projectId='proj_default']
 * @returns {{ items: Array<any>, newCategories: string[] }}
 */
export function bitwardenJsonToItems(bwData, projectId = 'proj_default') {
  if (!bwData || !Array.isArray(bwData.items)) {
    return { items: [], newCategories: [] };
  }

  const folderMap = new Map();
  if (Array.isArray(bwData.folders)) {
    bwData.folders.forEach(f => {
      if (f && f.id && f.name) {
        folderMap.set(f.id, f.name.trim());
      }
    });
  }

  const items = [];
  const discoveredTags = new Set();
  const now = new Date().toISOString();

  for (let idx = 0; idx < bwData.items.length; idx++) {
    const bwItem = bwData.items[idx];
    if (!bwItem) continue;

    let folderName = '';
    if (bwItem.folderId && folderMap.has(bwItem.folderId)) {
      folderName = folderMap.get(bwItem.folderId);
    }

    let tags = [];
    if (folderName) {
      const cleanTag = folderName.replace(/[^a-zA-Z0-9\u0400-\u04FF\s-]/g, '').trim().slice(0, 30);
      if (cleanTag) {
        tags = [cleanTag];
        discoveredTags.add(cleanTag);
      }
    }
    if (tags.length === 0) {
      tags = ['Work'];
    }

    const title = (bwItem.name || '').trim() || (bwItem.login?.username || '').trim() || 'Untitled';
    const username = bwItem.login?.username || '';
    const password = bwItem.login?.password || '';

    let url = '';
    if (Array.isArray(bwItem.login?.uris) && bwItem.login.uris.length > 0) {
      url = bwItem.login.uris[0]?.uri || '';
    }

    const notes = bwItem.notes || '';

    items.push({
      id: bwItem.id || `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}_${idx}`,
      projectId,
      title,
      username,
      password,
      url,
      notes,
      category: tags[0] || 'Work',
      tags,
      favorite: !!bwItem.favorite,
      createdAt: bwItem.creationDate || now,
      updatedAt: bwItem.revisionDate || now
    });
  }

  return { items, newCategories: Array.from(discoveredTags) };
}

/**
 * Converts SimplePass items into Bitwarden-compatible unencrypted JSON export string.
 * Generates standard Bitwarden structure with folders and items.
 * @param {Array<any>} items
 * @returns {string}
 */
export function itemsToBitwardenJson(items = []) {
  const folderNames = new Set();
  items.forEach(i => {
    const itemTags = Array.isArray(i.tags) && i.tags.length > 0 ? i.tags : (i.category ? [i.category] : []);
    itemTags.forEach(t => {
      if (t && t.trim() && t.trim() !== 'Work') folderNames.add(t.trim());
    });
  });

  const folders = Array.from(folderNames).map((name, idx) => ({
    id: `folder_${idx + 1}`,
    name
  }));
  const folderNameToId = new Map(folders.map(f => [f.name, f.id]));

  const bwItems = items.map((item, idx) => {
    const itemTag = (Array.isArray(item.tags) && item.tags[0]) || item.category || '';
    const folderId = folderNameToId.get(itemTag) || null;
    const now = new Date().toISOString();

    return {
      type: 1, // Login
      name: item.title || item.url || 'Untitled',
      favorite: !!item.favorite,
      reprompt: 0,
      id: item.id || `bw_${Date.now()}_${Math.random().toString(36).substr(2, 6)}_${idx}`,
      folderId,
      collectionIds: null,
      fields: [],
      notes: item.notes || '',
      login: {
        uris: item.url ? [{ uri: item.url }] : [],
        fido2Credentials: [],
        username: item.username || '',
        password: item.password || ''
      },
      passwordHistory: [],
      creationDate: item.createdAt || now,
      revisionDate: item.updatedAt || now
    };
  });

  return JSON.stringify({
    encrypted: false,
    folders,
    items: bwItems
  }, null, 2);
}


