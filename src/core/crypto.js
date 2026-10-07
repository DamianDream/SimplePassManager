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
