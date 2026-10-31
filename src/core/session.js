/**
 * Session & Auth Lifetime Manager
 * Handles vault unlock sessions and secure memory lifetime.
 * Master password is NEVER stored on disk.
 * Active sessions maintain the random 256-bit Master Encryption Key (MEK)
 * in chrome.storage.session (cleared on browser exit) or memory.
 */

export const LOCK_INTERVALS = {
  '15m': { id: '15m', labelKey: 'settings.lock_15m', ms: 15 * 60 * 1000 },
  '1h': { id: '1h', labelKey: 'settings.lock_1h', ms: 60 * 60 * 1000 },
  '8h': { id: '8h', labelKey: 'settings.lock_8h', ms: 8 * 60 * 60 * 1000 },
  session: { id: 'session', labelKey: 'settings.lock_session', ms: 0 },
  '1day': { id: '1day', labelKey: 'settings.lock_1day', ms: 24 * 60 * 60 * 1000 }
};

const SESSION_STORAGE_KEY = 'sp_active_session';

// In-memory reference for currently unlocked MEK
let inMemoryMek = null;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return {
    get: (key, cb) => {
      try {
        const val = localStorage.getItem(key);
        cb({ [key]: val ? JSON.parse(val) : null });
      } catch (_) {
        cb({ [key]: null });
      }
    },
    set: (obj, cb) => {
      try {
        Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      } catch (_) {}
      if (cb) cb();
    },
    remove: (key, cb) => {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
      if (cb) cb();
    }
  };
}

/**
 * Normalizes legacy interval IDs (e.g. 3days, 1week, 1month) to supported ones.
 */
export function normalizeLockIntervalId(intervalId) {
  if (!intervalId || intervalId === 'session') return 'session';
  if (LOCK_INTERVALS[intervalId]) return intervalId;
  if (intervalId === '3days' || intervalId === '1week' || intervalId === '1month') {
    return '1day';
  }
  return 'session';
}

/**
 * Creates an active unlock session holding MEK with expiration based on selected lock interval.
 * rawMek MUST be a 32-byte Uint8Array (Master Encryption Key).
 * Master password is NEVER stored.
 */
export async function createSession(rawMek, lockIntervalId = 'session') {
  if (!(rawMek instanceof Uint8Array) || rawMek.length !== 32) {
    throw new TypeError('createSession expects a raw MEK Uint8Array');
  }

  const normId = normalizeLockIntervalId(lockIntervalId);
  const interval = LOCK_INTERVALS[normId] || LOCK_INTERVALS['session'];
  const now = Date.now();
  const isSessionOnly = interval.id === 'session';
  const expiresAt = isSessionOnly ? 0 : now + interval.ms;

  const rawBytes = new Uint8Array(rawMek);
  inMemoryMek = rawBytes;

  const sessionData = {
    token: bufferToBase64(rawBytes),
    isRawMek: true,
    createdAt: now,
    expiresAt: expiresAt,
    intervalId: interval.id
  };

  const storage = getStorage();

  // Short-lived intervals (15m, 1h, 8h, session) stay exclusively in memory & chrome.storage.session.
  // Only the '1day' (24h) interval is allowed to be persisted to chrome.storage.local to survive browser restart.
  const isDiskAllowed = interval.id === '1day';

  if (!isDiskAllowed && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await new Promise(resolve => chrome.storage.session.set({ [SESSION_STORAGE_KEY]: sessionData }, resolve));
    await new Promise(resolve => storage.remove(SESSION_STORAGE_KEY, resolve));
  } else if (isDiskAllowed) {
    await new Promise(resolve => storage.set({ [SESSION_STORAGE_KEY]: sessionData }, resolve));
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      await new Promise(resolve => chrome.storage.session.remove(SESSION_STORAGE_KEY, resolve));
    }
  } else {
    await new Promise(resolve => storage.set({ [SESSION_STORAGE_KEY]: sessionData }, resolve));
  }

  return sessionData;
}

/**
 * Restores session if not expired.
 * Destroys any legacy unauthenticated session tokens from previous versions.
 * Returns { rawMek, expiresAt, intervalId } or null.
 */
export async function restoreSession() {
  if (inMemoryMek) {
    return { rawMek: inMemoryMek, expiresAt: 0, intervalId: 'session' };
  }

  const storage = getStorage();

  // Check storage.session first
  let data = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    data = await new Promise(resolve => {
      chrome.storage.session.get(SESSION_STORAGE_KEY, res => resolve(res[SESSION_STORAGE_KEY] || null));
    });
  }

  // If not found, check storage.local (only allowed for 1-day interval)
  if (!data) {
    data = await new Promise(resolve => {
      storage.get(SESSION_STORAGE_KEY, res => resolve(res[SESSION_STORAGE_KEY] || null));
    });
  }

  if (!data || !data.token) {
    return null;
  }

  // Security migration: immediately destroy any legacy session token without isRawMek
  if (!data.isRawMek) {
    await destroySession();
    return null;
  }

  const now = Date.now();
  // Check if expired (expiresAt > 0 means fixed duration, 0 means session-only)
  if (data.expiresAt > 0 && now > data.expiresAt) {
    await destroySession();
    return null;
  }

  try {
    const rawMek = new Uint8Array(base64ToBuffer(data.token));
    if (rawMek.length !== 32) {
      await destroySession();
      return null;
    }
    inMemoryMek = rawMek;
    return {
      rawMek,
      expiresAt: data.expiresAt,
      intervalId: data.intervalId
    };
  } catch (_) {
    await destroySession();
    return null;
  }
}

/**
 * Destroys current session and wipes memory buffers
 */
export async function destroySession() {
  if (inMemoryMek && inMemoryMek.fill) {
    try { inMemoryMek.fill(0); } catch (_) {}
  }
  inMemoryMek = null;
  const storage = getStorage();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(SESSION_STORAGE_KEY);
  }
  await new Promise(resolve => storage.remove(SESSION_STORAGE_KEY, resolve));
}
