/**
 * Centralized Reactive Application State
 */

export const state = {
  isInitialized: false,
  isUnlocked: false,
  masterPassword: null,
  items: [],
  categories: ['All', 'Work', 'Personal', 'Servers', 'Finance', 'General'],
  activeCategory: 'All',
  searchQuery: '',
  activeTab: 'vault', // 'vault' | 'generator' | 'settings' | 'item-details'
  selectedItem: null,
  isEditing: false,
  autoLockTimer: null,
  lastActivity: Date.now()
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyStateChange() {
  state.lastActivity = Date.now();
  listeners.forEach(fn => fn(state));
}

export function updateState(partial) {
  Object.assign(state, partial);
  notifyStateChange();
}

export function lockVault() {
  state.isUnlocked = false;
  state.masterPassword = null;
  state.items = [];
  state.selectedItem = null;
  state.isEditing = false;
  state.activeTab = 'vault';
  if (state.autoLockTimer) {
    clearInterval(state.autoLockTimer);
    state.autoLockTimer = null;
  }
  notifyStateChange();
}

/**
 * Copies text to clipboard and optionally schedules auto-clear
 */
export async function copyToClipboard(text, clearAfterSeconds = 30) {
  try {
    await navigator.clipboard.writeText(text);
    if (clearAfterSeconds > 0) {
      setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === text) {
            await navigator.clipboard.writeText('');
          }
        } catch (_) {}
      }, clearAfterSeconds * 1000);
    }
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}
