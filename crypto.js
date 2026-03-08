// 1. Derive a CryptoKey from the PIN
async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// 2. Encrypt Data
async function encryptData(data, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // Initialization Vector
  const key = await deriveKey(pin, salt);
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoder.encode(JSON.stringify(data)),
  );

  // Return everything needed to decrypt later
  return {
    ciphertext: Array.from(new Uint8Array(encrypted)),
    salt: Array.from(salt),
    iv: Array.from(iv),
  };
}

// 3. Decrypt Data
async function decryptData(encryptedObj, pin) {
  const { ciphertext, salt, iv } = encryptedObj;
  const key = await deriveKey(pin, new Uint8Array(salt));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext),
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}
