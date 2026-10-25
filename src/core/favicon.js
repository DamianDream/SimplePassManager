/**
 * Favicon Management and Domain Caching Service
 * Retrieves, caches locally, and updates website favicons for vault credentials.
 */

import { extractCleanDomain } from './domain.js';
import {
  getFaviconCache,
  saveFaviconCache,
  getCachedFavicon,
  setCachedFavicon
} from './storage.js';

export { getFaviconCache, saveFaviconCache, getCachedFavicon, setCachedFavicon };

/**
 * Converts a Blob or Buffer into a Base64 data: URL.
 * Works both in browser (FileReader) and Node.js environments.
 */
export async function blobToDataUrl(blob) {
  if (!blob) return null;

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Node.js environment
  if (typeof blob.arrayBuffer === 'function') {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mime = blob.type || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  return null;
}

/**
 * Fetches a favicon for a domain or URL, converting it into a persistent Base64 Data URL.
 * Tries Google Favicon API (sz=64), then direct /favicon.ico, then DuckDuckGo.
 */
export async function fetchFaviconAsDataUrl(domainOrUrl) {
  const domain = extractCleanDomain(domainOrUrl);
  if (!domain) return null;

  // Candidate sources in order of fidelity and resilience
  const candidateUrls = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://${domain}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
  ];

  for (const url of candidateUrls) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null;
      if (controller) {
        timer = setTimeout(() => controller.abort(), 4000);
      }

      const res = await fetch(url, {
        signal: controller ? controller.signal : undefined,
        mode: 'cors'
      });

      if (timer) clearTimeout(timer);

      if (res && res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 40) {
          const dataUrl = await blobToDataUrl(blob);
          if (dataUrl && dataUrl.startsWith('data:image/')) {
            return dataUrl;
          }
        }
      }
    } catch (_) {
      // Try next candidate
    }
  }

  return null;
}

/**
 * Resolves a favicon for a given URL or domain.
 * - If not forceRefresh, checks local cache first.
 * - If found in cache, returns immediately without network request.
 * - If not in cache or forceRefresh is true, fetches fresh favicon, caches it, and returns it.
 */
export async function resolveFavicon(domainOrUrl, { forceRefresh = false } = {}) {
  const domain = extractCleanDomain(domainOrUrl);
  if (!domain) return { domain: '', favicon: null, fromCache: false };

  if (!forceRefresh) {
    const cached = await getCachedFavicon(domain);
    if (cached) {
      return { domain, favicon: cached, fromCache: true };
    }
  }

  const fresh = await fetchFaviconAsDataUrl(domain);
  if (fresh) {
    await setCachedFavicon(domain, fresh);
    return { domain, favicon: fresh, fromCache: false };
  }

  // If forceRefresh failed, keep existing cached version if available
  const existing = await getCachedFavicon(domain);
  return { domain, favicon: existing || null, fromCache: Boolean(existing), failed: !fresh };
}
