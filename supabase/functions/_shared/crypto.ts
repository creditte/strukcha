// AES-256-GCM encryption/decryption for Xero tokens
// Format: hex(iv):hex(ciphertext+tag)

const ALGO = "AES-GCM";
const IV_BYTES = 12;

async function getKey(): Promise<CryptoKey> {
  const hexKey = Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY");
  if (!hexKey || hexKey.length !== 64) {
    throw new Error("XERO_TOKEN_ENCRYPTION_KEY must be a 64-char hex string (256 bits)");
  }
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(hexKey.substring(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  return `${toHex(iv)}:${toHex(ciphertext)}`;
}

export async function decryptToken(encrypted: string): Promise<string> {
  // If the value doesn't contain ":", it's a legacy plain-text token
  if (!encrypted.includes(":")) {
    return encrypted;
  }
  const [ivHex, ctHex] = encrypted.split(":");
  const key = await getKey();
  const iv = fromHex(ivHex);
  const ciphertext = fromHex(ctHex);
  const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}
