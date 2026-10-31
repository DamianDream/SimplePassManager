/**
 * SimplePass Manager - Modal & Slide-over Panel Handlers
 */

import { state, updateState, switchProject, createProject, renameProject, deleteProjectCascade, copyToClipboard } from '../../core/state.js';
import { encryptVault, decryptVault, unwrapMekWithPassword } from '../../core/crypto.js';
import { getStoredVault, itemsToCsv, itemsToBitwardenJson, normalizeVaultData } from '../../core/storage.js';
import { t } from '../../core/i18n.js';
import { panelState } from '../panel-state.js';
import { showToast } from '../render-utils.js';
import { persistVaultChanges } from '../vault-operations.js';

export function attachAllModalHandlers({ renderApp, handleSyncPassProject }) {
  // 1. Recovery Phrase Backup Modal
  const recoveryCloseBtn = document.getElementById('sp-recovery-modal-close');
  const recoveryConfirmBtn = document.getElementById('sp-btn-confirm-recovery-saved');
  [recoveryCloseBtn, recoveryConfirmBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        panelState.newlyCreatedRecoveryPhrase = null;
        renderApp();
      });
    }
  });

  const recoveryCopyBtn = document.getElementById('sp-btn-copy-recovery-phrase');
  if (recoveryCopyBtn && panelState.newlyCreatedRecoveryPhrase) {
    recoveryCopyBtn.addEventListener('click', () => {
      copyToClipboard(panelState.newlyCreatedRecoveryPhrase);
      showToast(t('toasts.recovery_words_copied'));
    });
  }

  const recoveryDownloadBtn = document.getElementById('sp-btn-download-recovery-phrase');
  if (recoveryDownloadBtn && panelState.newlyCreatedRecoveryPhrase) {
    recoveryDownloadBtn.addEventListener('click', () => {
      const content = `SimplePass Recovery Key (12 Words)\nGenerated: ${new Date().toISOString()}\n\n${panelState.newlyCreatedRecoveryPhrase}\n\n${t('recovery_modal.safe_warning')}`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simplepass-recovery-key-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('recovery_modal.file_saved'));
    });
  }

  // 2. Project Switcher Panel
  const closePanelBtn = document.getElementById('sp-close-project-panel');
  if (closePanelBtn) {
    closePanelBtn.addEventListener('click', () => {
      updateState({ isProjectSwitcherOpen: false });
      renderApp();
    });
  }

  document.querySelectorAll('[data-action="select-project"]').forEach(el => {
    el.addEventListener('click', () => {
      const pId = el.dataset.projectId;
      switchProject(pId);
      updateState({ isProjectSwitcherOpen: false, selectedItem: null, isEditing: false });
      renderApp();
    });
  });

  document.querySelectorAll('[data-action="rename-project"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const pId = btn.dataset.projectId;
      const proj = state.projects.find(p => p.id === pId);
      if (!proj) return;
      const newName = prompt(t('project_switcher.rename_prompt'), proj.name);
      if (newName && newName.trim() && newName.trim() !== proj.name) {
        renameProject(pId, newName.trim());
        await persistVaultChanges();
        renderApp();
      }
    });
  });

  document.querySelectorAll('[data-action="delete-project"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pId = btn.dataset.projectId;
      const proj = state.projects.find(p => p.id === pId);
      if (!proj) return;
      updateState({ projectToDelete: proj, isProjectSwitcherOpen: false });
      renderApp();
    });
  });

  const createProjForm = document.getElementById('sp-create-project-form');
  if (createProjForm) {
    createProjForm.addEventListener('submit', async e => {
      e.preventDefault();
      const nameInput = document.getElementById('sp-new-project-name');
      const name = nameInput.value.trim();
      if (!name) return;
      const type = document.querySelector('input[name="sp-new-project-type"]:checked')?.value || 'browser';

      const newProj = createProject(name, type);
      await persistVaultChanges();

      if (type === 'pass_cli') {
        showToast(t('toasts.db_created_pass', { name }));
        if (handleSyncPassProject) handleSyncPassProject(newProj.id);
      } else {
        showToast(t('toasts.db_created', { name }));
      }
      renderApp();
    });
  }

  document.querySelectorAll('[data-action="sync-pass-project"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pid = btn.dataset.projectId;
      if (handleSyncPassProject) handleSyncPassProject(pid);
    });
  });

  // 3. Cascade Delete Modal
  const modalCancelBtn = document.getElementById('sp-modal-cancel-btn');
  const modalCloseBtn = document.getElementById('sp-modal-close-btn');
  [modalCancelBtn, modalCloseBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        updateState({ projectToDelete: null });
        renderApp();
      });
    }
  });

  const deleteForm = document.getElementById('sp-delete-project-form');
  if (deleteForm && state.projectToDelete) {
    deleteForm.addEventListener('submit', async e => {
      e.preventDefault();
      const confirmName = document.getElementById('sp-delete-confirm-name').value.trim();
      const confirmPwd = document.getElementById('sp-delete-confirm-pwd').value;
      const errorDiv = document.getElementById('sp-delete-modal-error');
      const proj = state.projectToDelete;

      if (confirmName !== proj.name) {
        if (errorDiv) {
          errorDiv.innerText = t('delete_modal.name_mismatch_err');
          errorDiv.style.display = 'block';
        }
        return;
      }

      try {
        const envelope = await getStoredVault();
        if ((envelope.version === 2 || envelope.version === 3) && envelope.keyByPassword) {
          await unwrapMekWithPassword(envelope, confirmPwd);
        } else {
          await decryptVault(envelope, confirmPwd);
        }
      } catch (_) {
        if (errorDiv) {
          errorDiv.innerText = t('auth.invalid_master_pwd');
          errorDiv.style.display = 'block';
        }
        return;
      }

      deleteProjectCascade(proj.id);
      await persistVaultChanges();
      updateState({ projectToDelete: null });
      renderApp();
      showToast(t('toasts.db_deleted'));
    });
  }

  // 4. PASS CLI Instructions Modal
  const btnClosePassInstructions = document.getElementById('sp-btn-close-pass-instructions');
  const btnAckPassInstructions = document.getElementById('sp-btn-ack-pass-instructions');
  [btnClosePassInstructions, btnAckPassInstructions].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        updateState({ isShowPassInstructions: false });
        renderApp();
      });
    }
  });

  // 5. Export Modal Handlers
  const btnExportModalClose = document.getElementById('sp-export-modal-close');
  const btnExportModalCancel = document.getElementById('sp-export-modal-cancel');
  [btnExportModalClose, btnExportModalCancel].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        panelState.exportModalData = null;
        renderApp();
      });
    }
  });

  const formExportBackup = document.getElementById('sp-export-backup-form');
  if (formExportBackup && panelState.exportModalData) {
    formExportBackup.addEventListener('submit', async e => {
      e.preventDefault();
      const pwdInput = document.getElementById('sp-export-backup-pwd');
      const errEl = document.getElementById('sp-export-modal-err');
      const pwd = pwdInput ? pwdInput.value : '';
      if (!pwd) return;

      try {
        const backupData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: state.projects,
          items: panelState.exportModalData.items
        };
        const encryptedEnvelope = await encryptVault(backupData, pwd, null);
        const content = JSON.stringify(encryptedEnvelope, null, 2);
        const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${panelState.exportModalData.fileName}.spbackup`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('settings.export_spbackup_success'));
        panelState.exportModalData = null;
        renderApp();
      } catch (err) {
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = err.message;
        }
      }
    });
  }

  const formExportPlaintext = document.getElementById('sp-export-plaintext-form');
  if (formExportPlaintext && panelState.exportModalData) {
    formExportPlaintext.addEventListener('submit', async e => {
      e.preventDefault();
      const pwdInput = document.getElementById('sp-export-confirm-pwd');
      const errEl = document.getElementById('sp-export-modal-err');
      const pwd = pwdInput ? pwdInput.value : '';
      if (!pwd) return;

      try {
        const storedVault = await getStoredVault();
        let valid = false;
        if (storedVault) {
          if ((storedVault.version === 2 || storedVault.version === 3) && storedVault.keyByPassword) {
            await unwrapMekWithPassword(storedVault, pwd);
            valid = true;
          } else {
            await decryptVault(storedVault, pwd);
            valid = true;
          }
        }
        if (!valid) {
          if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = t('auth.invalid_pwd_err');
          }
          return;
        }
      } catch (err) {
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = t('auth.invalid_pwd_err');
        }
        return;
      }

      if (panelState.exportModalData.format === 'csv') {
        const csvContent = itemsToCsv(panelState.exportModalData.items);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${panelState.exportModalData.fileName}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('settings.export_csv_success'));
      } else {
        const jsonContent = itemsToBitwardenJson(panelState.exportModalData.items);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${panelState.exportModalData.fileName}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('settings.export_json_success'));
      }
      panelState.exportModalData = null;
      renderApp();
    });
  }

  // 6. Import Backup Modal Handlers
  const btnImportBackupClose = document.getElementById('sp-import-backup-close');
  const btnImportBackupCancel = document.getElementById('sp-import-backup-cancel');
  [btnImportBackupClose, btnImportBackupCancel].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        panelState.importBackupData = null;
        renderApp();
      });
    }
  });

  const formImportBackup = document.getElementById('sp-import-backup-form');
  if (formImportBackup && panelState.importBackupData) {
    formImportBackup.addEventListener('submit', async e => {
      e.preventDefault();
      const pwdInput = document.getElementById('sp-import-backup-pwd');
      const errEl = document.getElementById('sp-import-backup-err');
      const pwd = pwdInput ? pwdInput.value : '';
      if (!pwd) return;

      try {
        const decrypted = await decryptVault(panelState.importBackupData.envelope, pwd);
        const normalized = normalizeVaultData(decrypted);
        const incomingItems = (normalized.items || []).map((item, idx) => ({
          ...item,
          id: item.id || `item_${Date.now()}_${idx}`,
          projectId: panelState.importBackupData.targetProjId || item.projectId || (state.projects[0]?.id || 'proj_default')
        }));

        if (incomingItems.length === 0) {
          if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = t('settings.csv_import_empty');
          }
          return;
        }

        const updatedItems = [...state.items, ...incomingItems];
        updateState({ items: updatedItems });
        await persistVaultChanges();
        showToast(t('settings.csv_import_success', { count: incomingItems.length }));
        panelState.importBackupData = null;
        renderApp();
      } catch (err) {
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = t('auth.invalid_pwd_err');
        }
      }
    });
  }
}
