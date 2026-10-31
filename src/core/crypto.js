/**
 * SimplePass Cryptographic Engine (WebCrypto API)
 * Follows OWASP recommendations:
 * - PBKDF2 with SHA-256 and 600,000 iterations
 * - AES-256-GCM authenticated encryption with 96-bit (12-byte) random IV
 */

const PBKDF2_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derives an AES-256-GCM CryptoKey from a master password and salt using PBKDF2.
 */
async function deriveKey(masterPassword, salt) {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts arbitrary JavaScript data with the master password.
 * Returns an envelope with { salt, iv, ciphertext }.
 */
// Curated recovery wordlist (256 distinct English words for 12-word recovery key = 96 bits entropy)
export const RECOVERY_WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
  'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
  'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
  'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
  'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
  'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
  'avoid', 'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis',
  'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball',
  'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base',
  'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
  'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
  'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle',
  'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black',
  'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood',
  'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
  'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring',
  'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain',
  'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief',
  'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother',
  'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
  'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus',
  'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable'
];

/**
 * Generates a random 12-word recovery phrase from the curated dictionary.
 */
export function generateRecoveryPhrase() {
  const words = [];
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 12; i++) {
    const wordIndex = randomBytes[i] % RECOVERY_WORDLIST.length;
    words.push(RECOVERY_WORDLIST[wordIndex]);
  }
  return words.join(' ');
}

/**
 * Normalizes a recovery phrase (trims, converts to lowercase, collapses whitespace).
 */
export function normalizeRecoveryPhrase(phrase) {
  if (!phrase || typeof phrase !== 'string') return '';
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function findClosestWord(inputWord) {
  const word = inputWord.trim().toLowerCase();
  if (RECOVERY_WORDLIST.includes(word)) return { word, distance: 0, exact: true, suggestion: null };
  let closest = null;
  let minDistance = Infinity;

  for (const dictWord of RECOVERY_WORDLIST) {
    const dist = levenshteinDistance(word, dictWord);
    if (dist < minDistance) {
      minDistance = dist;
      closest = dictWord;
    }
  }

  return {
    word: closest,
    distance: minDistance,
    exact: false,
    suggestion: minDistance <= 2 ? closest : null
  };
}

export function validateRecoveryPhraseWords(phrase) {
  if (!phrase || typeof phrase !== 'string') return [];
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.map(w => {
    const check = findClosestWord(w);
    return {
      word: w,
      valid: check.exact,
      suggestion: check.suggestion
    };
  });
}

/**
 * Generates a random 256-bit Master Encryption Key (MEK).
 */
export function generateMek() {
  return crypto.getRandomValues(new Uint8Array(32));
}

const AAD_PAYLOAD = new TextEncoder().encode('simplepass|v3|payload');
const AAD_MEK_PWD = new TextEncoder().encode('simplepass|v3|mek-pwd');
const AAD_MEK_REC = new TextEncoder().encode('simplepass|v3|mek-rec');

/**
 * Wraps (encrypts) the raw MEK with a secret (master password or recovery phrase).
 * Derives an AES-GCM key from secret using PBKDF2 with SHA-256 and 600,000 iterations.
 * In v3, binds each key slot to its unique AAD name ('mek-pwd' or 'mek-rec').
 */
export async function wrapMek(rawMek, secret, slotName = null) {
  const encSecret = typeof secret === 'string' ? secret : '';
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const derKey = await deriveKey(encSecret, salt);

  const encParams = { name: 'AES-GCM', iv: iv };
  if (slotName === 'mek-pwd') {
    encParams.additionalData = AAD_MEK_PWD;
  } else if (slotName === 'mek-rec') {
    encParams.additionalData = AAD_MEK_REC;
  }

  const encMek = await crypto.subtle.encrypt(
    encParams,
    derKey,
    rawMek
  );
  const slot = {
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    data: bufferToBase64(encMek)
  };
  if (slotName) {
    slot.aad = true;
    slot.slot = slotName;
  }
  return slot;
}

/**
 * Unwraps the raw MEK from a v2/v3 envelope using the master password.
 */
export async function unwrapMekWithPassword(envelope, masterPassword) {
  if (!envelope || (envelope.version !== 2 && envelope.version !== 3) || !envelope.keyByPassword) {
    throw new Error('Invalid vault envelope structure');
  }
  try {
    const pwdKeyInfo = envelope.keyByPassword;
    const pwdSalt = new Uint8Array(base64ToBuffer(pwdKeyInfo.salt));
    const pwdIv = new Uint8Array(base64ToBuffer(pwdKeyInfo.iv));
    const encMek = base64ToBuffer(pwdKeyInfo.data);

    const derKey = await deriveKey(masterPassword, pwdSalt);
    const decParams = { name: 'AES-GCM', iv: pwdIv };
    if (pwdKeyInfo.aad === true || (envelope.version >= 3 && pwdKeyInfo.aad !== false)) {
      decParams.additionalData = AAD_MEK_PWD;
    }

    const rawMekBuffer = await crypto.subtle.decrypt(
      decParams,
      derKey,
      encMek
    );
    return new Uint8Array(rawMekBuffer);
  } catch (_) {
    throw new Error('Invalid master password or corrupted vault.');
  }
}

/**
 * Unwraps the raw MEK from a v2/v3 envelope using the 12-word recovery phrase.
 */
export async function unwrapMekWithRecovery(envelope, recoveryPhrase) {
  if (!envelope || (envelope.version !== 2 && envelope.version !== 3) || !envelope.keyByRecovery) {
    throw new Error('12-word recovery key is not supported for this vault version.');
  }
  const normPhrase = normalizeRecoveryPhrase(recoveryPhrase);
  if (!normPhrase || normPhrase.split(' ').length !== 12) {
    throw new Error('Recovery key must contain exactly 12 words.');
  }
  try {
    const recKeyInfo = envelope.keyByRecovery;
    const recSalt = new Uint8Array(base64ToBuffer(recKeyInfo.salt));
    const recIv = new Uint8Array(base64ToBuffer(recKeyInfo.iv));
    const encMek = base64ToBuffer(recKeyInfo.data);

    const recDerKey = await deriveKey(normPhrase, recSalt);
    const decParams = { name: 'AES-GCM', iv: recIv };
    if (recKeyInfo.aad === true) {
      decParams.additionalData = AAD_MEK_REC;
    }

    const rawMekBuffer = await crypto.subtle.decrypt(
      decParams,
      recDerKey,
      encMek
    );
    return new Uint8Array(rawMekBuffer);
  } catch (_) {
    throw new Error('Invalid recovery key or corrupted vault.');
  }
}

/**
 * Encrypts arbitrary JavaScript data with the raw MEK and returns a v3 envelope,
 * preserving existing key slots (keyByPassword, keyByRecovery).
 */
export async function encryptVaultWithMek(data, rawMek, existingKeySlots = null) {
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));

  const mekKey = await crypto.subtle.importKey(
    'raw',
    rawMek,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const isV3 = !existingKeySlots || Boolean(existingKeySlots.keyByPassword && existingKeySlots.keyByPassword.aad);
  const version = isV3 ? 3 : 2;

  const vaultIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encParams = { name: 'AES-GCM', iv: vaultIv };
  if (version === 3) {
    encParams.additionalData = AAD_PAYLOAD;
  }

  const encryptedData = await crypto.subtle.encrypt(
    encParams,
    mekKey,
    plaintext
  );

  const envelope = {
    version,
    iv: bufferToBase64(vaultIv),
    data: bufferToBase64(encryptedData)
  };

  if (existingKeySlots) {
    if (existingKeySlots.keyByPassword) {
      envelope.keyByPassword = existingKeySlots.keyByPassword;
    }
    if (existingKeySlots.keyByRecovery) {
      envelope.keyByRecovery = existingKeySlots.keyByRecovery;
    }
  }

  return envelope;
}

/**
 * Decrypts a v2/v3 envelope using the raw MEK directly.
 */
export async function decryptVaultWithMek(envelope, rawMek) {
  if (!envelope || !envelope.data || !envelope.iv) {
    throw new Error('Invalid vault envelope structure');
  }
  const dec = new TextDecoder();
  const mekKey = await crypto.subtle.importKey(
    'raw',
    rawMek,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const vaultIv = new Uint8Array(base64ToBuffer(envelope.iv));
  const ciphertext = base64ToBuffer(envelope.data);
  const decParams = { name: 'AES-GCM', iv: vaultIv };
  if (envelope.version === 3) {
    decParams.additionalData = AAD_PAYLOAD;
  }
  const decryptedBuffer = await crypto.subtle.decrypt(
    decParams,
    mekKey,
    ciphertext
  );
  return JSON.parse(dec.decode(decryptedBuffer));
}

/**
 * Encrypts arbitrary JavaScript data with the master password.
 * If recoveryPhrase is provided, generates a Master Encryption Key (MEK)
 * and encrypts MEK with both masterPassword and recoveryPhrase (Dual-Key Envelope).
 */
export async function encryptVault(data, masterPassword, recoveryPhrase = null) {
  if (recoveryPhrase) {
    const rawMek = generateMek();
    const keyByPassword = await wrapMek(rawMek, masterPassword, 'mek-pwd');
    const normPhrase = normalizeRecoveryPhrase(recoveryPhrase);
    const keyByRecovery = await wrapMek(rawMek, normPhrase, 'mek-rec');
    return await encryptVaultWithMek(data, rawMek, { keyByPassword, keyByRecovery });
  }

  // Fallback / legacy v1 direct encryption
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(masterPassword, salt);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    plaintext
  );

  return {
    version: 1,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    data: bufferToBase64(ciphertextBuffer)
  };
}

/**
 * Decrypts an encrypted envelope using the master password.
 * Supports both v2 dual-key envelopes and legacy v1 envelopes.
 * Throws an Error if the password is wrong or data is tampered.
 */
export async function decryptVault(envelope, masterPassword) {
  if (!envelope || !envelope.data) {
    throw new Error('Invalid vault envelope structure');
  }

  // Version 2 & 3: Dual-key envelope (MEK encrypted by password)
  if ((envelope.version === 2 || envelope.version === 3) && envelope.keyByPassword) {
    const rawMek = await unwrapMekWithPassword(envelope, masterPassword);
    return await decryptVaultWithMek(envelope, rawMek);
  }

  // Version 1 fallback: direct key derivation
  if (!envelope.salt || !envelope.iv) {
    throw new Error('Invalid vault envelope structure');
  }
  const dec = new TextDecoder();
  const salt = new Uint8Array(base64ToBuffer(envelope.salt));
  const iv = new Uint8Array(base64ToBuffer(envelope.iv));
  const ciphertext = base64ToBuffer(envelope.data);
  const key = await deriveKey(masterPassword, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );
    const jsonStr = dec.decode(decryptedBuffer);
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('Invalid master password or corrupted vault.');
  }
}

/**
 * Decrypts an encrypted envelope using the 12-word recovery phrase.
 * Extracts the MEK and decrypts the vault payload.
 */
export async function decryptVaultWithRecovery(envelope, recoveryPhrase) {
  const rawMek = await unwrapMekWithRecovery(envelope, recoveryPhrase);
  const vaultData = await decryptVaultWithMek(envelope, rawMek);
  return { vaultData, rawMek };
}

/**
 * Rekey vault envelope with a new master password and optionally existing or new recovery phrase.
 */
export async function rekeyVault(vaultData, newPassword, recoveryPhrase) {
  return await encryptVault(vaultData, newPassword, recoveryPhrase);
}

/**
 * Validates master password policy:
 * - Minimum length: 10 characters
 * - Special character required if length < 16 characters
 * - Special character NOT required if length >= 16 characters
 * Returns { valid: boolean, errorCode: string|null, error: string|null }
 */
export function validateMasterPassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, errorCode: 'pwd_empty', error: 'pwd_empty' };
  }
  if (password.length < 10) {
    return { valid: false, errorCode: 'pwd_too_short', error: 'pwd_too_short' };
  }
  if (password.length < 16) {
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
    if (!hasSpecialChar) {
      return { valid: false, errorCode: 'pwd_needs_special', error: 'pwd_needs_special' };
    }
  }
  return { valid: true, errorCode: null, error: null };
}


