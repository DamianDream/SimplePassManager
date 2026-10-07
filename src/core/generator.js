/**
 * Cryptographically Secure Password Generator & Entropy Evaluator
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
const AMBIGUOUS = 'O0Il1|';

export function generatePassword(options = {}) {
  const {
    length = 20,
    useUpper = true,
    useLower = true,
    useDigits = true,
    useSymbols = true,
    avoidAmbiguous = false
  } = options;

  let charset = '';
  if (useUpper) charset += UPPER;
  if (useLower) charset += LOWER;
  if (useDigits) charset += DIGITS;
  if (useSymbols) charset += SYMBOLS;

  if (avoidAmbiguous) {
    charset = charset.split('').filter(ch => !AMBIGUOUS.includes(ch)).join('');
  }

  if (!charset) {
    charset = LOWER + DIGITS;
  }

  // Cryptographically secure random selection
  const randomBytes = crypto.getRandomValues(new Uint32Array(length));
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomBytes[i] % charset.length];
  }

  return result;
}

/**
 * Calculates password strength score (0 to 100) and label
 */
export function evaluatePasswordStrength(password) {
  if (!password) return { score: 0, label: 'Empty', color: '#6b7280' };

  let score = 0;
  if (password.length >= 8) score += 20;
  if (password.length >= 14) score += 20;
  if (password.length >= 20) score += 10;

  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 15;
  if (/[^a-zA-Z0-9]/.test(password)) score += 15;

  score = Math.min(100, score);

  if (score < 40) return { score, label: 'Weak', color: '#ef4444' };
  if (score < 70) return { score, label: 'Moderate', color: '#f59e0b' };
  if (score < 90) return { score, label: 'Strong', color: '#10b981' };
  return { score, label: 'Very Strong', color: '#06b6d4' };
}
