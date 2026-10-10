/**
 * Domain Utilities & Matching for SimplePass
 * Detects, cleans, and matches vault items against active website domains.
 */

/**
 * Normalizes a URL or domain string into a clean hostname without www and protocol.
 * E.g., 'https://www.github.com/login' -> 'github.com'
 */
export function extractCleanDomain(urlOrDomain) {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') return '';
  const trimmed = urlOrDomain.trim().toLowerCase();
  if (
    !trimmed ||
    trimmed === 'about:blank' ||
    trimmed.startsWith('chrome') ||
    trimmed.startsWith('edge') ||
    trimmed === 'newtab'
  ) {
    return '';
  }

  try {
    const withProto =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(withProto);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return trimmed.split('/')[0].replace(/^www\./, '').toLowerCase();
  }
}

/**
 * Checks whether an item matches the target domain.
 * Supports:
 * - Direct domain or subdomain match (e.g. gist.github.com matches github.com and vice versa)
 * - URL substring match
 * - Title match against root domain (e.g., title 'GitHub' matches 'github.com')
 */
export function isItemMatchingDomain(item, activeDomain) {
  if (!item || !activeDomain) return false;
  const targetHost = extractCleanDomain(activeDomain);
  if (!targetHost) return false;

  // 1. Match item.url
  if (item.url) {
    const itemHost = extractCleanDomain(item.url);
    if (itemHost) {
      if (
        itemHost === targetHost ||
        itemHost.endsWith('.' + targetHost) ||
        targetHost.endsWith('.' + itemHost)
      ) {
        return true;
      }
    }
    const itemUrlLower = item.url.toLowerCase();
    if (itemUrlLower.includes(targetHost)) {
      return true;
    }
  }

  // 2. Match item.title
  if (item.title) {
    const titleLower = item.title.toLowerCase().trim();
    if (titleLower === targetHost || titleLower.includes(targetHost)) {
      return true;
    }
    // Extract base domain name without TLD (e.g., "github" from "github.com")
    const targetParts = targetHost.split('.');
    const targetBase = targetParts[0];
    if (targetBase && targetBase.length >= 3) {
      if (titleLower === targetBase || titleLower.startsWith(targetBase)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sorts items putting domain-matched items first.
 */
export function sortItemsByDomainMatch(items, activeDomain) {
  if (!Array.isArray(items)) return [];
  if (!activeDomain) return [...items];

  return [...items].sort((a, b) => {
    const aMatch = isItemMatchingDomain(a, activeDomain);
    const bMatch = isItemMatchingDomain(b, activeDomain);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
}
