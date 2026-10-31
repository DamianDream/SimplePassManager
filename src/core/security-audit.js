/**
 * SimplePass Manager - Local Security Health & Password Audit Engine (F3)
 * 100% client-side, zero network egress, fully private.
 */

import { evaluatePasswordStrength } from './generator.js';

/**
 * Fast in-memory hash for duplicate detection without exposing raw passwords
 */
export function hashPasswordForAudit(password) {
  if (!password) return '';
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `pwd_${password.length}_${hash}`;
}

/**
 * Audits a single item against duplicate map and entropy strength
 */
export function auditItem(item, duplicateCounts = new Map(), _nowMs = Date.now()) {
  const pwd = item.password || '';
  const pwdHash = hashPasswordForAudit(pwd);
  const dupCount = (pwd && duplicateCounts.get(pwdHash)) || 0;
  const isReused = dupCount > 1;

  const strength = evaluatePasswordStrength(pwd);
  const isWeak = !pwd || strength.score < 60 || pwd.length < 10;

  let riskLevel = 'strong';
  if (isReused) {
    riskLevel = 'reused'; // 🔴 Critical: reused across accounts
  } else if (isWeak) {
    riskLevel = 'weak'; // 🟠 Weak: easily brute-forced or short
  } else {
    riskLevel = 'strong'; // 🟢 Unique and strong
  }

  return {
    itemId: item.id,
    item,
    isReused,
    reusedCount: dupCount,
    isWeak,
    strength,
    riskLevel
  };
}

/**
 * Runs a comprehensive security audit on an array of vault items
 */
export function runSecurityAudit(items = [], options = {}) {
  const nowMs = options.nowMs || Date.now();
  const duplicateCounts = new Map();

  // 1. First pass: count password frequencies
  items.forEach(item => {
    if (item.password) {
      const hash = hashPasswordForAudit(item.password);
      duplicateCounts.set(hash, (duplicateCounts.get(hash) || 0) + 1);
    }
  });

  // 2. Second pass: audit each item
  const auditedItems = items.map(item => auditItem(item, duplicateCounts, nowMs));

  const total = auditedItems.length;
  let reusedCount = 0;
  let weakCount = 0;
  let strongCount = 0;

  let scoreSum = 0;

  auditedItems.forEach(res => {
    if (res.isReused) reusedCount++;
    if (res.isWeak) weakCount++;
    if (res.riskLevel === 'strong') strongCount++;

    // Calculate individual item health contribution
    let itemScore = res.strength.score;
    if (res.isReused) itemScore *= 0.4; // heavy penalty for reused
    scoreSum += Math.max(0, Math.min(100, itemScore));
  });

  const healthScore = total > 0 ? Math.round(scoreSum / total) : 100;

  return {
    healthScore,
    total,
    reusedCount,
    weakCount,
    strongCount,
    auditedItems,
    auditDate: new Date(nowMs).toISOString()
  };
}
