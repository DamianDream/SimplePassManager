/**
 * Centralized Reactive Application State
 * Handles multi-project isolation, active project switching, cascade deletion, and session synchronization.
 */

import { destroySession } from './session.js';
import { verifyMasterPassword } from './storage.js';

export const state = {
  isInitialized: false,
  isUnlocked: false,
  rawMek: null,
  keySlots: null,
  projects: [],
  activeProjectId: null,
  items: [],
  categories: ['All', 'Work', 'Personal'],
  categoryColors: { Work: 'blue', Personal: 'green' },
  activeCategory: 'All',
  searchQuery: '',
  activeTab: 'vault', // 'vault' | 'generator' | 'settings' | 'item-details'
  selectedItem: null,
  isEditing: false,
  lockInterval: 'session',
  autolockMinutes: 15,
  theme: 'light',
  language: 'ru',
  showCardTags: false,
  showFavicons: true,
  useExternalIcons: false,
  sessionExpiresAt: null,
  isProjectSwitcherOpen: false,
  projectToDelete: null,
  passHostStatus: null,
  isShowPassInstructions: false,
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

/**
 * Returns the currently active project object
 */
export function getActiveProject() {
  if (!state.projects.length) return null;
  return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
}

/**
 * Returns items belonging to the currently active project
 */
export function getActiveProjectItems() {
  const activeProj = getActiveProject();
  if (!activeProj) return [];
  return state.items.filter(item => item.projectId === activeProj.id);
}

/**
 * Switches the active project and remembers selection
 */
export function switchProject(projectId) {
  const found = state.projects.find(p => p.id === projectId);
  if (!found) return;
  state.activeProjectId = found.id;
  state.selectedItem = null;
  state.isEditing = false;
  state.isProjectSwitcherOpen = false;
  notifyStateChange();
}

/**
 * Creates a new project in the active vault
 */
export function createProject(name, type = 'browser') {
  const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const now = new Date().toISOString();
  const newProj = {
    id,
    name: name.trim() || 'New Database',
    type,
    createdAt: now,
    updatedAt: now
  };
  state.projects.push(newProj);
  state.activeProjectId = id;
  state.isProjectSwitcherOpen = false;
  notifyStateChange();
  return newProj;
}

/**
 * Renames an existing project
 */
export function renameProject(projectId, newName) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return false;
  proj.name = newName.trim();
  proj.updatedAt = new Date().toISOString();
  notifyStateChange();
  return true;
}

/**
 * Cascade-deletes a project and all associated credentials after verifying master password.
 * Throws Error on incorrect password or invalid confirmation.
 */
export async function deleteProjectCascade(projectId, enteredPassword, typedProjectName) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) {
    throw new Error('Project not found.');
  }

  if (state.projects.length <= 1) {
    throw new Error('Cannot delete the only project. At least one database must remain.');
  }

  if (typedProjectName.trim() !== proj.name.trim()) {
    throw new Error(`Entered name "${typedProjectName}" does not match project name "${proj.name}".`);
  }

  // Mandatory master password verification
  const isValidPassword = await verifyMasterPassword(enteredPassword);
  if (!isValidPassword) {
    throw new Error('Invalid master password. Operation cancelled.');
  }

  // 1. Remove project
  state.projects = state.projects.filter(p => p.id !== projectId);

  // 2. Cascade delete all items associated with this project
  state.items = state.items.filter(item => item.projectId !== projectId);

  // 3. Fallback active project if the deleted one was active
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0].id;
  }

  state.selectedItem = null;
  state.isEditing = false;
  state.projectToDelete = null;

  notifyStateChange();
  return true;
}

/**
 * Locks vault and wipes memory session
 */
export async function lockVault() {
  await destroySession();
  if (state.rawMek && state.rawMek.fill) {
    try { state.rawMek.fill(0); } catch (_) {}
  }
  state.isUnlocked = false;
  state.rawMek = null;
  state.keySlots = null;
  state.projects = [];
  state.items = [];
  state.activeProjectId = null;
  state.selectedItem = null;
  state.isEditing = false;
  state.activeTab = 'vault';
  state.isProjectSwitcherOpen = false;
  state.projectToDelete = null;
  notifyStateChange();
}

/**
 * Copies text to clipboard and optionally schedules auto-clear
 */
export async function copyToClipboard(text, clearAfterSeconds = 30) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
    const sec = Number(clearAfterSeconds) || 0;
    if (sec > 0 && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SCHEDULE_CLIPBOARD_CLEAR', seconds: sec }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}
