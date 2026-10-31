/**
 * SimplePass Manager - Transient Panel State & Context
 * Shared state across modular views and event handlers.
 */

export const panelState = {
  // Active tab info
  activeTabDomain: '',
  activeTabFavicon: '',
  activeTabId: null,
  activeTabUrl: '',
  isAutofillSupported: false,
  cachedFavicons: {},

  // Navigation / Drawer
  isDrawerOpen: false,

  // Lockout & Auth View Routing
  failedAttempts: 0,
  lockoutUntil: 0,
  lockoutTimer: null,
  isRecoveryViewActive: false,
  newlyCreatedRecoveryPhrase: null,

  // Multi-Vault Profiles in Auth
  cachedVaultProfiles: [],
  cachedActiveVaultId: null,
  isCreatingNewVaultFromLock: false,
  isProfileSelectorViewActive: false,

  // Generator Options
  genOptions: {
    length: 20,
    useUpper: true,
    useLower: true,
    useDigits: true,
    useSymbols: true,
    avoidAmbiguous: false
  },
  currentGeneratedPassword: '',

  // Password visibility in forms
  isPasswordVisible: false,

  // Settings State
  settingsSearchQuery: '',
  openSections: new Set(),
  isChangePwdOpen: false,
  isCustomSelectOpen: false,
  isAutolockSelectOpen: false,
  isLangSelectOpen: false,
  isExportFormatSelectOpen: false,
  selectedExportFormat: 'spbackup',
  isExportAdvancedOpen: false,
  exportModalData: null,
  importBackupData: null,
  exportSelectedTags: new Set(),
  selectedNewCatColor: 'amber',
  activeColorPickerCat: null,
  editingTagId: null,

  // Item Form State & Draft
  formSelectedTags: [],
  currentFormItemId: null,
  currentFormItemPassword: '',
  formDraft: null,

  // Security Audit State (F3)
  securitySearchQuery: '',
  securityActiveTag: 'All',
  securityActiveRiskFilter: 'all',
  isSecurityLegendOpen: true,
  securityAuditReport: null,
  isAuditing: false
};

export function getRemainingLockoutSeconds() {
  if (panelState.lockoutUntil && Date.now() < panelState.lockoutUntil) {
    return Math.ceil((panelState.lockoutUntil - Date.now()) / 1000);
  }
  return 0;
}

export function saveFormDraftFromDOM() {
  const form = document.getElementById('sp-item-form');
  if (!form) return;

  const id = document.getElementById('sp-item-id')?.value || '';
  const title = document.getElementById('sp-item-title')?.value || '';
  const username = document.getElementById('sp-item-username')?.value || '';
  const password = document.getElementById('sp-item-password')?.value || panelState.currentFormItemPassword || '';
  const url = document.getElementById('sp-item-url')?.value || '';
  const notes = document.getElementById('sp-item-notes')?.value || '';
  const projectId = document.getElementById('sp-item-project')?.value || '';
  const isNew = !id;

  panelState.formDraft = {
    id,
    isNew,
    projectId,
    title,
    username,
    password,
    url,
    notes,
    tags: [...panelState.formSelectedTags]
  };
}

export function clearFormDraft() {
  panelState.formDraft = null;
  panelState.formSelectedTags = [];
  panelState.currentFormItemId = null;
  panelState.currentFormItemPassword = '';
  panelState.isPasswordVisible = false;
}
