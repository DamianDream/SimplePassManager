/**
 * Background Service Worker (Manifest V3)
 * Manages side panel behavior, context menus, and inter-script messaging.
 */

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

// Handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url) {
        try {
          const urlObj = new URL(activeTab.url);
          sendResponse({
            tabId: activeTab.id,
            url: activeTab.url,
            hostname: urlObj.hostname,
            domain: urlObj.hostname.replace(/^www\./, '')
          });
        } catch (_) {
          sendResponse({ tabId: activeTab.id, url: activeTab.url, hostname: '', domain: '' });
        }
      } else {
        sendResponse(null);
      }
    });
    return true; // async response
  }

  if (message.type === 'AUTOFILL_LOGIN') {
    const { tabId, username, password } = message;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'DO_AUTOFILL', username, password }, res => {
        sendResponse(res);
      });
      return true;
    }
  }
});
