import { prisma } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { fetchProfile, personUrn, type LinkedInToken } from "./client";

/**
 * Persistence for the connected LinkedIn account.
 *
 * The access token is encrypted at rest with the same AES-256-GCM helper used
 * for source credentials, and is only ever decrypted inside a publish call.
 */

export type LinkedInAccountView = {
  id: string;
  displayName: string | null;
  pictureUrl: string | null;
  personUrn: string;
  expiresAt: Date;
  expired: boolean;
  canPublish: boolean;
  scope: string;
  lastError: string | null;
};

/** LinkedIn only grants w_member_social when the app has the Share product. */
export function scopeCanPublish(scope: string) {
  return scope.split(/[\s,]+/).includes("w_member_social");
}

export async function saveLinkedInAccount(userId: string, token: LinkedInToken) {
  const profile = await fetchProfile(token.accessToken);
  const data = {
    personUrn: personUrn(profile.sub),
    displayName: profile.name ?? null,
    pictureUrl: profile.picture ?? null,
    encryptedAccessToken: encryptSecret(token.accessToken),
    scope: token.scope,
    expiresAt: token.expiresAt,
    lastError: null,
  };
  return prisma.linkedinAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function getLinkedInAccount(userId: string): Promise<LinkedInAccountView | null> {
  const account = await prisma.linkedinAccount.findUnique({ where: { userId } });
  if (!account) return null;
  return {
    id: account.id,
    displayName: account.displayName,
    pictureUrl: account.pictureUrl,
    personUrn: account.personUrn,
    expiresAt: account.expiresAt,
    expired: account.expiresAt.getTime() <= Date.now(),
    canPublish: scopeCanPublish(account.scope),
    scope: account.scope,
    lastError: account.lastError,
  };
}

/**
 * Return a usable access token, or null when the member must reconnect.
 * Kept separate from the view so the token never leaks into a page payload.
 */
export async function getPublishCredentials(userId: string) {
  const account = await prisma.linkedinAccount.findUnique({ where: { userId } });
  if (!account) return null;
  if (account.expiresAt.getTime() <= Date.now()) return null;
  if (!scopeCanPublish(account.scope)) return null;
  return {
    accessToken: decryptSecret(account.encryptedAccessToken),
    authorUrn: account.personUrn,
  };
}

export async function recordLinkedInError(userId: string, message: string) {
  await prisma.linkedinAccount
    .update({ where: { userId }, data: { lastError: message.slice(0, 500) } })
    .catch(() => undefined);
}

export async function clearLinkedInError(userId: string) {
  await prisma.linkedinAccount.update({ where: { userId }, data: { lastError: null } }).catch(() => undefined);
}

export async function disconnectLinkedIn(userId: string) {
  await prisma.linkedinAccount.deleteMany({ where: { userId } });
}
