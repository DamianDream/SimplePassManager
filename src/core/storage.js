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

