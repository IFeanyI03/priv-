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
 * Used for generating the User's Master Vault Key.
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
        ["deriveKey"],
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
        false, // IMPORTANT: Vault Key is non-extractable!
        ["encrypt", "decrypt"],
    );
}

/**
 * 3. Encrypt Data
 * General purpose encryption (used for passwords and generic data).
 */
export async function encryptData(plainText, key) {
    if (!plainText || !key) throw new Error("Missing text or key");

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes standard IV
    const encoded = new TextEncoder().encode(plainText);

    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: ENCRYPT_ALGO, iv: iv },
        key,
        encoded,
    );

    // Return format: "iv_base64:ciphertext_base64"
    const ivBase64 = arrayBufferToBase64(iv.buffer);
    const contentBase64 = arrayBufferToBase64(encryptedBuffer);
    return `${ivBase64}:${contentBase64}`;
}

/**
 * 4. Decrypt Data
 * General purpose decryption.
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
            content,
        );

        return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
        console.error("Decryption failed (Wrong password?):", err);
        throw err;
    }
}

// -----------------------------------------------------------------------------
// NEW: Item Key Management (For Shared/Live Update Architecture)
// -----------------------------------------------------------------------------

/**
 * Generate a random AES-GCM key (The "Item Key")
 * This key is specific to one credential item.
 * It MUST be extractable so we can wrap (encrypt) it.
 */
export async function generateItemKey() {
    return await crypto.subtle.generateKey(
        { name: ENCRYPT_ALGO, length: 256 },
        true, // Extractable = true
        ["encrypt", "decrypt"],
    );
}

/**
 * Export a Key to RAW bytes
 * Helper to turn a CryptoKey into a Uint8Array.
 */
export async function exportKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return new Uint8Array(exported);
}

/**
 * Import a Key from RAW bytes
 * Helper to turn a Uint8Array back into a CryptoKey.
 */
export async function importKey(rawBuffer) {
    return await crypto.subtle.importKey(
        "raw",
        rawBuffer,
        { name: ENCRYPT_ALGO },
        true, // Must be extractable to allow re-sharing later
        ["encrypt", "decrypt"],
    );
}

/**
 * Wrap (Encrypt) an Item Key
 * 1. Exports the Item Key to raw bytes.
 * 2. Encrypts those bytes using the Wrapping Key (e.g., User's Session Key or a Share Link Key).
 * Returns: "iv:encrypted_key_blob"
 */
export async function wrapKey(keyToWrap, wrappingKey) {
    // 1. Get raw bytes of the key we want to protect
    const rawKeyData = await exportKey(keyToWrap);

    // 2. Encrypt those bytes
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedKeyBuffer = await crypto.subtle.encrypt(
        { name: ENCRYPT_ALGO, iv: iv },
        wrappingKey,
        rawKeyData,
    );

    // 3. Format as string
    const ivBase64 = arrayBufferToBase64(iv.buffer);
    const contentBase64 = arrayBufferToBase64(encryptedKeyBuffer);
    return `${ivBase64}:${contentBase64}`;
}

/**
 * Unwrap (Decrypt) an Item Key
 * 1. Decrypts the blob using the Unwrapping Key (e.g., User's Session Key).
 * 2. Imports the resulting bytes back into a usable CryptoKey.
 */
export async function unwrapKey(wrappedKeyStr, unwrappingKey) {
    const [ivBase64, contentBase64] = wrappedKeyStr.split(":");
    if (!ivBase64 || !contentBase64)
        throw new Error("Invalid wrapped key format");

    const iv = base64ToArrayBuffer(ivBase64);
    const content = base64ToArrayBuffer(contentBase64);

    // 1. Decrypt the raw key bytes
    const decryptedRawKey = await crypto.subtle.decrypt(
        { name: ENCRYPT_ALGO, iv: new Uint8Array(iv) },
        unwrappingKey,
        content,
    );

    // 2. Import back to CryptoKey object
    return await importKey(decryptedRawKey);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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
