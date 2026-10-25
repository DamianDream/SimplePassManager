/**
 * Centralized Reactive Application State
 * Handles multi-project isolation, active project switching, cascade deletion, and session synchronization.
 */

import { destroySession } from './session.js';
import { verifyMasterPassword } from './storage.js';

export const state = {
  isInitialized: false,
  isUnlocked: false,
  masterPassword: null,
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
  lockInterval: '3days',
  theme: 'light',
  language: 'ru',
  showCardTags: false,
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
    name: name.trim() || 'Новая база',
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
    throw new Error('Проект не найден.');
  }

  if (state.projects.length <= 1) {
    throw new Error('Нельзя удалить единственный проект. В хранилище должна оставаться хотя бы одна база данных.');
  }

  if (typedProjectName.trim() !== proj.name.trim()) {
    throw new Error(`Введенное имя "${typedProjectName}" не совпадает с точным именем проекта "${proj.name}".`);
  }

  // Mandatory master password verification
  const isValidPassword = await verifyMasterPassword(enteredPassword);
  if (!isValidPassword) {
    throw new Error('Неверный мастер-пароль. Операция отменена.');
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
  state.isUnlocked = false;
  state.masterPassword = null;
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
