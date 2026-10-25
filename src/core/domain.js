/**
 * Domain Utilities & Matching for SimplePass
 * Detects, cleans, and matches vault items against active website domains.
 */

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
      const itemHostNoPort = itemHost.split(':')[0];
      const targetHostNoPort = targetHost.split(':')[0];
      if (
        itemHost === targetHost ||
        itemHost.endsWith('.' + targetHost) ||
        targetHost.endsWith('.' + itemHost) ||
        (itemHostNoPort && targetHostNoPort && (
          itemHostNoPort === targetHostNoPort ||
          itemHostNoPort.endsWith('.' + targetHostNoPort) ||
          targetHostNoPort.endsWith('.' + itemHostNoPort)
        ))
      ) {
        return true;
      }
    }
    const itemUrlLower = item.url.toLowerCase();
    if (itemUrlLower.includes(targetHost) || itemUrlLower.includes(targetHost.split(':')[0])) {
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
