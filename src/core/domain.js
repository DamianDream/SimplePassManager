/**
 * Domain Utilities & Matching for SimplePass
 * Detects, cleans, and matches vault items against active website domains.
 */

/**
 * Determines whether a URL supports content script injection and autofill.
 * Disallows chrome://, chrome-extension://, devtools://, about:, Chrome Web Store, and PDF viewers.
 * @param {string} url
 * @returns {boolean}
 */
export function isPageAutofillSupported(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.includes('chromewebstore.google.com') ||
    lower.endsWith('.pdf')
  ) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://');
}

/**
 * Checks if a domain, host, or URL belongs to a local or private network.
 */
export function isLocalOrPrivateHost(hostOrUrl) {
  if (!hostOrUrl || typeof hostOrUrl !== 'string') return false;
  const clean = hostOrUrl
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean.startsWith('192.168.') ||
    clean.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean) ||
    clean.endsWith('.local') ||
    clean.endsWith('.test') ||
    clean.endsWith('.internal') ||
    clean.endsWith('.onion')
  );
}

/**
 * Normalizes a URL or domain string into a clean hostname without www and protocol.
 * E.g., 'https://www.github.com/login' -> 'github.com'
 * E.g., 'http://192.168.0.104:4321' -> '192.168.0.104:4321'
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
    const isLocal = isLocalOrPrivateHost(trimmed);
    const withProto =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : (isLocal ? `http://${trimmed}` : `https://${trimmed}`);
    const parsed = new URL(withProto);
    const cleanHost = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      return `${cleanHost}:${parsed.port}`;
    }
    return cleanHost;
  } catch (_) {
    return trimmed.split('/')[0].replace(/^www\./, '').toLowerCase();
  }
}

/**
 * Extracts pure domain name or host IP without port and without path/breadcrumbs.
 * E.g., '192.168.0.104:4321' -> '192.168.0.104'
 * E.g., 'http://192.168.0.104:4321/dashboard/items' -> '192.168.0.104'
 * E.g., 'https://www.github.com/login/oauth' -> 'github.com'
 * E.g., 'localhost:3000' -> 'localhost'
 */
export function extractDomainName(urlOrDomain) {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') return '';
  const clean = extractCleanDomain(urlOrDomain);
  if (!clean) return '';
  return clean.split(':')[0].toLowerCase();
}

import { getRegistrableDomain } from './psl.js';

export { getRegistrableDomain };

/**
 * Checks whether an item strictly matches the target domain (anti-phishing eTLD+1 matching).
 * Matches iff getRegistrableDomain(item.url) === getRegistrableDomain(activeDomain).
 * For localhost / private IPs, compares exact host and port if provided.
 * Prevents phishing attacks like deceptive subdomains or substring titles.
 */
export function isItemMatchingDomain(item, activeDomain) {
  if (!item || !activeDomain) return false;
  const targetHost = extractCleanDomain(activeDomain);
  if (!targetHost) return false;

  const targetReg = getRegistrableDomain(targetHost);
  if (!targetReg) return false;

  const itemUrl = item.url || item.domain || '';
  if (!itemUrl) return false;

  const itemHost = extractCleanDomain(itemUrl);
  if (!itemHost) return false;

  const itemReg = getRegistrableDomain(itemHost);
  if (!itemReg) return false;

  // Local or private network host check (IPs, localhost, .local)
  if (isLocalOrPrivateHost(targetHost) || isLocalOrPrivateHost(itemHost)) {
    const targetPort = targetHost.includes(':') ? targetHost.split(':')[1] : '';
    const itemPort = itemHost.includes(':') ? itemHost.split(':')[1] : '';
    if (targetPort && itemPort) {
      return itemHost.toLowerCase() === targetHost.toLowerCase();
    }
    return itemReg === targetReg;
  }

  // Strict eTLD+1 matching
  return itemReg === targetReg;
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
