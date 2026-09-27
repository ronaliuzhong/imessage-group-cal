import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

// How the iPhone app signs in (OAuth-style, with PKCE):
//
// 1. The app makes a random secret (the "verifier") and opens
//    /app-auth?challenge=<SHA-256 of the verifier> in a secure browser window.
// 2. The person signs in with Google there, exactly like on the website.
// 3. /api/app/auth/finish sends the browser to APP_CALLBACK_URL with a
//    one-time code, which hands control back to the app.
// 4. The app posts the code and its verifier to /api/app/token and gets a
//    long-lived token, sent as "Authorization: Bearer <token>" from then on.
//
// If another app intercepts the code in step 3, it can't use it: it doesn't
// know the verifier.

// Where the browser window returns to the app. Must match the URL scheme set
// up in the iOS app. ("groupcal" is a placeholder until the app is named.)
export const APP_CALLBACK_URL = "groupcal://auth";

const CODE_LIFETIME_MS = 2 * 60_000;
// Writing lastUsedAt on every request is wasteful; once an hour is plenty.
const LAST_USED_RESOLUTION_MS = 60 * 60_000;

// SHA-256, base64url-encoded. Used for PKCE challenges and for storing codes
// and tokens (only their hashes go in the database).
export function sha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

// PKCE challenges are base64url SHA-256 hashes: 43 characters. The spec
// allows up to 128.
export function isValidChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(challenge);
}

// Whether `verifier` is the secret behind `challenge`.
export function verifierMatches(verifier: string, challenge: string) {
  const a = Buffer.from(sha256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

// Step 3: a one-time code for a signed-in user.
export async function createAuthCode(userId: string, codeChallenge: string) {
  const code = randomSecret();
  await prisma.appAuthCode.create({
    data: {
      codeHash: sha256(code),
      userId,
      codeChallenge,
      expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
    },
  });
  return code;
}

// Step 4: trade a code (plus the verifier) for a token. Returns null if the
// code is unknown, used, expired, or the verifier doesn't match.
export async function exchangeAuthCode(code: string, verifier: string) {
  const codeHash = sha256(code);
  const row = await prisma.appAuthCode.findUnique({ where: { codeHash }, include: { user: true } });
  if (!row) return null;
  // Only one request can delete the row, so the code works once even if two
  // requests race. (A wrong verifier burns the code too; the app starts over.)
  const { count } = await prisma.appAuthCode.deleteMany({ where: { codeHash } });
  if (count === 0 || row.expiresAt < new Date() || !verifierMatches(verifier, row.codeChallenge)) {
    return null;
  }
  const token = randomSecret();
  await prisma.appToken.create({ data: { tokenHash: sha256(token), userId: row.userId } });
  return { token, user: row.user };
}

function bearerToken(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer (\S+)$/);
  return match?.[1] ?? null;
}

// The signed-in user behind an app request, or null.
export async function appUserFrom(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const row = await prisma.appToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!row) return null;
  if (Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.appToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { id: row.user.id, name: row.user.name ?? row.user.email, email: row.user.email };
}

// Sign this device out. Returns whether there was a token to delete.
export async function revokeAppToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  const { count } = await prisma.appToken.deleteMany({ where: { tokenHash: sha256(token) } });
  return count > 0;
}
