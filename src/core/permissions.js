/**
 * Chrome Optional Permissions Helper for SimplePass Manager
 * Wraps chrome.permissions API for tabs, nativeMessaging, and site origins.
 */

export function isChromePermissionsAvailable() {
  return typeof chrome !== 'undefined' && Boolean(chrome.permissions);
}

/**
 * Checks if a named permission (e.g. 'tabs', 'nativeMessaging') is currently granted.
 * @param {string} perm
 * @returns {Promise<boolean>}
 */
export async function hasPermission(perm) {
  if (!isChromePermissionsAvailable()) return false;
  return new Promise(resolve => {
    try {
      chrome.permissions.contains({ permissions: [perm] }, granted => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Requests a named permission from the user.
 * MUST be invoked directly from a user gesture (e.g. click).
 * @param {string} perm
 * @returns {Promise<boolean>}
 */
export async function requestPermission(perm) {
  if (!isChromePermissionsAvailable()) return false;
  return new Promise(resolve => {
    try {
      chrome.permissions.request({ permissions: [perm] }, granted => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Checks if specific origin patterns are currently granted.
 * @param {string[]} origins
 * @returns {Promise<boolean>}
 */
export async function hasOriginPermissions(origins) {
  if (!isChromePermissionsAvailable() || !Array.isArray(origins) || origins.length === 0) return false;
  return new Promise(resolve => {
    try {
      chrome.permissions.contains({ origins }, granted => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Requests host/origin access for specific domains.
 * MUST be invoked directly from a user gesture.
 * @param {string[]} origins
 * @returns {Promise<boolean>}
 */
export async function requestOriginPermissions(origins) {
  if (!isChromePermissionsAvailable() || !Array.isArray(origins) || origins.length === 0) return false;
  return new Promise(resolve => {
    try {
      chrome.permissions.request({ origins }, granted => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Generates origin match patterns for a domain (e.g. github.com)
 * @param {string} domain
 * @returns {string[]}
 */
export function getDomainOriginPatterns(domain) {
  if (!domain) return [];
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!clean || clean === 'about:blank' || clean.includes('localhost') || clean.startsWith('127.')) {
    return [];
  }
  return [
    `https://${clean}/*`,
    `https://*.${clean}/*`,
    `http://${clean}/*`
  ];
}
