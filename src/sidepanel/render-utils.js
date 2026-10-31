/**
 * SimplePass Manager - DOM & Render Utilities
 */

import { evaluatePasswordStrength } from '../core/generator.js';
import { t } from '../core/i18n.js';

/**
 * Escapes HTML characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Displays a toast message at the bottom of the sidepanel.
 * @param {string} text
 * @param {number} durationMs
 */
export function showToast(text, durationMs = 2200) {
  let toast = document.getElementById('sp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-toast';
    toast.style.cssText = `
      position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%);
      background: var(--text-main); color: var(--bg-main); font-size: 12px; font-weight: 600;
      border: 1px solid var(--border-subtle);
      padding: 8px 16px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      z-index: 9999; transition: opacity 0.2s ease; pointer-events: none;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = text;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
  }, durationMs);
}

/**
 * Marks an input element with an error state and displays message.
 * @param {string} inputId
 * @param {string} errorId
 * @param {string} message
 */
export function showFieldError(inputId, errorId, message) {
  const inputEl = document.getElementById(inputId);
  const errorEl = document.getElementById(errorId);
  if (inputEl) inputEl.classList.add('has-error');
  if (errorEl) {
    errorEl.innerText = message;
    errorEl.style.display = 'block';
  }
}

/**
 * Clears all error states from inputs and error message containers.
 */
export function clearFieldErrors() {
  document.querySelectorAll('.sp-field-error').forEach(el => {
    el.innerText = '';
    el.style.display = 'none';
  });
  document.querySelectorAll('.sp-input.has-error').forEach(el => {
    el.classList.remove('has-error');
  });
}

/**
 * Applies the given theme to the document body.
 * @param {'light'|'dark'} theme
 */
export function applyTheme(theme) {
  const currentTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(`theme-${currentTheme}`);
}

/**
 * Attaches a dynamic password strength meter to an input.
 * @param {string} inputId
 * @param {string} containerId
 */
export function renderPasswordStrengthBar(inputId, containerId) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;

  const update = () => {
    const val = input.value || '';
    if (!val) {
      container.innerHTML = '';
      return;
    }
    const score = evaluatePasswordStrength(val);
    let color = 'var(--danger, #ef4444)';
    let width = '25%';
    let label = t('generator.weak');

    if (score >= 4) {
      color = 'var(--success, #10b981)';
      width = '100%';
      label = t('generator.strong');
    } else if (score >= 2) {
      color = '#f59e0b';
      width = '60%';
      label = t('generator.medium');
    }

    container.innerHTML = `
      <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
        <div style="height: 3px; width: 100%; background: var(--border-subtle); border-radius: 2px; overflow: hidden;">
          <div style="height: 100%; width: ${width}; background: ${color}; transition: width 0.2s ease, background 0.2s ease;"></div>
        </div>
        <div style="font-size: 10px; color: ${color}; font-weight: 500; text-align: right;">${label}</div>
      </div>
    `;
  };

  input.addEventListener('input', update);
  update();
}
