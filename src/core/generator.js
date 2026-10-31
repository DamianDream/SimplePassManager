/**
 * Cryptographically Secure Password Generator & Entropy Evaluator
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
const AMBIGUOUS = 'O0Il1|';

/**
 * Unbiased random integer in range [0, max - 1] via rejection sampling
 */
function secureRandomInt(max) {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return buf[0] % max;
    }
  }
}

export function generatePassword(options = {}) {
  const {
    length = 20,
    useUpper = true,
    useLower = true,
    useDigits = true,
    useSymbols = true,
    avoidAmbiguous = false
  } = options;

  let upperSet = useUpper ? UPPER : '';
  let lowerSet = useLower ? LOWER : '';
  let digitSet = useDigits ? DIGITS : '';
  let symbolSet = useSymbols ? SYMBOLS : '';

  if (avoidAmbiguous) {
    upperSet = upperSet.split('').filter(ch => !AMBIGUOUS.includes(ch)).join('');
    lowerSet = lowerSet.split('').filter(ch => !AMBIGUOUS.includes(ch)).join('');
    digitSet = digitSet.split('').filter(ch => !AMBIGUOUS.includes(ch)).join('');
    symbolSet = symbolSet.split('').filter(ch => !AMBIGUOUS.includes(ch)).join('');
  }

  const activeClasses = [];
  if (upperSet) activeClasses.push(upperSet);
  if (lowerSet) activeClasses.push(lowerSet);
  if (digitSet) activeClasses.push(digitSet);
  if (symbolSet) activeClasses.push(symbolSet);

  const charset = activeClasses.join('') || (LOWER + DIGITS);

  const chars = [];
  if (length >= activeClasses.length) {
    // 1. Guarantee at least one character from each active class
    for (const cls of activeClasses) {
      chars.push(cls[secureRandomInt(cls.length)]);
    }
    // 2. Fill the remainder from the full charset
    for (let i = activeClasses.length; i < length; i++) {
      chars.push(charset[secureRandomInt(charset.length)]);
    }
    // 3. Cryptographically shuffle the entire array (Fisher-Yates)
    for (let i = chars.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
  } else {
    for (let i = 0; i < length; i++) {
      chars.push(charset[secureRandomInt(charset.length)]);
    }
  }

  return chars.join('');
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
