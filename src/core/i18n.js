/**
 * SimplePass Internationalization (i18n) Engine
 * Supports EN / RU / UA / BE / KK / ZH / JA with instant reactive language switching.
 */

import translations from '../locales/translations.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'ua', 'be', 'kk', 'zh', 'ja'];
export const DEFAULT_LANGUAGE = 'ru';

export const LANGUAGE_OPTIONS = [
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ua', name: 'Українська', flag: '🇺🇦' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'kk', name: 'Қазақша', flag: '🇰🇿' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' }
];

let currentLanguage = DEFAULT_LANGUAGE;

/**
 * Sets current active language
 */
export function setLanguage(lang) {
  if (lang && SUPPORTED_LANGUAGES.includes(lang.toLowerCase())) {
    currentLanguage = lang.toLowerCase();
  }
}

/**
 * Gets current active language
 */
export function getLanguage() {
  return currentLanguage;
}

/**
 * Translates a key by path (e.g. 'nav.passwords') with optional parameter interpolation.
 * @param {string} path - Dot notation key, e.g. 'settings.theme_label'
 * @param {Record<string, any>} [params] - Key-value replacements for {placeholder}
 * @returns {string} Translated string
 */
export function t(path, params = {}) {
  if (!path) return '';

  const parts = path.split('.');
  let node = translations;

  for (const part of parts) {
    if (node && typeof node === 'object' && part in node) {
      node = node[part];
    } else {
      node = null;
      break;
    }
  }

  let text = '';
  if (node && typeof node === 'object') {
    text = node[currentLanguage] || node['en'] || node['ru'] || path;
  } else if (typeof node === 'string') {
    text = node;
  } else {
    text = path;
  }

  // Parameter interpolation: {count}, {name}, etc.
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v !== undefined && v !== null ? v : '');
    });
  }

  return text;
}
