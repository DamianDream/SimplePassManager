/**
 * Public Suffix List & Registrable Domain (eTLD+1) Utilities
 * Powered by tldts for bulletproof domain and sub-domain isolation.
 * Prevents phishing by distinguishing between true domains and deceptive prefixes.
 */

import { getDomain } from 'tldts';
import { isLocalOrPrivateHost } from './domain.js';

/**
 * Returns the effective top-level domain plus one (eTLD+1), aka registrable domain.
 * E.g., 'gist.github.com' -> 'github.com'
 * E.g., 'amazon.co.uk' -> 'amazon.co.uk'
 * E.g., 'github.phish-login.io' -> 'phish-login.io'
 * For localhost, 127.0.0.1, or private IPs -> returns the clean host (e.g. '192.168.0.104' or 'localhost').
 */
export function getRegistrableDomain(hostOrUrl) {
  if (!hostOrUrl || typeof hostOrUrl !== 'string') return '';
  const clean = hostOrUrl
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '');

  if (!clean) return '';

  if (isLocalOrPrivateHost(clean)) {
    return clean;
  }

  const domain = getDomain(clean);
  return domain ? domain.toLowerCase() : clean;
}
