// ─── CATEGORY COLOR TONES SYSTEM ─────────────────────────────────────────────
// Supports curated muted/tinted color badges inspired by modern status badges.

export const CATEGORY_COLORS = {
  amber: {
    id: 'amber',
    name: 'Amber',
    color: '#F59E0B',
    darkText: '#FBBF24',
    lightText: '#B45309',
    bgDark: 'rgba(245, 158, 11, 0.16)',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    borderDark: 'rgba(245, 158, 11, 0.35)',
    borderLight: 'rgba(245, 158, 11, 0.3)',
    bgDarkActive: 'rgba(245, 158, 11, 0.32)',
    bgLightActive: 'rgba(245, 158, 11, 0.24)'
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    color: '#3B82F6',
    darkText: '#60A5FA',
    lightText: '#1D4ED8',
    bgDark: 'rgba(59, 130, 246, 0.16)',
    bgLight: 'rgba(59, 130, 246, 0.12)',
    borderDark: 'rgba(59, 130, 246, 0.35)',
    borderLight: 'rgba(59, 130, 246, 0.3)',
    bgDarkActive: 'rgba(59, 130, 246, 0.32)',
    bgLightActive: 'rgba(59, 130, 246, 0.24)'
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    color: '#8B5CF6',
    darkText: '#C084FC',
    lightText: '#7C3AED',
    bgDark: 'rgba(139, 92, 246, 0.16)',
    bgLight: 'rgba(139, 92, 246, 0.12)',
    borderDark: 'rgba(139, 92, 246, 0.35)',
    borderLight: 'rgba(139, 92, 246, 0.3)',
    bgDarkActive: 'rgba(139, 92, 246, 0.32)',
    bgLightActive: 'rgba(139, 92, 246, 0.24)'
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow',
    color: '#EAB308',
    darkText: '#FACC15',
    lightText: '#A16207',
    bgDark: 'rgba(234, 179, 8, 0.16)',
    bgLight: 'rgba(234, 179, 8, 0.12)',
    borderDark: 'rgba(234, 179, 8, 0.35)',
    borderLight: 'rgba(234, 179, 8, 0.3)',
    bgDarkActive: 'rgba(234, 179, 8, 0.32)',
    bgLightActive: 'rgba(234, 179, 8, 0.24)'
  },
  green: {
    id: 'green',
    name: 'Lime',
    color: '#BADC00',
    darkText: '#D9F230',
    lightText: '#4D5E00',
    bgDark: 'rgba(186, 220, 0, 0.16)',
    bgLight: 'rgba(186, 220, 0, 0.14)',
    borderDark: 'rgba(186, 220, 0, 0.35)',
    borderLight: 'rgba(186, 220, 0, 0.35)',
    bgDarkActive: 'rgba(186, 220, 0, 0.32)',
    bgLightActive: 'rgba(186, 220, 0, 0.26)'
  },
  red: {
    id: 'red',
    name: 'Red',
    color: '#EF4444',
    darkText: '#F87171',
    lightText: '#B91C1C',
    bgDark: 'rgba(239, 68, 68, 0.16)',
    bgLight: 'rgba(239, 68, 68, 0.12)',
    borderDark: 'rgba(239, 68, 68, 0.35)',
    borderLight: 'rgba(239, 68, 68, 0.3)',
    bgDarkActive: 'rgba(239, 68, 68, 0.32)',
    bgLightActive: 'rgba(239, 68, 68, 0.24)'
  },
  teal: {
    id: 'teal',
    name: 'Teal',
    color: '#14B8A6',
    darkText: '#2DD4BF',
    lightText: '#0F766E',
    bgDark: 'rgba(20, 184, 166, 0.16)',
    bgLight: 'rgba(20, 184, 166, 0.12)',
    borderDark: 'rgba(20, 184, 166, 0.35)',
    borderLight: 'rgba(20, 184, 166, 0.3)',
    bgDarkActive: 'rgba(20, 184, 166, 0.32)',
    bgLightActive: 'rgba(20, 184, 166, 0.24)'
  },
  pink: {
    id: 'pink',
    name: 'Pink',
    color: '#EC4899',
    darkText: '#F472B6',
    lightText: '#BE185D',
    bgDark: 'rgba(236, 72, 153, 0.16)',
    bgLight: 'rgba(236, 72, 153, 0.12)',
    borderDark: 'rgba(236, 72, 153, 0.35)',
    borderLight: 'rgba(236, 72, 153, 0.3)',
    bgDarkActive: 'rgba(236, 72, 153, 0.32)',
    bgLightActive: 'rgba(236, 72, 153, 0.24)'
  },
  slate: {
    id: 'slate',
    name: 'Slate',
    color: '#64748B',
    darkText: '#CBD5E1',
    lightText: '#475569',
    bgDark: 'rgba(100, 116, 139, 0.16)',
    bgLight: 'rgba(100, 116, 139, 0.12)',
    borderDark: 'rgba(100, 116, 139, 0.35)',
    borderLight: 'rgba(100, 116, 139, 0.3)',
    bgDarkActive: 'rgba(100, 116, 139, 0.32)',
    bgLightActive: 'rgba(100, 116, 139, 0.24)'
  }
};

export const DEFAULT_CATEGORY_COLORS = {
  Work: 'blue',
  Personal: 'green'
};

/**
 * Returns color definition object for a category / tag.
 * @param {string} catName
 * @param {Record<string, string>} [customColors]
 * @returns {typeof CATEGORY_COLORS[keyof typeof CATEGORY_COLORS]}
 */
export function getCategoryColorDef(catName, customColors = {}) {
  const colorId = (customColors && customColors[catName]) || DEFAULT_CATEGORY_COLORS[catName] || 'slate';
  return CATEGORY_COLORS[colorId] || CATEGORY_COLORS.slate;
}

/**
 * Generates inline CSS custom properties for styling a category/tag pill/badge.
 * @param {typeof CATEGORY_COLORS[keyof typeof CATEGORY_COLORS]} colorDef
 * @returns {string}
 */
export function getCategoryCssVars(colorDef) {
  if (!colorDef) return '';
  return [
    `--pill-color:${colorDef.color}`,
    `--pill-bg-dark:${colorDef.bgDark}`,
    `--pill-bg-light:${colorDef.bgLight}`,
    `--pill-border-dark:${colorDef.borderDark}`,
    `--pill-border-light:${colorDef.borderLight}`,
    `--pill-text-dark:${colorDef.darkText}`,
    `--pill-text-light:${colorDef.lightText}`,
    `--pill-bg-dark-active:${colorDef.bgDarkActive}`,
    `--pill-bg-light-active:${colorDef.bgLightActive}`
  ].join(';');
}

/**
 * Validates a tag name:
 * - Only letters and digits (letters/numbers, optional single space between words)
 * - Maximum length 30 characters
 * - Non-empty
 * @param {string} name
 * @returns {{ valid: boolean, error?: string, name?: string }}
 */
export function validateTagName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, errorCode: 'tag_empty', error: 'Tag name cannot be empty' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, errorCode: 'tag_empty', error: 'Tag name cannot be empty' };
  }
  if (trimmed.length > 30) {
    return { valid: false, errorCode: 'tag_too_long', error: 'Maximum tag length is 30 characters' };
  }
  const regex = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;
  if (!regex.test(trimmed)) {
    return { valid: false, errorCode: 'tag_invalid_chars', error: 'Only letters, numbers, and single spaces are allowed' };
  }
  return { valid: true, name: trimmed };
}

/**
 * Normalizes tags for an item, ensuring an array of valid strings.
 * Falls back to item.category if tags is not set.
 * @param {any} item
 * @returns {string[]}
 */
export function getItemTags(item) {
  if (!item) return ['Work'];
  if (Array.isArray(item.tags)) {
    return item.tags.filter(t => typeof t === 'string' && t.trim().length > 0);
  }
  if (item.category && typeof item.category === 'string' && item.category.trim().length > 0) {
    return [item.category.trim()];
  }
  return ['Work'];
}

export const TAG_COLORS = CATEGORY_COLORS;
export const DEFAULT_TAG_COLORS = DEFAULT_CATEGORY_COLORS;
export const getTagColorDef = getCategoryColorDef;
export const getTagCssVars = getCategoryCssVars;
