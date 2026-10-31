/**
 * SimplePass Manager - Native Messaging Bridge for UNIX pass CLI
 * Communicates with com.simplepass.pass_host to sync with ~/.password-store
 */

import { passFormatToItem, itemToPassFormat } from './storage.js';
import { hasPermission } from './permissions.js';

export const NATIVE_HOST_NAME = 'com.simplepass.pass_host';

/**
 * Sends a message to the native messaging host with a timeout.
 */
export async function sendNativeRequest(action, payload = {}, timeoutMs = 6000) {
  if (typeof chrome !== 'undefined' && chrome.permissions) {
    const hasPerm = await hasPermission('nativeMessaging');
    if (!hasPerm) {
      return {
        ok: false,
        permissionRequired: true,
        errorCode: 'permission_required',
        error: 'Permission nativeMessaging is required'
      };
    }
  }

  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendNativeMessage) {
      resolve({
        ok: false,
        notFound: true,
        errorCode: 'native_api_unavailable',
        error: 'Chrome Native Messaging API is not available in current environment'
      });
      return;
    }

    let isResolved = false;
    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({
          ok: false,
          timeout: true,
          errorCode: 'native_timeout',
          error: 'Native Messaging Host response timed out (6s)'
        });
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { action, ...payload },
        response => {
          if (isResolved) return;
          clearTimeout(timer);
          isResolved = true;

          const lastError = chrome.runtime.lastError;
          if (lastError) {
            const msg = lastError.message || 'Native Messaging Host error';
            resolve({
              ok: false,
              errorCode: 'native_host_error',
              error: msg,
              notFound: msg.includes('not found') || msg.includes('Specified native messaging host not found')
            });
            return;
          }

          if (!response) {
            resolve({
              ok: false,
              errorCode: 'native_empty_response',
              error: 'Empty response from Native Host'
            });
            return;
          }

          resolve(response);
        }
      );
    } catch (err) {
      if (!isResolved) {
        clearTimeout(timer);
        isResolved = true;
        resolve({
          ok: false,
          error: err.message
        });
      }
    }
  });
}

/**
 * Checks if the native host and pass CLI are installed and available.
 */
export async function checkPassHostStatus() {
  return await sendNativeRequest('check');
}

/**
 * Retrieves the list of all entries from ~/.password-store
 */
export async function listPassEntries() {
  return await sendNativeRequest('list');
}

/**
 * Retrieves a single decrypted entry from pass
 */
export async function getPassEntry(entryPath) {
  return await sendNativeRequest('get', { path: entryPath });
}

/**
 * Inserts or updates an entry in pass
 */
export async function insertPassEntry(entryPath, content) {
  return await sendNativeRequest('insert', { path: entryPath, content });
}

/**
 * Deletes an entry from pass
 */
export async function deletePassEntry(entryPath) {
  return await sendNativeRequest('delete', { path: entryPath });
}

/**
 * Full synchronization: reads all entries from ~/.password-store
 * and converts them into normalized SimplePass items for a project.
 */
export async function syncAllPassEntries(projectId) {
  const res = await sendNativeRequest('sync_all');
  if (!res.ok || !Array.isArray(res.items)) {
    throw new Error(res.error || 'Failed to sync entries from PASS CLI');
  }

  const items = res.items.map(raw => {
    // Parse title and category from entry path (e.g., "Work/github" or "google")
    const parts = raw.path.split('/');
    let title = parts[parts.length - 1];
    let category = parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : 'General';

    const parsedItem = passFormatToItem(title, raw.content, projectId);
    parsedItem.category = category;
    parsedItem.entryPath = raw.path; // Store the original relative pass path
    return parsedItem;
  });

  return items;
}

/**
 * Saves a SimplePass item directly to the local pass CLI.
 */
export async function saveItemToPassCli(item) {
  const categoryPrefix = item.category && item.category !== 'General' && item.category !== 'All'
    ? `${item.category}/`
    : '';
  const safeTitle = item.title.replace(/[\/\\]/g, '-');
  const entryPath = item.entryPath || `${categoryPrefix}${safeTitle}`;
  const passContent = itemToPassFormat(item);

  const res = await insertPassEntry(entryPath, passContent);
  if (!res.ok) {
    throw new Error(res.error || `Failed to save entry "${entryPath}" in pass`);
  }
  return { ...item, entryPath };
}

/**
 * Removes a SimplePass item from the local pass CLI.
 */
export async function deleteItemFromPassCli(item) {
  if (!item.entryPath && !item.title) return;
  const path = item.entryPath || item.title;
  const res = await deletePassEntry(path);
  if (!res.ok) {
    throw new Error(res.error || `Failed to delete entry "${path}" from pass`);
  }
}
