import { createHmac, randomBytes } from "crypto";
import { env } from "./env";
import { safeEqual } from "./crypto";

/**
 * Signed, time-bound OAuth `state` values.
 *
 * The state binds the callback to the user who started the flow and proves the
 * request originated here. It carries an issue timestamp so a leaked
 * authorization URL cannot be replayed indefinitely, and it is compared in
 * constant time.
 */

const MAX_AGE_MS = 10 * 60 * 1000;

function sign(payload: string) {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("hex");
}

export function createOAuthState(userId: string, provider: string) {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now().toString(36);
  const payload = `${provider}:${userId}:${nonce}:${issuedAt}`;
  return Buffer.from(`${payload}:${sign(payload)}`).toString("base64url");
}

export class OAuthStateError extends Error {}

export function readOAuthState(state: string, provider: string): string {
  let raw: string;
  try {
    raw = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new OAuthStateError("Malformed OAuth state.");
  }

  const parts = raw.split(":");
  if (parts.length !== 5) throw new OAuthStateError("Malformed OAuth state.");
  const [gotProvider, userId, nonce, issuedAt, signature] = parts;

  const payload = `${gotProvider}:${userId}:${nonce}:${issuedAt}`;
  if (!safeEqual(signature, sign(payload))) throw new OAuthStateError("OAuth state signature mismatch.");
  if (gotProvider !== provider) throw new OAuthStateError("OAuth state provider mismatch.");

  const issued = Number.parseInt(issuedAt, 36);
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS) {
    throw new OAuthStateError("OAuth state expired. Start the connection again.");
  }

  return userId;
}
