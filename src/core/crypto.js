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
export async function encryptVault(data, masterPassword) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const key = await deriveKey(masterPassword, salt);
  const plaintext = enc.encode(JSON.stringify(data));

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
 * Throws an Error if the password is wrong or data is tampered.
 */
export async function decryptVault(envelope, masterPassword) {
  if (!envelope || !envelope.salt || !envelope.iv || !envelope.data) {
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
 * Validates master password policy:
 * - Strictly > 8 characters (at least 9 chars)
 * - Includes at least one special character
 */
export function validateMasterPassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Введите мастер-пароль' };
  }
  if (password.length <= 8) {
    return { valid: false, error: 'Мастер-пароль должен содержать более 8 символов' };
  }
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
  if (!hasSpecialChar) {
    return { valid: false, error: 'Пароль должен включать минимум один спецсимвол (!@#$%^&*...)' };
  }
  return { valid: true, error: null };
}

/**
 * Generates a random 6-digit numeric PIN
 */
export function generateSharePin() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = (arr[0] % 900000) + 100000;
  return num.toString();
}

/**
 * Derives an ephemeral AES-GCM key from a 6-digit PIN
 */
async function derivePinKey(pin, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts secret item with PIN and 2-minute expiration TTL
 */
export async function encryptSharePayload(item, pin, ttlMs = 120000) {
  const exp = Date.now() + ttlMs;
  const payload = {
    title: item.title || '',
    username: item.username || '',
    password: item.password || '',
    url: item.url || '',
    notes: item.notes || '',
    exp
  };

  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await derivePinKey(pin, salt);
  const plaintext = enc.encode(JSON.stringify(payload));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const envelope = {
    spShare: true,
    v: 1,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    data: bufferToBase64(ciphertext),
    exp
  };

  const rawJson = JSON.stringify(envelope);
  const token = 'SPASS1:' + bufferToBase64(enc.encode(rawJson));
  return { envelope, token, exp };
}

/**
 * Decrypts shared payload using entered PIN
 * Validates 2-minute expiration TTL
 */
export async function decryptSharePayload(tokenOrEnvelope, pin) {
  let envelope = tokenOrEnvelope;
  if (typeof tokenOrEnvelope === 'string') {
    let rawJsonStr = tokenOrEnvelope.trim();
    if (rawJsonStr.startsWith('SPASS1:')) {
      const b64 = rawJsonStr.slice(7);
      const dec = new TextDecoder();
      rawJsonStr = dec.decode(base64ToBuffer(b64));
    }
    envelope = JSON.parse(rawJsonStr);
  }

  if (!envelope || !envelope.spShare || !envelope.data || !envelope.salt || !envelope.iv) {
    throw new Error('Некорректный формат зашифрованного пакета.');
  }

  const now = Date.now();
  if (envelope.exp && now > envelope.exp) {
    throw new Error('Срок действия ключа (2 минуты) истек.');
  }

  const salt = new Uint8Array(base64ToBuffer(envelope.salt));
  const iv = new Uint8Array(base64ToBuffer(envelope.iv));
  const ciphertext = base64ToBuffer(envelope.data);

  const key = await derivePinKey(pin.trim(), salt);
  const dec = new TextDecoder();

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const item = JSON.parse(dec.decode(decryptedBuffer));
    if (item.exp && now > item.exp) {
      throw new Error('Срок действия ключа (2 минуты) истек.');
    }
    return item;
  } catch (err) {
    if (err.message && err.message.includes('истек')) {
      throw err;
    }
    throw new Error('Неверный PIN-код или поврежденные данные.');
  }
}

