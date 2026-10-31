/**
 * SimplePass Manager - Auth Event Handlers & Cryptographic Unlock Pipeline
 */

import { state, updateState } from '../../core/state.js';
import {
  validateMasterPassword,
  validateRecoveryPhraseWords,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  decryptVault,
  decryptVaultWithRecovery,
  generateMek,
  wrapMek,
  unwrapMekWithPassword,
  encryptVaultWithMek,
  decryptVaultWithMek
} from '../../core/crypto.js';
import {
  getStoredVault,
  saveStoredVault,
  getStoredConfig,
  saveStoredConfig,
  normalizeVaultData,
  getVaultProfiles,
  getActiveVaultId,
  setActiveVaultId,
  createVaultProfile
} from '../../core/storage.js';
import { createSession } from '../../core/session.js';
import { generatePassword } from '../../core/generator.js';
import { t } from '../../core/i18n.js';
import { panelState, getRemainingLockoutSeconds } from '../panel-state.js';
import {
  showFieldError,
  clearFieldErrors,
  showToast,
  renderPasswordStrengthBar,
  escapeHtml
} from '../render-utils.js';

export function attachAuthHandlers({ onReRenderAuth, syncCachedFavicons }) {
  // 1. Initial profile creation form
  if (!state.isInitialized) {
    ['sp-init-proj-name', 'sp-init-pwd', 'sp-init-pwd2'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('input', () => {
          inp.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-init-', 'sp-err-'));
          if (errEl) {
            errEl.innerText = '';
            errEl.style.display = 'none';
          }
        });
      }
    });
    renderPasswordStrengthBar('sp-init-pwd', 'sp-init-pwd-strength');

    const initForm = document.getElementById('sp-init-form');
    if (initForm) {
      initForm.addEventListener('submit', async e => {
        e.preventDefault();
        const proj = document.getElementById('sp-init-proj-name')?.value;
        const p1 = document.getElementById('sp-init-pwd')?.value;
        const p2 = document.getElementById('sp-init-pwd2')?.value;
        await handleCreateVault(proj, p1, p2, onReRenderAuth);
      });
    }
    return;
  }

  // 2. Additional DB creation form
  if (panelState.isCreatingNewVaultFromLock) {
    ['sp-new-db-name', 'sp-new-db-pwd', 'sp-new-db-pwd2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          el.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-new-db-', 'sp-err-new-db-'));
          if (errEl) { errEl.innerText = ''; errEl.style.display = 'none'; }
        });
      }
    });
    renderPasswordStrengthBar('sp-new-db-pwd', 'sp-new-db-pwd-strength');

    const btnCancelNew = document.getElementById('sp-btn-cancel-new-db');
    if (btnCancelNew) {
      btnCancelNew.addEventListener('click', () => {
        panelState.isCreatingNewVaultFromLock = false;
        onReRenderAuth();
      });
    }

    const newDbForm = document.getElementById('sp-new-db-form');
    if (newDbForm) {
      newDbForm.addEventListener('submit', async e => {
        e.preventDefault();
        const dbName = document.getElementById('sp-new-db-name')?.value;
        const p1 = document.getElementById('sp-new-db-pwd')?.value;
        const p2 = document.getElementById('sp-new-db-pwd2')?.value;
        await handleCreateAdditionalVault(dbName, p1, p2, onReRenderAuth);
      });
    }
    return;
  }

  // 3. Recovery form
  if (panelState.isRecoveryViewActive) {
    ['sp-recover-phrase', 'sp-recover-new-pwd', 'sp-recover-new-pwd2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          el.classList.remove('has-error');
          const errEl = document.getElementById(id.replace('sp-recover-', 'sp-err-recover-'));
          if (errEl) { errEl.innerText = ''; errEl.style.display = 'none'; }
        });
      }
    });
    renderPasswordStrengthBar('sp-recover-new-pwd', 'sp-recover-new-pwd-strength');

    const recoverPhraseEl = document.getElementById('sp-recover-phrase');
    const recoverHintsEl = document.getElementById('sp-recover-phrase-hints');
    if (recoverPhraseEl && recoverHintsEl) {
      recoverPhraseEl.addEventListener('input', () => {
        const val = recoverPhraseEl.value.trim();
        if (!val) {
          recoverHintsEl.innerHTML = '';
          return;
        }
        const checks = validateRecoveryPhraseWords(val);
        const issues = checks.filter(c => !c.valid);
        if (issues.length === 0) {
          const count = checks.length;
          recoverHintsEl.innerHTML = `<span style="color:var(--success); font-size:11px;">✓ ${t('auth.words_recognized', { count })}</span>`;
        } else {
          recoverHintsEl.innerHTML = issues.map(iss => {
            const sugg = iss.suggestion ? ` (${t('auth.suggest_word', { suggestion: escapeHtml(iss.suggestion) })})` : '';
            return `<div style="color:var(--danger, #ef4444); margin-bottom:2px; font-size:11px;">⚠️ ${t('auth.unknown_word', { word: escapeHtml(iss.word) })}${sugg}</div>`;
          }).join('');
        }
      });
    }

    const btnCreateNewVault = document.getElementById('sp-btn-create-new-vault');
    if (btnCreateNewVault) {
      btnCreateNewVault.addEventListener('click', () => {
        panelState.isRecoveryViewActive = false;
        panelState.isCreatingNewVaultFromLock = true;
        onReRenderAuth();
      });
    }

    const btnCancel = document.getElementById('sp-btn-cancel-recovery');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        panelState.isRecoveryViewActive = false;
        onReRenderAuth();
      });
    }

    const recoveryForm = document.getElementById('sp-recovery-form');
    if (recoveryForm) {
      recoveryForm.addEventListener('submit', async e => {
        e.preventDefault();
        const phrase = document.getElementById('sp-recover-phrase')?.value;
        const p1 = document.getElementById('sp-recover-new-pwd')?.value;
        const p2 = document.getElementById('sp-recover-new-pwd2')?.value;
        await handleRestoreWithRecovery(phrase, p1, p2, syncCachedFavicons);
      });
    }
    return;
  }

  // 4. Profile Selector
  if (panelState.isProfileSelectorViewActive) {
    document.querySelectorAll('.sp-profile-select-item').forEach(el => {
      el.addEventListener('click', async () => {
        const vId = el.dataset.vaultId;
        if (vId && vId !== panelState.cachedActiveVaultId) {
          panelState.cachedActiveVaultId = vId;
          await setActiveVaultId(vId);
          panelState.failedAttempts = 0;
          panelState.lockoutUntil = 0;
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
          }
        }
        panelState.isProfileSelectorViewActive = false;
        onReRenderAuth();
      });
    });

    const btnNew = document.getElementById('sp-btn-profile-create-new');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        panelState.isProfileSelectorViewActive = false;
        panelState.isCreatingNewVaultFromLock = true;
        onReRenderAuth();
      });
    }

    const btnCancel = document.getElementById('sp-btn-cancel-profile-select');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        panelState.isProfileSelectorViewActive = false;
        onReRenderAuth();
      });
    }
    return;
  }

  // 5. Standard Lock screen
  if (panelState.lockoutTimer) {
    clearInterval(panelState.lockoutTimer);
    panelState.lockoutTimer = null;
  }

  const remSec = getRemainingLockoutSeconds();
  const isLockedOut = remSec > 0;

  if (isLockedOut) {
    panelState.lockoutTimer = setInterval(() => {
      const currentRem = getRemainingLockoutSeconds();
      const secEl = document.getElementById('sp-lockout-seconds');
      if (secEl) secEl.innerText = currentRem;
      if (currentRem <= 0) {
        clearInterval(panelState.lockoutTimer);
        panelState.lockoutTimer = null;
        onReRenderAuth();
      }
    }, 1000);
  }

  const switchProfileBtn = document.getElementById('sp-switch-profile');
  if (switchProfileBtn) {
    switchProfileBtn.addEventListener('click', () => {
      panelState.isProfileSelectorViewActive = true;
      onReRenderAuth();
    });
  }

  const unlockInp = document.getElementById('sp-unlock-pwd');
  if (unlockInp) {
    unlockInp.addEventListener('input', () => {
      unlockInp.classList.remove('has-error');
      const errEl = document.getElementById('sp-err-unlock');
      if (errEl) {
        errEl.innerText = '';
        errEl.style.display = 'none';
      }
    });
  }

  const forgotBtn = document.getElementById('sp-forgot-pwd');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      panelState.isRecoveryViewActive = true;
      onReRenderAuth();
    });
  }

  const unlockForm = document.getElementById('sp-unlock-form');
  if (unlockForm) {
    unlockForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (getRemainingLockoutSeconds() > 0) return;
      const p = document.getElementById('sp-unlock-pwd')?.value || '';
      await handleUnlock(p, { onReRenderAuth, syncCachedFavicons });
    });
  }
}

export async function handleUnlock(password, { onReRenderAuth, syncCachedFavicons }) {
  clearFieldErrors();
  const remainingSec = getRemainingLockoutSeconds();
  if (remainingSec > 0) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', t('auth.lockout_wait', { seconds: remainingSec }));
    onReRenderAuth();
    return;
  }

  if (!password) {
    showFieldError('sp-unlock-pwd', 'sp-err-unlock', t('auth.pwd_empty'));
    return;
  }

  try {
    const envelope = await getStoredVault();
    let rawMek = null;
    let keySlots = null;
    let decrypted = null;

    if ((envelope.version === 2 || envelope.version === 3) && envelope.keyByPassword) {
      rawMek = await unwrapMekWithPassword(envelope, password);
      decrypted = await decryptVaultWithMek(envelope, rawMek);
      if (envelope.version === 2) {
        const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
        const keyByRecovery = envelope.keyByRecovery
          ? { ...envelope.keyByRecovery, aad: false }
          : null;
        keySlots = { keyByPassword, keyByRecovery };
        const v3Envelope = await encryptVaultWithMek(decrypted, rawMek, keySlots);
        await saveStoredVault(v3Envelope);
      } else {
        keySlots = {
          keyByPassword: envelope.keyByPassword,
          keyByRecovery: envelope.keyByRecovery
        };
      }
    } else {
      decrypted = await decryptVault(envelope, password);
      rawMek = generateMek();
      const newRecPhrase = generateRecoveryPhrase();
      const keyByPwd = await wrapMek(rawMek, password, 'mek-pwd');
      const keyByRec = await wrapMek(rawMek, normalizeRecoveryPhrase(newRecPhrase), 'mek-rec');
      keySlots = { keyByPassword: keyByPwd, keyByRecovery: keyByRec };
      const v3Envelope = await encryptVaultWithMek(decrypted, rawMek, keySlots);
      await saveStoredVault(v3Envelope);
      panelState.newlyCreatedRecoveryPhrase = newRecPhrase;
      showToast(t('toasts.vault_migrated_v3'));
    }

    const normalized = normalizeVaultData(decrypted);
    if (syncCachedFavicons) syncCachedFavicons(normalized.items);
    const storedConfig = await getStoredConfig();

    const initialProjectId =
      storedConfig.latestProjectId && normalized.projects.some(p => p.id === storedConfig.latestProjectId)
        ? storedConfig.latestProjectId
        : normalized.projects[0].id;

    panelState.failedAttempts = 0;
    panelState.lockoutUntil = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
    }

    const session = await createSession(rawMek, state.lockInterval || 'session');

    updateState({
      isUnlocked: true,
      rawMek,
      keySlots,
      projects: normalized.projects,
      items: normalized.items,
      trash: normalized.trash || [],
      activeProjectId: initialProjectId,
      sessionExpiresAt: session.expiresAt
    });
  } catch (err) {
    panelState.failedAttempts++;
    if (panelState.failedAttempts >= 3) {
      const delaySec = Math.min(600, 30 * Math.pow(2, panelState.failedAttempts - 3));
      panelState.lockoutUntil = Date.now() + delaySec * 1000;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({
        sp_failed_attempts: panelState.failedAttempts,
        sp_lockout_until: panelState.lockoutUntil
      });
    }

    const remaining = getRemainingLockoutSeconds();
    if (remaining > 0) {
      onReRenderAuth();
    } else {
      showFieldError('sp-unlock-pwd', 'sp-err-unlock', t('auth.lockout_attempt_error', { current: panelState.failedAttempts }));
      const forgotWrap = document.getElementById('sp-auth-links-wrap');
      if (forgotWrap) forgotWrap.style.display = 'flex';
    }
  }
}

export async function handleCreateVault(projectName, password, confirmPassword, onReRenderAuth) {
  clearFieldErrors();

  const pwdVal = validateMasterPassword(password);
  if (!pwdVal.valid) {
    showFieldError('sp-init-pwd', 'sp-err-pwd', t(`auth.${pwdVal.errorCode}`) || pwdVal.error);
    return;
  }
  if (password !== confirmPassword) {
    showFieldError('sp-init-pwd2', 'sp-err-pwd2', t('auth.pwd_mismatch'));
    return;
  }

  const projId = 'proj_' + Date.now();
  const now = new Date().toISOString();
  const profileName = (projectName && projectName.trim()) || 'main';

  const initialProject = {
    id: projId,
    name: profileName,
    type: 'browser',
    createdAt: now,
    updatedAt: now
  };

  const initialData = {
    version: 2,
    createdAt: now,
    updatedAt: now,
    projects: [initialProject],
    items: [
      {
        id: 'item_sample_1',
        projectId: projId,
        title: 'GitHub',
        username: 'developer@example.com',
        password: generatePassword({ length: 24 }),
        url: 'https://github.com',
        category: 'Work',
        notes: '',
        updatedAt: now
      }
    ]
  };

  const recoveryPhrase = generateRecoveryPhrase();
  const rawMek = generateMek();
  const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
  const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(recoveryPhrase), 'mek-rec');
  const keySlots = { keyByPassword, keyByRecovery };
  const encrypted = await encryptVaultWithMek(initialData, rawMek, keySlots);
  await saveStoredVault(encrypted);

  panelState.cachedVaultProfiles = await getVaultProfiles();
  panelState.cachedActiveVaultId = await getActiveVaultId();
  await saveStoredConfig({
    activeProjectId: projId,
    latestProjectId: projId,
    lockInterval: 'session'
  });

  const session = await createSession(rawMek, 'session');
  panelState.failedAttempts = 0;
  panelState.lockoutUntil = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
  }

  panelState.newlyCreatedRecoveryPhrase = recoveryPhrase;
  updateState({
    isInitialized: true,
    isUnlocked: true,
    rawMek,
    keySlots,
    projects: initialData.projects,
    items: initialData.items,
    activeProjectId: projId,
    sessionExpiresAt: session.expiresAt
  });
}

export async function handleCreateAdditionalVault(projectName, password, confirmPassword, onReRenderAuth) {
  clearFieldErrors();

  const pwdVal = validateMasterPassword(password);
  if (!pwdVal.valid) {
    showFieldError('sp-new-db-pwd', 'sp-err-new-db-pwd', t(`auth.${pwdVal.errorCode}`) || pwdVal.error);
    return;
  }
  if (password !== confirmPassword) {
    showFieldError('sp-new-db-pwd2', 'sp-err-new-db-pwd2', t('auth.pwd_mismatch'));
    return;
  }

  const projId = 'proj_' + Date.now();
  const now = new Date().toISOString();
  const dbName = (projectName && projectName.trim()) || ('Vault ' + (panelState.cachedVaultProfiles.length + 1));

  const initialProject = {
    id: projId,
    name: dbName,
    type: 'browser',
    createdAt: now,
    updatedAt: now
  };

  const initialData = {
    version: 2,
    createdAt: now,
    updatedAt: now,
    projects: [initialProject],
    items: [
      {
        id: 'item_sample_1',
        projectId: projId,
        title: 'SimplePass',
        username: 'user@example.com',
        password: generatePassword({ length: 24 }),
        url: 'https://example.com',
        category: 'Work',
        notes: '',
        updatedAt: now
      }
    ]
  };

  const recoveryPhrase = generateRecoveryPhrase();
  const rawMek = generateMek();
  const keyByPassword = await wrapMek(rawMek, password, 'mek-pwd');
  const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(recoveryPhrase), 'mek-rec');
  const keySlots = { keyByPassword, keyByRecovery };
  const encrypted = await encryptVaultWithMek(initialData, rawMek, keySlots);

  const newProfile = await createVaultProfile(dbName, encrypted);
  panelState.cachedVaultProfiles = await getVaultProfiles();
  panelState.cachedActiveVaultId = newProfile.id;

  const session = await createSession(rawMek, 'session');
  panelState.failedAttempts = 0;
  panelState.lockoutUntil = 0;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
  }

  panelState.isCreatingNewVaultFromLock = false;
  panelState.isRecoveryViewActive = false;
  panelState.newlyCreatedRecoveryPhrase = recoveryPhrase;

  updateState({
    isInitialized: true,
    isUnlocked: true,
    rawMek,
    keySlots,
    projects: initialData.projects,
    items: initialData.items,
    activeProjectId: projId,
    sessionExpiresAt: session.expiresAt
  });
}

export async function handleRestoreWithRecovery(phrase, newPassword, confirmPassword, syncCachedFavicons) {
  clearFieldErrors();
  const normPhrase = phrase ? phrase.trim().toLowerCase().split(/\s+/).join(' ') : '';
  if (!normPhrase || normPhrase.split(' ').length !== 12) {
    showFieldError('sp-recover-phrase', 'sp-err-recover-phrase', t('auth.recovery_exact_words'));
    return;
  }

  const pwdVal = validateMasterPassword(newPassword);
  if (!pwdVal.valid) {
    showFieldError('sp-recover-new-pwd', 'sp-err-recover-pwd', t(`auth.${pwdVal.errorCode}`) || pwdVal.error);
    return;
  }
  if (newPassword !== confirmPassword) {
    showFieldError('sp-recover-new-pwd2', 'sp-err-recover-pwd2', t('auth.pwd_mismatch'));
    return;
  }

  try {
    const envelope = await getStoredVault();
    const { vaultData, rawMek } = await decryptVaultWithRecovery(envelope, normPhrase);
    const normalized = normalizeVaultData(vaultData);
    if (syncCachedFavicons) syncCachedFavicons(normalized.items);

    const keyByPassword = await wrapMek(rawMek, newPassword, 'mek-pwd');
    const newRecoveryPhrase = generateRecoveryPhrase();
    const keyByRecovery = await wrapMek(rawMek, normalizeRecoveryPhrase(newRecoveryPhrase), 'mek-rec');
    const keySlots = { keyByPassword, keyByRecovery };
    const rekeyedEnvelope = await encryptVaultWithMek(normalized, rawMek, keySlots);
    await saveStoredVault(rekeyedEnvelope);

    panelState.failedAttempts = 0;
    panelState.lockoutUntil = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(['sp_failed_attempts', 'sp_lockout_until']);
    }

    const session = await createSession(rawMek, 'session');
    panelState.isRecoveryViewActive = false;
    panelState.newlyCreatedRecoveryPhrase = newRecoveryPhrase;

    updateState({
      isUnlocked: true,
      rawMek,
      keySlots,
      projects: normalized.projects,
      items: normalized.items,
      trash: normalized.trash || [],
      activeProjectId: normalized.projects[0].id,
      sessionExpiresAt: session.expiresAt
    });
    showToast(t('toasts.access_restored'));
  } catch (err) {
    showFieldError('sp-recover-phrase', 'sp-err-recover-phrase', t('auth.recovery_invalid_err'));
  }
}
