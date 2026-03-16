/**
 * Bitwarden Client-Side Crypto Engine
 * Implements: PBKDF2/Argon2 key derivation, HKDF stretch, AES-256-CBC decrypt
 * All operations use Web Crypto API (zero external deps for PBKDF2 path)
 */

// KDF types used by Bitwarden
export const KdfType = { PBKDF2: 0, Argon2id: 1 };

// CipherString encryption types
const EncType = {
  AesCbc256_B64: 0,
  AesCbc128_HmacSha256_B64: 1,
  AesCbc256_HmacSha256_B64: 2,
};

/**
 * Derive the Master Key from master password + email using PBKDF2 or Argon2
 */
export async function makeMasterKey(password, email, kdfConfig) {
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = new TextEncoder().encode(email.toLowerCase().trim());

  if (kdfConfig.kdf === KdfType.Argon2id) {
    // Dynamic import for argon2-browser (only loaded if needed)
    const argon2 = await import(/* @vite-ignore */ 'argon2-browser');
    const result = await argon2.hash({
      pass: passwordBytes,
      salt: createArgon2Salt(saltBytes),
      time: kdfConfig.kdfIterations,
      mem: kdfConfig.kdfMemory * 1024, // MB to KB
      parallelism: kdfConfig.kdfParallelism,
      hashLen: 32,
      type: argon2.ArgonType.Argon2id,
    });
    return result.hash;
  }

  // PBKDF2-SHA256
  const key = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: kdfConfig.kdfIterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

function createArgon2Salt(emailBytes) {
  // Bitwarden uses a 32-byte salt derived from email via SHA-256
  // For Argon2, the salt is the SHA-256 hash of the email
  return crypto.subtle.digest('SHA-256', emailBytes).then(h => new Uint8Array(h));
}

/**
 * Stretch the 256-bit Master Key into a 512-bit Stretched Master Key
 * 
 * IMPORTANT: Bitwarden uses HKDF-Expand ONLY (not full HKDF).
 * The master key is used directly as the PRK (pseudo-random key).
 * Web Crypto's HKDF does Extract+Expand, which would give wrong results.
 * So we implement HKDF-Expand manually with HMAC-SHA256.
 */
export async function stretchKey(masterKey) {
  const encKey = await hkdfExpand(masterKey, 'enc', 32);
  const macKey = await hkdfExpand(masterKey, 'mac', 32);
  return { encKey, macKey };
}

/**
 * HKDF-Expand (RFC 5869 Section 2.3)
 * T(1) = HMAC-Hash(PRK, info || 0x01)
 * For L <= HashLen (32 bytes), only T(1) is needed.
 */
async function hkdfExpand(prk, info, length) {
  const hmacKey = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const infoBytes = new TextEncoder().encode(info);
  const input = new Uint8Array(infoBytes.length + 1);
  input.set(infoBytes);
  input[infoBytes.length] = 1; // counter byte = 0x01

  const result = await crypto.subtle.sign('HMAC', hmacKey, input);
  return new Uint8Array(result).slice(0, length);
}

/**
 * Hash the master password for sending to the server
 * = PBKDF2(masterKey, password, 1 iteration)
 */
export async function hashPassword(password, masterKey) {
  const passwordBytes = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', masterKey, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: passwordBytes, iterations: 1, hash: 'SHA-256' },
    key,
    256
  );
  return arrayToB64(new Uint8Array(bits));
}

/**
 * Decrypt the Protected Symmetric Key returned by the server
 * The "Key" field in the login response is a CipherString
 */
export async function decryptSymmetricKey(protectedKeyStr, stretchedKey) {
  const decrypted = await decryptCipherString(protectedKeyStr, stretchedKey);
  // The symmetric key is 64 bytes: first 32 = enc key, last 32 = mac key
  return {
    encKey: decrypted.slice(0, 32),
    macKey: decrypted.slice(32, 64),
  };
}

/**
 * Decrypt a Bitwarden CipherString
 * Format: "encType.iv|data|mac" or "encType.iv|data"
 */
export async function decryptCipherString(cipherString, keys) {
  if (!cipherString) return null;

  const { encType, iv, data, mac } = parseCipherString(cipherString);

  if (encType === EncType.AesCbc256_HmacSha256_B64) {
    // Verify HMAC first
    if (mac) {
      const macKeyObj = await crypto.subtle.importKey('raw', keys.macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const macData = new Uint8Array([...iv, ...data]);
      const valid = await crypto.subtle.verify('HMAC', macKeyObj, mac, macData);
      if (!valid) throw new Error('HMAC verification failed');
    }
  }

  // Decrypt with AES-CBC
  const aesKey = await crypto.subtle.importKey('raw', keys.encKey, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, data);
  return new Uint8Array(decrypted);
}

/**
 * Decrypt a CipherString to a UTF-8 string
 */
export async function decryptToString(cipherString, keys) {
  if (!cipherString) return null;
  const bytes = await decryptCipherString(cipherString, keys);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

/**
 * Encrypt a plaintext string into a Bitwarden CipherString
 * Returns format: "2.{iv_b64}|{ciphertext_b64}|{mac_b64}"
 * Uses AesCbc256_HmacSha256_B64 (encType 2)
 */
export async function encryptString(plaintext, keys) {
  if (!plaintext) return null;
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Generate random 16-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(16));

  // Encrypt with AES-CBC-256
  const aesKey = await crypto.subtle.importKey('raw', keys.encKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, plaintextBytes);
  const ciphertext = new Uint8Array(encrypted);

  // HMAC-SHA256(macKey, iv + ciphertext)
  const macKey = await crypto.subtle.importKey('raw', keys.macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const macData = new Uint8Array([...iv, ...ciphertext]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, macData));

  // Return CipherString: "2.iv|data|mac"
  return `2.${arrayToB64(iv)}|${arrayToB64(ciphertext)}|${arrayToB64(mac)}`;
}

/**
 * Parse a CipherString into its components
 */
function parseCipherString(str) {
  const dotIndex = str.indexOf('.');
  const encType = parseInt(str.substring(0, dotIndex), 10);
  const parts = str.substring(dotIndex + 1).split('|');

  return {
    encType,
    iv: b64ToArray(parts[0]),
    data: b64ToArray(parts[1]),
    mac: parts[2] ? b64ToArray(parts[2]) : null,
  };
}

// --- Utility ---

function b64ToArray(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function arrayToB64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}
