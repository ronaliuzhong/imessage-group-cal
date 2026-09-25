import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts Google OAuth tokens before they go into the database, so a leaked
// database dump alone doesn't give anyone access to people's calendars.
//
// Output format: "v1.<iv>.<authTag>.<ciphertext>" (each part base64url).
// The "v1" prefix lets us change the scheme later without breaking old rows.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set (see .env)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  // A fresh random IV per message means encrypting the same token twice
  // produces different output, which leaks nothing about repeated values.
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognized encrypted token format");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "base64url"));
  // GCM checks this tag during final(): tampered data throws instead of
  // silently decrypting to garbage.
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
