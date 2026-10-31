/**
 * Storage and Multi-Project Synchronization Engine
 * Handles chrome.storage persistence, project isolation, cascade deletion, and data migration.
 */

import { decryptVault, encryptVault } from './crypto.js';

const STORAGE_VAULT_KEY = 'sp_encrypted_vault';
const STORAGE_CONFIG_KEY = 'sp_user_config';
export const STORAGE_VAULT_PROFILES_KEY = 'sp_vault_profiles';
export const STORAGE_ACTIVE_VAULT_ID_KEY = 'sp_active_vault_id';
export const STORAGE_FAVICON_CACHE_KEY = 'sp_favicon_cache';

export const DEFAULT_CONFIG = {
  activeProjectId: 'proj_default',
  latestProjectId: 'proj_default',
  lockInterval: 'session',
  autolockMinutes: 15,
  clipboardClearSeconds: 30,
  theme: 'light',
  language: 'en',
  defaultCategory: 'Work',
  categories: ['Work', 'Personal'],
  showCardTags: false,
  showFavicons: true,
  useExternalIcons: false,
  currentSiteEnabled: true
};

const memoryStore = new Map();
export const _testMemoryStore = memoryStore;
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
        const safeParse = (v, fallback = null) => {
          if (!v) return fallback;
          try {
            return JSON.parse(v);
          } catch (_) {
            return fallback;
          }
        };

        if (Array.isArray(keys)) {
          keys.forEach(k => {
            const v = getItem(k);
            if (v !== null && v !== undefined) {
              const parsed = safeParse(v, null);
              if (parsed !== null) res[k] = parsed;
            }
          });
        } else if (typeof keys === 'string') {
          const v = getItem(keys);
          if (v !== null && v !== undefined) {
            const parsed = safeParse(v, null);
            if (parsed !== null) res[keys] = parsed;
          }
        } else if (typeof keys === 'object' && keys !== null) {
          Object.keys(keys).forEach(k => {
            const v = getItem(k);
            res[k] = v !== null && v !== undefined ? safeParse(v, keys[k]) : keys[k];
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

function checkLastError() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
    return new Error(chrome.runtime.lastError.message || 'chrome.storage operation failed');
  }
  return null;
}

export function storageGet(keys) {
  return new Promise((resolve, reject) => {
    storageAPI.get(keys, res => {
      const err = checkLastError();
      if (err) return reject(err);
      resolve(res);
    });
  });
}

export function storageSet(items) {
  return new Promise((resolve, reject) => {
    storageAPI.set(items, () => {
      const err = checkLastError();
      if (err) return reject(err);
      resolve();
    });
  });
}

export function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    storageAPI.remove(keys, () => {
      const err = checkLastError();
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Returns all registered vault profiles.
 * Backwards compatible: if legacy sp_encrypted_vault exists without profiles,
 * a default profile is synthesized and registered.
 */
export async function getVaultProfiles() {
  const res = await storageGet([STORAGE_VAULT_PROFILES_KEY, STORAGE_VAULT_KEY]);
  let profiles = res[STORAGE_VAULT_PROFILES_KEY];
  const legacyVault = res[STORAGE_VAULT_KEY];

  if ((!profiles || profiles.length === 0) && legacyVault) {
    profiles = [
      {
        id: 'vault_default',
        name: 'Main Vault',
        storageKey: STORAGE_VAULT_KEY,
        createdAt: new Date().toISOString()
      }
    ];
    await storageSet({
      [STORAGE_VAULT_PROFILES_KEY]: profiles,
      [STORAGE_ACTIVE_VAULT_ID_KEY]: 'vault_default'
    });
    return profiles;
  }

  return profiles && Array.isArray(profiles) ? profiles : [];
}

/**
 * Returns the currently active vault profile ID.
 */
export async function getActiveVaultId() {
  const res = await storageGet([STORAGE_ACTIVE_VAULT_ID_KEY, STORAGE_VAULT_PROFILES_KEY, STORAGE_VAULT_KEY]);
  const activeId = res[STORAGE_ACTIVE_VAULT_ID_KEY];
  const profiles = res[STORAGE_VAULT_PROFILES_KEY] || [];

  if (activeId && profiles.some(p => p.id === activeId)) {
    return activeId;
  }
  if (profiles.length > 0) {
    return profiles[0].id;
  }
  if (res[STORAGE_VAULT_KEY]) {
    return 'vault_default';
  }
  return null;
}

/**
 * Sets the active vault profile ID.
 */
export function setActiveVaultId(vaultId) {
  return storageSet({ [STORAGE_ACTIVE_VAULT_ID_KEY]: vaultId });
}

/**
 * Reads encrypted vault envelope from storage.
 * If vaultId is provided, reads that specific vault; otherwise reads active vault.
 */
export async function getStoredVault(vaultId) {
  const profiles = await getVaultProfiles();
  const targetVaultId = vaultId || (await getActiveVaultId()) || 'vault_default';
  let targetKey = STORAGE_VAULT_KEY;

  const found = profiles.find(p => p.id === targetVaultId);
  if (found) {
    targetKey = found.storageKey;
  } else if (targetVaultId !== 'vault_default') {
    // Non-default profile not found in profiles registry -> return null (no fallback)
    return null;
  }

  const res = await storageGet(targetKey);
  if (res[targetKey] !== undefined && res[targetKey] !== null) {
    return res[targetKey];
  }

  // Fallback to legacy STORAGE_VAULT_KEY ONLY for the default profile
  if (targetVaultId === 'vault_default' && targetKey !== STORAGE_VAULT_KEY) {
    const legacyRes = await storageGet(STORAGE_VAULT_KEY);
    return legacyRes[STORAGE_VAULT_KEY] || null;
  }

  return null;
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
      name: 'Main Vault',
      storageKey,
      createdAt: new Date().toISOString()
    };
    profiles = [...profiles, profile];
  }

  await storageSet({
    [storageKey]: envelope,
    [STORAGE_VAULT_PROFILES_KEY]: profiles,
    [STORAGE_ACTIVE_VAULT_ID_KEY]: targetVaultId
  });
  return profile;
}

/**
 * Creates a brand new vault profile and stores its initial envelope.
 * Leaves all existing vault databases completely untouched!
 */
export async function createVaultProfile(name, envelope) {
  const profiles = await getVaultProfiles();
  const id = 'vault_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const storageKey = `sp_vault_${id}`;
  const profileName = (name && name.trim()) || `Vault ${profiles.length + 1}`;

  const newProfile = {
    id,
    name: profileName,
    storageKey,
    createdAt: new Date().toISOString()
  };

  const updatedProfiles = [...profiles, newProfile];

  await storageSet({
    [storageKey]: envelope,
    [STORAGE_VAULT_PROFILES_KEY]: updatedProfiles,
    [STORAGE_ACTIVE_VAULT_ID_KEY]: id
  });
  return newProfile;
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

  await storageRemove(targetProfile.storageKey);
  const updates = {
    [STORAGE_VAULT_PROFILES_KEY]: updatedProfiles
  };
  if (nextActiveId) {
    updates[STORAGE_ACTIVE_VAULT_ID_KEY] = nextActiveId;
  }
  await storageSet(updates);
  if (!nextActiveId) {
    await storageRemove([STORAGE_ACTIVE_VAULT_ID_KEY, STORAGE_VAULT_KEY]);
  }
  return updatedProfiles;
}

export async function getStoredConfig() {
  const res = await storageGet(STORAGE_CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(res[STORAGE_CONFIG_KEY] || {}) };
}

export function saveStoredConfig(config) {
  return storageSet({ [STORAGE_CONFIG_KEY]: config });
}

export const MAX_FAVICON_ENTRIES = 300;
export const MAX_FAVICON_BYTES = 48 * 1024; // 48 KB

let faviconSaveTimer = null;
let pendingFaviconRawCache = null;

export async function getFaviconCache() {
  if (pendingFaviconRawCache) {
    const flat = {};
    for (const [k, v] of Object.entries(pendingFaviconRawCache)) {
      flat[k] = (v && typeof v === 'object' && v.dataUrl) ? v.dataUrl : (typeof v === 'string' ? v : '');
    }
    return flat;
  }
  const res = await storageGet(STORAGE_FAVICON_CACHE_KEY);
  const raw = res[STORAGE_FAVICON_CACHE_KEY] || {};
  const flat = {};
  for (const [k, v] of Object.entries(raw)) {
    flat[k] = (v && typeof v === 'object' && v.dataUrl) ? v.dataUrl : (typeof v === 'string' ? v : '');
  }
  return flat;
}

export function saveFaviconCache(cache) {
  const entries = [];
  const now = Date.now();

  for (const [k, v] of Object.entries(cache || {})) {
    let dataUrl = '';
    let usedAt = now;
    if (v && typeof v === 'object' && v.dataUrl) {
      dataUrl = v.dataUrl;
      usedAt = v.usedAt || now;
    } else if (typeof v === 'string') {
      dataUrl = v;
    }
    // (a) Skip oversized entries > 48 KB
    if (dataUrl && dataUrl.length <= MAX_FAVICON_BYTES) {
      entries.push({ domain: k.toLowerCase().trim(), dataUrl, usedAt });
    }
  }

  // (b) LRU limit 300 domains: keep most recently used
  if (entries.length > MAX_FAVICON_ENTRIES) {
    entries.sort((a, b) => b.usedAt - a.usedAt);
    entries.length = MAX_FAVICON_ENTRIES;
  }

  const normalized = {};
  for (const e of entries) {
    normalized[e.domain] = { dataUrl: e.dataUrl, usedAt: e.usedAt };
  }

  pendingFaviconRawCache = null;
  return storageSet({ [STORAGE_FAVICON_CACHE_KEY]: normalized });
}

export function flushFaviconCache() {
  if (faviconSaveTimer) {
    clearTimeout(faviconSaveTimer);
    faviconSaveTimer = null;
  }
  if (pendingFaviconRawCache) {
    const toSave = pendingFaviconRawCache;
    pendingFaviconRawCache = null;
    return saveFaviconCache(toSave);
  }
  return Promise.resolve();
}

export async function getCachedFavicon(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const key = domain.toLowerCase().trim();
  const cache = await getFaviconCache();
  return cache[key] || null;
}

export async function setCachedFavicon(domain, dataUrl) {
  if (!domain || !dataUrl) return;
  // (a) Skip oversized entries > 48 KB
  if (typeof dataUrl === 'string' && dataUrl.length > MAX_FAVICON_BYTES) return;

  const key = domain.toLowerCase().trim();
  const rawCache = pendingFaviconRawCache || (await storageGet(STORAGE_FAVICON_CACHE_KEY))[STORAGE_FAVICON_CACHE_KEY] || {};

  rawCache[key] = {
    dataUrl,
    usedAt: Date.now()
  };
  pendingFaviconRawCache = rawCache;

  // (c) Batch with debounce 2s
  if (faviconSaveTimer) clearTimeout(faviconSaveTimer);
  return new Promise(resolve => {
    faviconSaveTimer = setTimeout(async () => {
      await flushFaviconCache();
      resolve();
    }, 2000);
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

  return storageRemove(keysToRemove);
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

  // F4: Trash retention - keep items for 30 days, purge expired
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  let trash = Array.isArray(data.trash) ? data.trash : [];
  trash = trash.filter(item => {
    const deletedTime = item.deletedAt ? new Date(item.deletedAt).getTime() : 0;
    return deletedTime && (nowMs - deletedTime) < THIRTY_DAYS_MS;
  });

  return {
    version: data.version || 2,
    createdAt: data.createdAt || now,
    updatedAt: now,
    projects,
    items,
    trash
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
    // Validate tag format: preserve letters, digits, Cyrillic, spaces, and hyphens up to 30 chars
    tags = tags
      .map(t => t.replace(/[^a-zA-Z0-9\u0400-\u04FF -]/g, '').trim().slice(0, 30))
      .filter(Boolean);

    tags.forEach(t => discoveredTags.add(t));

    const itemTitle = name || login || (url ? url.replace(/^https?:\/\//, '').split('/')[0] : 'Untitled');

    items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + r,
      projectId,
      title: itemTitle,
      username: login,
      password: pass,
      category: tags[0] || '',
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
      passwordHistory: Array.isArray(item.passwordHistory)
        ? item.passwordHistory.map(ph => ({
            lastUsedDate: ph.createdAt || ph.lastUsed || now,
            password: ph.password
          }))
        : [],
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


