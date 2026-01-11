// lib/crypto.js

// Configuration for PBKDF2
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const SALT_SIZE = 16; // 16 bytes
const HASH_ALGO = "SHA-256";
const ENCRYPT_ALGO = "AES-GCM";

/**
 * 1. Generate a random Salt
 * We need this to prevent Rainbow Table attacks.
 */
export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

/**
 * 2. Derive the Key from Password + Salt
 * This is the CPU-intensive part that makes brute-forcing hard.
 */
export async function deriveKey(password, salt) {
  const textEncoder = new TextEncoder();
  const passwordBuffer = textEncoder.encode(password);

  // Import the password as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  // Derive the actual AES-GCM key
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGO,
    },
    keyMaterial,
    { name: ENCRYPT_ALGO, length: 256 },
    false, // IMPORTANT: Key is non-extractable!
    ["encrypt", "decrypt"]
  );
}

/**
 * 3. Encrypt Data
 * Requires the derived KEY object, not just a string.
 */
export async function encryptData(plainText, key) {
  if (!plainText || !key) throw new Error("Missing text or key");

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes standard IV
  const encoded = new TextEncoder().encode(plainText);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ENCRYPT_ALGO, iv: iv },
    key,
    encoded
  );

  // Return format: "iv_base64:ciphertext_base64"
  const ivBase64 = arrayBufferToBase64(iv.buffer);
  const contentBase64 = arrayBufferToBase64(encryptedBuffer);
  return `${ivBase64}:${contentBase64}`;
}

/**
 * 4. Decrypt Data
 */
export async function decryptData(encryptedString, key) {
  if (!encryptedString || !key) return null;
  
  try {
    const [ivBase64, contentBase64] = encryptedString.split(":");
    if (!ivBase64 || !contentBase64) throw new Error("Invalid format");

    const iv = base64ToArrayBuffer(ivBase64);
    const content = base64ToArrayBuffer(contentBase64);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: ENCRYPT_ALGO, iv: new Uint8Array(iv) },
      key,
      content
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error("Decryption failed (Wrong password?):", err);
    throw err;
  }
}

// --- Helpers ---

export function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}