/**
 * SimplePass Manager - Standalone Generator View Component
 */

import { generatePassword } from '../../core/generator.js';
import { t } from '../../core/i18n.js';
import * as icons from '../../icons/icons.js';
import { panelState } from '../panel-state.js';

export function renderGeneratorView() {
  if (!panelState.currentGeneratedPassword) {
    panelState.currentGeneratedPassword = generatePassword(panelState.genOptions);
  }

  return `
    <div class="sp-view-container">
      <div class="sp-gen-result-card">
        <div style="display:flex; justify-content:flex-end; align-items:center;">
          <div style="display:flex; gap:4px;">
            <button class="sp-btn-icon" id="sp-gen-refresh" title="${t('generator.refresh_title')}">${icons.iRefresh}</button>
            <button class="sp-btn-icon" id="sp-gen-copy" title="${t('generator.copy_title')}">${icons.iCopy}</button>
          </div>
        </div>
        <div class="sp-gen-password-display" id="sp-gen-display">${panelState.currentGeneratedPassword}</div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="sp-form-group">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <label class="sp-label" style="margin:0;">${t('generator.length_label')}</label>
            <span style="font-size:13px; font-weight:700; color:var(--text-main);" id="sp-length-val">${panelState.genOptions.length}</span>
          </div>
          <input type="range" id="sp-slider-len" min="8" max="64" value="${panelState.genOptions.length}" style="width:100%; accent-color:var(--text-main); cursor:pointer;" />
        </div>

        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.uppercase')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-upper" ${panelState.genOptions.useUpper ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.lowercase')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-lower" ${panelState.genOptions.useLower ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.numbers')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-digits" ${panelState.genOptions.useDigits ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.symbols')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-symbols" ${panelState.genOptions.useSymbols ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">${t('generator.avoid_ambiguous')}</span>
          <label class="sp-liquid-switch">
            <input type="checkbox" id="sp-chk-ambig" ${panelState.genOptions.avoidAmbiguous ? 'checked' : ''} />
            <span class="sp-liquid-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}
