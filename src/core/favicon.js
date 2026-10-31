/**
 * Favicon Management and Domain Caching Service
 * Retrieves, caches locally, and updates website favicons for vault credentials.
 * Supports public websites, local network IPs (e.g. 192.168.x.x:4321), localhost,
 * SVG icons, HTML <link rel="icon"> resolution, and direct browser tab favicon URL capture.
 */

import { extractCleanDomain, isLocalOrPrivateHost } from './domain.js';
import {
  getFaviconCache,
  saveFaviconCache,
  getCachedFavicon,
  setCachedFavicon
} from './storage.js';

export { getFaviconCache, saveFaviconCache, getCachedFavicon, setCachedFavicon };

/**
 * Parses any URL or domain string into detailed components.
 */
export function parseUrlDetails(domainOrUrl) {
  if (!domainOrUrl || typeof domainOrUrl !== 'string') return null;
  const trimmed = domainOrUrl.trim();
  if (
    !trimmed ||
    trimmed === 'about:blank' ||
    trimmed.startsWith('chrome') ||
    trimmed.startsWith('edge') ||
    trimmed === 'newtab'
  ) {
    return null;
  }

  const isLocal = isLocalOrPrivateHost(trimmed);
  const hasProto = trimmed.startsWith('http://') || trimmed.startsWith('https://');
  const defaultProto = isLocal ? 'http://' : 'https://';
  const withProto = hasProto ? trimmed : `${defaultProto}${trimmed}`;

  try {
    const u = new URL(withProto);
    const protocol = u.protocol; // 'http:' or 'https:'
    const hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    const port = (u.port && u.port !== '80' && u.port !== '443') ? u.port : '';
    const host = port ? `${hostname}:${port}` : hostname;
    const origin = `${protocol}//${u.host}`;
    return {
      url: u.href,
      origin,
      protocol,
      hostname,
      port,
      host,
      isLocal,
      pathname: u.pathname
    };
  } catch (_) {
    const clean = trimmed.split('/')[0].replace(/^www\./, '').toLowerCase();
    const hostParts = clean.split(':');
    return {
      url: `http://${clean}`,
      origin: `http://${clean}`,
      protocol: 'http:',
      hostname: hostParts[0],
      port: hostParts[1] || '',
      host: clean,
      isLocal,
      pathname: '/'
    };
  }
}

/**
 * Converts a Blob or Buffer into a Base64 data: URL.
 * Detects SVG, ICO, PNG, and guarantees valid image MIME prefix.
 */
export async function blobToDataUrl(blob, sourceUrl = '') {
  if (!blob) return null;

  let mime = blob.type || '';
  if (!mime || mime === 'application/octet-stream' || mime === 'text/plain') {
    const lowerUrl = (sourceUrl || '').toLowerCase();
    if (lowerUrl.includes('.svg')) mime = 'image/svg+xml';
    else if (lowerUrl.includes('.ico')) mime = 'image/x-icon';
    else if (lowerUrl.includes('.png')) mime = 'image/png';
    else if (lowerUrl.includes('.webp')) mime = 'image/webp';
    else mime = 'image/png';
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        let res = reader.result;
        if (typeof res === 'string' && mime && !res.startsWith(`data:${mime}`)) {
          res = res.replace(/^data:[^;]*;/, `data:${mime};`);
        }
        resolve(res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Node.js environment
  if (typeof blob.arrayBuffer === 'function') {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  return null;
}

/**
 * Fetches an image from a URL and converts to base64 Data URL.
 */
async function fetchImageCandidate(url, timeoutMs = 3000) {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    const res = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      mode: 'cors'
    });

    if (timer) clearTimeout(timer);

    if (res && res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 20) {
        const dataUrl = await blobToDataUrl(blob, url);
        if (dataUrl && dataUrl.startsWith('data:image/')) {
          return dataUrl;
        }
      }
    }
  } catch (_) {
    // Continue
  }
  return null;
}

/**
 * Fetches HTML from the site and parses <link rel="icon"> tags.
 */
async function fetchFaviconFromHtml(targetUrl, timeoutMs = 3000) {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    const res = await fetch(targetUrl, {
      signal: controller ? controller.signal : undefined,
      mode: 'cors'
    });

    if (timer) clearTimeout(timer);

    if (res && res.ok) {
      const html = await res.text();
      // Match all link rel icons
      const linkMatches = [...html.matchAll(/<link\s+[^>]*rel=["']([^"']*(?:icon|shortcut\s+icon|apple-touch-icon)[^"']*)["'][^>]*>/gi)];
      for (const match of linkMatches) {
        const tag = match[0];
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch && hrefMatch[1]) {
          const resolvedUrl = new URL(hrefMatch[1].trim(), targetUrl).href;
          const dataUrl = await fetchImageCandidate(resolvedUrl, 2500);
          if (dataUrl) return dataUrl;
        }
      }
    }
  } catch (_) {
    // Ignore error
  }
  return null;
}

/**
 * Fetches a favicon for a domain or URL, converting it into a persistent Base64 Data URL.
 * Prefers Chrome local _favicon API (zero network leaks).
 * External Google/DuckDuckGo queries are opt-in only.
 */
export async function fetchFaviconAsDataUrl(domainOrUrl, { useExternalServices = false } = {}) {
  if (!domainOrUrl || typeof domainOrUrl !== 'string') return null;

  // 1. Direct Data URL check
  if (domainOrUrl.startsWith('data:image/')) {
    return domainOrUrl;
  }

  const details = parseUrlDetails(domainOrUrl);
  if (!details) return null;

  // 2. Chrome Native Local Favicon API (no external network leaks)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && !details.isLocal) {
    try {
      const localChromeFavicon = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(details.url || details.origin) + '&size=32');
      const dataUrl = await fetchImageCandidate(localChromeFavicon, 1500);
      if (dataUrl) return dataUrl;
    } catch (_) {}
  }

  // 3. If given URL was already a direct path to an icon file:
  if (/\.(ico|svg|png|jpg|jpeg|webp)($|\?)/i.test(details.url)) {
    const directData = await fetchImageCandidate(details.url);
    if (directData) return directData;
  }

  const origin = details.origin;
  const host = details.host;
  const hostname = details.hostname;

  // 4. Direct origin endpoint candidates
  const candidates = [
    `${origin}/favicon.ico`,
    `${origin}/favicon.svg`,
    `${origin}/favicon.png`,
    `${origin}/icon.svg`,
    `${origin}/apple-touch-icon.png`
  ];

  // If standard port, also check alternate protocol
  if (!details.port) {
    const altProto = details.protocol === 'https:' ? 'http:' : 'https:';
    candidates.push(`${altProto}//${host}/favicon.ico`);
    candidates.push(`${altProto}//${host}/favicon.svg`);
  }

  // 5. Opt-in: Query Google & DuckDuckGo APIs only if explicitly enabled
  if (!details.isLocal && useExternalServices) {
    candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`);
    candidates.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
    if (hostname !== host) {
      candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`);
    }
  }

  for (const candidate of candidates) {
    const dataUrl = await fetchImageCandidate(candidate, 2500);
    if (dataUrl) return dataUrl;
  }

  // 6. Fallback: Parse HTML <link rel="icon"> from the page
  const htmlFavicon = await fetchFaviconFromHtml(details.url || details.origin);
  if (htmlFavicon) return htmlFavicon;

  return null;
}

/**
 * Resolves a favicon for a given URL or domain.
 * - If not forceRefresh, checks local cache first (under host or hostname).
 * - If found in cache, returns immediately without network request.
 * - If activeTabFavIconUrl is provided, attempts to use it as primary candidate.
 * - Otherwise fetches fresh favicon, caches it under host & hostname, and returns it.
 */
export async function resolveFavicon(domainOrUrl, { forceRefresh = false, activeTabFavIconUrl = null, useExternalServices = false } = {}) {
  const details = parseUrlDetails(domainOrUrl);
  if (!details) {
    const fallbackDomain = extractCleanDomain(domainOrUrl);
    return { domain: fallbackDomain, favicon: null, fromCache: false };
  }

  const hostKey = details.host;
  const hostnameKey = details.hostname;

  // 1. Check cache first if not forceRefresh
  if (!forceRefresh) {
    const cached = (await getCachedFavicon(hostKey)) || (await getCachedFavicon(hostnameKey));
    if (cached) {
      return { domain: hostKey, favicon: cached, fromCache: true };
    }
  }

  // 2. If activeTabFavIconUrl provided (e.g. Chrome tabs API), try resolving it
  if (activeTabFavIconUrl) {
    try {
      const dataUrl = await fetchImageCandidate(activeTabFavIconUrl, 2500);
      if (dataUrl) {
        await setCachedFavicon(hostKey, dataUrl);
        if (hostnameKey !== hostKey) await setCachedFavicon(hostnameKey, dataUrl);
        return { domain: hostKey, favicon: dataUrl, fromCache: false };
      }
    } catch (_) {}
  }

  // 3. Fetch from site / candidate endpoints
  const fresh = await fetchFaviconAsDataUrl(domainOrUrl, { useExternalServices });
  if (fresh) {
    await setCachedFavicon(hostKey, fresh);
    if (hostnameKey !== hostKey) await setCachedFavicon(hostnameKey, fresh);
    return { domain: hostKey, favicon: fresh, fromCache: false };
  }

  // 4. If forceRefresh failed, keep existing cached version if available
  const existing = (await getCachedFavicon(hostKey)) || (await getCachedFavicon(hostnameKey));
  return { domain: hostKey, favicon: existing || null, fromCache: Boolean(existing), failed: !fresh };
}
