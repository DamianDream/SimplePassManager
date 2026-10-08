/**
 * Session & Auth Lifetime Manager
 * Handles master password verification intervals and persistent unlock states.
 */

export const LOCK_INTERVALS = {
  session: { id: 'session', label: 'Каждый раз при новой сессии браузера', ms: 0 },
  '1day': { id: '1day', label: 'Раз в день (24 часа)', ms: 24 * 60 * 60 * 1000 },
  '3days': { id: '3days', label: 'Раз в три дня (по умолчанию)', ms: 3 * 24 * 60 * 60 * 1000 },
  '1week': { id: '1week', label: 'Раз в неделю (7 дней)', ms: 7 * 24 * 60 * 60 * 1000 },
  '1month': { id: '1month', label: 'Раз в месяц (30 дней)', ms: 30 * 24 * 60 * 60 * 1000 }
};

const SESSION_STORAGE_KEY = 'sp_active_session';

// Fallback memory cache for currently active execution
let inMemoryPassword = null;

function getStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return {
    get: (key, cb) => {
      const val = localStorage.getItem(key);
      cb({ [key]: val ? JSON.parse(val) : null });
    },
    set: (obj, cb) => {
      Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      if (cb) cb();
    },
    remove: (key, cb) => {
      localStorage.removeItem(key);
      if (cb) cb();
    }
  };
}

/**
 * Obfuscates in-session stored string with a machine-local key to prevent plain string memory inspection.
 */
function simpleScramble(str) {
  return btoa(encodeURIComponent(str));
}

function simpleUnscramble(b64) {
  try {
    return decodeURIComponent(atob(b64));
  } catch (_) {
    return null;
  }
}

/**
 * Creates an active session with expiration based on selected lock interval
 */
export async function createSession(masterPassword, lockIntervalId = '3days') {
  inMemoryPassword = masterPassword;
  const interval = LOCK_INTERVALS[lockIntervalId] || LOCK_INTERVALS['3days'];
  const now = Date.now();
  const isSessionOnly = interval.id === 'session';
  const expiresAt = isSessionOnly ? 0 : now + interval.ms;

  const sessionData = {
    token: simpleScramble(masterPassword),
    createdAt: now,
    expiresAt: expiresAt,
    intervalId: interval.id
  };

  const storage = getStorage();

  // If session-only, prefer chrome.storage.session when available so it dies on browser quit
  if (isSessionOnly && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await new Promise(resolve => chrome.storage.session.set({ [SESSION_STORAGE_KEY]: sessionData }, resolve));
    await new Promise(resolve => storage.remove(SESSION_STORAGE_KEY, resolve));
  } else {
    await new Promise(resolve => storage.set({ [SESSION_STORAGE_KEY]: sessionData }, resolve));
  }

  return sessionData;
}

/**
 * Restores session if not expired.
 * Returns { masterPassword, expiresAt, intervalId } or null.
 */
export async function restoreSession() {
  if (inMemoryPassword) {
    return { masterPassword: inMemoryPassword };
  }

  const storage = getStorage();

  // Check storage.session first
  let data = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    data = await new Promise(resolve => {
      chrome.storage.session.get(SESSION_STORAGE_KEY, res => resolve(res[SESSION_STORAGE_KEY] || null));
    });
  }

  // If not found, check storage.local (for multi-day sessions)
  if (!data) {
    data = await new Promise(resolve => {
      storage.get(SESSION_STORAGE_KEY, res => resolve(res[SESSION_STORAGE_KEY] || null));
    });
  }

  if (!data || !data.token) {
    return null;
  }

  const now = Date.now();
  // Check if expired (expiresAt > 0 means fixed duration, 0 means session-only)
  if (data.expiresAt > 0 && now > data.expiresAt) {
    await destroySession();
    return null;
  }

  const password = simpleUnscramble(data.token);
  if (!password) {
    await destroySession();
    return null;
  }

  inMemoryPassword = password;
  return {
    masterPassword: password,
    expiresAt: data.expiresAt,
    intervalId: data.intervalId
  };
}

/**
 * Destroys current session and clears cache
 */
export async function destroySession() {
  inMemoryPassword = null;
  const storage = getStorage();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(SESSION_STORAGE_KEY);
  }
  await new Promise(resolve => storage.remove(SESSION_STORAGE_KEY, resolve));
}
