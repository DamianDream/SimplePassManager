/**
 * Background Service Worker (Manifest V3)
 * Manages side panel behavior, context menus, secure messaging, and anti-phishing autofill validation.
 */

import { getRegistrableDomain } from './core/psl.js';

// Secure storage.session: restrict access to trusted extension contexts only
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
}

// Clear in-memory session key when OS locks
if (typeof chrome !== 'undefined' && chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener(state => {
    if (state === 'locked' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove('sp_active_session').catch(() => {});
    }
  });
}

// Enable side panel to open on toolbar icon click
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(err => {
      console.warn('Could not set side panel behavior:', err);
    });
  }

  // Create context menus for quick actions
  if (chrome.contextMenus) {
    chrome.contextMenus.create({
      id: 'sp-open-panel',
      title: 'Open SimplePass Panel',
      contexts: ['all']
    });
  }
});

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'sp-open-panel' && tab?.windowId) {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ windowId: tab.windowId });
      }
    }
  });
}

// Handle runtime messages with sender and origin verification
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Verify sender is our own extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, reason: 'unauthorized_sender' });
    return false;
  }

  if (message.type === 'GET_ACTIVE_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        sendResponse(null);
        return;
      }
      const activeTab = tabs[0];
      if (activeTab && activeTab.url) {
        try {
          const urlObj = new URL(activeTab.url);
          const hostname = urlObj.hostname.toLowerCase();
          const registrable = getRegistrableDomain(hostname);
          sendResponse({
            tabId: activeTab.id,
            url: activeTab.url,
            hostname,
            domain: urlObj.hostname.replace(/^www\./, ''),
            registrableDomain: registrable,
            protocol: urlObj.protocol
          });
        } catch (_) {
          sendResponse({ tabId: activeTab.id, url: activeTab.url, hostname: '', domain: '', registrableDomain: '', protocol: '' });
        }
      } else {
        sendResponse(null);
      }
    });
    return true; // async response
  }

  if (message.type === 'AUTOFILL_LOGIN') {
    const { tabId, itemUrl, username, password, forceFill } = message;
    if (!tabId) {
      sendResponse({ success: false, reason: 'no_tab_id' });
      return false;
    }

    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ success: false, reason: 'tab_not_found' });
        return;
      }

      // Strict Anti-Phishing Domain Verification
      if (itemUrl && tab.url && !forceFill) {
        const tabRegistrable = getRegistrableDomain(tab.url);
        const itemRegistrable = getRegistrableDomain(itemUrl);
        if (tabRegistrable && itemRegistrable && tabRegistrable !== itemRegistrable) {
          sendResponse({
            success: false,
            reason: 'domain_mismatch',
            tabDomain: tabRegistrable,
            itemDomain: itemRegistrable
          });
          return;
        }
      }

      chrome.tabs.sendMessage(tabId, { type: 'DO_AUTOFILL', username, password }, res => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, reason: 'content_script_unavailable', error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res || { success: true });
        }
      });
    });
    return true; // async response
  }
});
