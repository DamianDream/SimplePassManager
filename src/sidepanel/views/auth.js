/**
 * SimplePass Manager - Auth View (Setup, Unlock, Recovery, Profile Select)
 */

import { state } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState, getRemainingLockoutSeconds } from '../panel-state.js';
import { escapeHtml } from '../render-utils.js';

export function renderAuthView() {
  // 1. First-time initialization screen
  if (!state.isInitialized) {
    return `
      <div class="sp-auth-screen">
        <div class="sp-auth-box">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.create_profile_title')}</h2>
          <p class="sp-auth-desc">${t('auth.create_profile_desc')}</p>
          <form class="sp-auth-form" id="sp-init-form" novalidate>
            <div>
              <input type="text" id="sp-init-proj-name" class="sp-input" placeholder="${t('auth.profile_name_placeholder')}" />
              <div class="sp-field-error" id="sp-err-proj-name"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-pwd"></div>
              <div id="sp-init-pwd-strength"></div>
            </div>
            <div>
              <input type="password" id="sp-init-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${t('auth.create_profile_btn')}
            </button>
          </form>
        </div>
      </div>
    `;
  }

  // 2. New Database Creation from Lock Screen / Recovery
  if (panelState.isCreatingNewVaultFromLock) {
    return `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.new_db_title')}</h2>
          <p class="sp-auth-desc">${t('auth.new_db_desc')}</p>

          <form class="sp-auth-form" id="sp-new-db-form" novalidate>
            <div>
              <input type="text" id="sp-new-db-name" class="sp-input" placeholder="${t('auth.db_name_placeholder')}" autofocus />
              <div class="sp-field-error" id="sp-err-new-db-name"></div>
            </div>
            <div>
              <input type="password" id="sp-new-db-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-new-db-pwd"></div>
              <div id="sp-new-db-pwd-strength"></div>
            </div>
            <div>
              <input type="password" id="sp-new-db-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-new-db-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iPlus} ${t('auth.create_and_enter_btn')}
            </button>
            <div style="text-align:center; margin-top: 8px;">
              <button type="button" class="sp-link-btn" id="sp-btn-cancel-new-db">${t('auth.cancel_btn')}</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // 3. Recovery screen view
  if (panelState.isRecoveryViewActive) {
    return `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.recovery_title')}</h2>
          <p class="sp-auth-desc">${t('auth.recovery_desc')}</p>

          <form class="sp-auth-form" id="sp-recovery-form" novalidate>
            <div>
              <textarea id="sp-recover-phrase" class="sp-input" style="height: 72px; resize:none; font-family:monospace; font-size:12px; line-height:1.4;" placeholder="${t('auth.recovery_phrase_placeholder')}"></textarea>
              <div class="sp-field-error" id="sp-err-recover-phrase"></div>
              <div id="sp-recover-phrase-hints" style="font-size:11px; margin-top:4px;"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd" class="sp-input" placeholder="${t('auth.master_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-recover-pwd"></div>
              <div id="sp-recover-new-pwd-strength"></div>
            </div>
            <div>
              <input type="password" id="sp-recover-new-pwd2" class="sp-input" placeholder="${t('auth.repeat_pwd_placeholder')}" />
              <div class="sp-field-error" id="sp-err-recover-pwd2"></div>
            </div>
            <button type="submit" class="sp-btn-primary" style="justify-content:center; margin-top: 6px;">
              ${icons.iUnlock} ${t('auth.restore_access_btn')}
            </button>
            <button type="button" class="sp-btn-secondary" id="sp-btn-create-new-vault" style="width:100%; justify-content:center; margin-top: 8px;">
              ${icons.iPlus} ${t('auth.create_new_db_btn')}
            </button>
            <div style="text-align:center; margin-top: 8px;">
              <button type="button" class="sp-link-btn" id="sp-btn-cancel-recovery">${t('auth.return_to_login_btn')}</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // 4. Profile Selector Screen
  if (panelState.isProfileSelectorViewActive) {
    return `
      <div class="sp-auth-screen">
        <div class="sp-auth-box" style="max-width: 360px;">
          <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:48px;height:48px;display:block;object-fit:contain;" alt="Logo" /></div>
          <h2 class="sp-auth-title">${t('auth.select_profile_title')}</h2>
          <p class="sp-auth-desc">${t('auth.select_profile_desc')}</p>

          <div class="sp-profile-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px; width:100%;">
            ${panelState.cachedVaultProfiles.map(p => `
              <div class="sp-profile-select-item ${p.id === panelState.cachedActiveVaultId ? 'active' : ''}" data-vault-id="${p.id}">
                <div style="display:flex; align-items:center; gap:10px;">
                  <span style="font-size:16px;">🗄️</span>
                  <span style="font-weight:${p.id === panelState.cachedActiveVaultId ? '600' : '500'}; font-size:13px; color:var(--text-main);">${escapeHtml(p.name)}</span>
                </div>
                ${p.id === panelState.cachedActiveVaultId ? '<span style="color:var(--sp-primary); font-weight:bold; font-size:13px;">✓</span>' : ''}
              </div>
            `).join('')}
          </div>

          <button type="button" class="sp-btn-secondary" id="sp-btn-profile-create-new" style="width:100%; justify-content:center; margin-bottom:10px;">
            ${icons.iPlus} ${t('auth.create_new_db_btn')}
          </button>

          <div style="text-align:center;">
            <button type="button" class="sp-link-btn" id="sp-btn-cancel-profile-select">${t('auth.return_to_login_btn')}</button>
          </div>
        </div>
      </div>
    `;
  }

  // 5. Normal Lock Screen with exponential delay lockout
  const remSec = getRemainingLockoutSeconds();
  const isLockedOut = remSec > 0;

  return `
    <div class="sp-auth-screen">
      <div class="sp-auth-box">
        <div class="sp-auth-logo"><img src="icons/icon-128.png" style="width:52px;height:52px;display:block;object-fit:contain;" alt="Logo" /></div>
        <h2 class="sp-auth-title">${t('auth.locked_title')}</h2>
        <p class="sp-auth-desc">${t('auth.locked_desc')}</p>

        ${isLockedOut ? `
          <div class="sp-lockout-alert" id="sp-lockout-msg">
            ${t('auth.lockout_wait', { seconds: `<span id="sp-lockout-seconds" style="font-weight:bold;">${remSec}</span>` })}
          </div>
        ` : ''}

        <form class="sp-auth-form" id="sp-unlock-form" novalidate>
          <div>
            <input type="password" id="sp-unlock-pwd" class="sp-input" placeholder="${t('settings.master_pwd_label')}" ${isLockedOut ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'autofocus'} />
            <div class="sp-field-error" id="sp-err-unlock" ${panelState.failedAttempts > 0 && !isLockedOut ? 'style="display:block;"' : ''}>${panelState.failedAttempts > 0 && !isLockedOut ? t('auth.lockout_attempt_error', { current: panelState.failedAttempts }) : ''}</div>
          </div>

          <button type="submit" class="sp-btn-primary" ${isLockedOut ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} style="justify-content:center; margin-top: 6px;">
            ${icons.iUnlock} ${t('auth.unlock_btn')}
          </button>

          <div id="sp-auth-links-wrap" style="text-align:center; margin-top: 10px; display:flex; flex-direction:column; gap:6px; align-items:center;">
            <button type="button" class="sp-link-btn" id="sp-forgot-pwd">${t('auth.forgot_pwd_btn')}</button>
            <button type="button" class="sp-link-btn" id="sp-switch-profile" style="color:var(--text-dim); font-size:12px;">${t('auth.switch_profile_btn')}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}
