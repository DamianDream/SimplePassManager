/**
 * SimplePass Internationalization (i18n) Engine
 * Supports EN / RU / UA / BE / KK / ZH / JA / HI with instant reactive language switching.
 */

import translations from '../locales/translations.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'ua', 'be', 'kk', 'zh', 'ja', 'hi'];
export const DEFAULT_LANGUAGE = 'en';

/**
 * Detects language from browser or provided locale code.
 * Maps 'uk' -> 'ua' (Ukrainian), falls back to 'en' if unsupported.
 * @param {string} [navLang]
 * @returns {string}
 */
export function detectBrowserLanguage(navLang = typeof navigator !== 'undefined' ? navigator.language : 'en') {
  if (!navLang) return DEFAULT_LANGUAGE;
  let code = String(navLang).slice(0, 2).toLowerCase();
  if (code === 'uk') code = 'ua';
  return SUPPORTED_LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
}

export const LANGUAGE_OPTIONS = [
  { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', flag: '🇷🇺' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ua', name: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430', flag: '🇺🇦' },
  { code: 'be', name: '\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u044f', flag: '🇧🇾' },
  { code: 'kk', name: '\u049a\u0430\u0437\u0430\u049b\u0448\u0430', flag: '🇰🇿' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' }
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
