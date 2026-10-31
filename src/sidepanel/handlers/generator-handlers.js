/**
 * SimplePass Manager - Standalone Generator View Event Handlers
 */

import { generatePassword } from '../../core/generator.js';
import { copyToClipboard } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { panelState } from '../panel-state.js';
import { showToast } from '../render-utils.js';

export function attachGeneratorHandlers() {
  const display = document.getElementById('sp-gen-display');
  const slider = document.getElementById('sp-slider-len');
  const lengthVal = document.getElementById('sp-length-val');

  const refreshPassword = () => {
    panelState.currentGeneratedPassword = generatePassword(panelState.genOptions);
    if (display) {
      display.innerText = panelState.currentGeneratedPassword;
    }
  };

  if (slider) {
    slider.addEventListener('input', e => {
      const len = parseInt(e.target.value, 10);
      panelState.genOptions.length = len;
      if (lengthVal) lengthVal.innerText = len;
      refreshPassword();
    });
  }

  const toggleIds = [
    { id: 'sp-chk-upper', prop: 'useUpper' },
    { id: 'sp-chk-lower', prop: 'useLower' },
    { id: 'sp-chk-digits', prop: 'useDigits' },
    { id: 'sp-chk-symbols', prop: 'useSymbols' },
    { id: 'sp-chk-ambig', prop: 'avoidAmbiguous' }
  ];

  toggleIds.forEach(({ id, prop }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', e => {
        panelState.genOptions[prop] = e.target.checked;
        refreshPassword();
      });
    }
  });

  const btnRefresh = document.getElementById('sp-gen-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshPassword();
    });
  }

  const btnCopy = document.getElementById('sp-gen-copy');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (panelState.currentGeneratedPassword) {
        copyToClipboard(panelState.currentGeneratedPassword);
        showToast(t('toasts.pwd_copied'));
        if (typeof chrome !== 'undefined' && chrome.alarms) {
          chrome.alarms.create('clearClipboardAlarm', { delayInMinutes: 0.5 });
        }
      }
    });
  }
}
