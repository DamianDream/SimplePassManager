/**
 * Offscreen Document for Secure Clipboard Operations
 * Executed in isolated offscreen context to wipe clipboard on schedule.
 */

async function clearClipboardData() {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText('');
    } else {
      const el = document.createElement('textarea');
      el.value = '';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
  } catch (_) {}
}

// Clear immediately upon document creation
clearClipboardData();

// Also handle explicit message triggers
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === 'EXEC_CLEAR_CLIPBOARD') {
      clearClipboardData().then(() => sendResponse({ success: true }));
      return true;
    }
  });
}
