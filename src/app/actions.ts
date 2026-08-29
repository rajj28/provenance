"use server";

import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { sealCredentials, ingestItem, runConnectionSync } from "@/lib/sync/engine";
import { getAdapter } from "@/lib/sources/registry";
import { enqueueSourceSync, enqueueSitePublish } from "@/lib/queue";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import type { ConnectionCredentials, EvidenceKind, SourceType } from "@/lib/sources/types";
import { signIn, signOut } from "@/auth";
import { rateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { isEvidenceKind } from "@/lib/portfolio/sections";
import { AUTOPILOT_MODES, isAutopilotMode, publishEvidence } from "@/lib/portfolio/autopilot";
import { composePost } from "@/lib/linkedin/compose";
import { createMemberPost, LinkedInError, MAX_COMMENTARY, type LinkedInVisibility } from "@/lib/linkedin/client";
import {
  clearLinkedInError,
  disconnectLinkedIn,
  getPublishCredentials,
  recordLinkedInError,
} from "@/lib/linkedin/account";
import { env } from "@/lib/env";
import { headers } from "next/headers";
import { normalizeFilePath, parseRepoInput, verifyRepoAccess, RepoWriteError } from "@/lib/site/github-repo";
import { publishToSite } from "@/lib/site/publish";
import { detectFramework } from "@/lib/site/detect";
import { discoverContentSources } from "@/lib/site/content-source";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/**
 * Best-effort client identity for rate limiting. Behind a proxy the socket
 * address is the proxy, so the forwarded header is preferred; it is only used
 * to bucket rate limits, never for authorization.
 */
async function clientKey() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

function slugify(input: string) {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24) || "member";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function signUpAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email.includes("@") || email.length > 254 || password.length < 8) {
    return { error: "Use a valid email and a password of at least 8 characters." };
  }

  const limit = await rateLimit("signup", await clientKey());
  if (!limit.ok) {
    return { error: `Too many sign-up attempts. Try again in ${limit.retryAfterSeconds} seconds.` };
  }

  try {
    await prisma.user.create({
      data: {
        name: name || email.split("@")[0],
        email,
        passwordHash: await hash(password, 12),
        slug: slugify(name || email),
      },
    });
  } catch (error) {
    // The pre-check this replaced was a TOCTOU race: two concurrent sign-ups
    // both passed `findUnique` and the second died on the unique index with an
    // unhandled 500. Let the database be the arbiter and translate P2002.
    if (isUniqueViolation(error)) return { error: "An account with that email already exists." };
    throw error;
  }

  await signIn("credentials", { email, password, redirectTo: "/app" });
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  // Sign-in throttling deliberately lives in the Credentials `authorize`
  // callback (src/auth.ts), not here: this action is only one caller, and a
  // direct POST to /api/auth/callback/credentials bypasses it entirely. Adding
  // a second check here would also double-count every UI attempt.
  // A throttled attempt therefore surfaces as the generic message below, which
  // is also the right answer — it avoids confirming that an account exists.
  try {
    await signIn("credentials", { email, password, redirectTo: "/app" });
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error) throw error;
    return { error: "Invalid email or password." };
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug") || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  if (slug && slug !== user.slug) {
    const taken = await prisma.user.findUnique({ where: { slug } });
    if (taken) return { error: "That portfolio URL is taken." };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: String(formData.get("name") || user.name || ""),
      headline: String(formData.get("headline") || "") || null,
      bio: String(formData.get("bio") || "") || null,
      targetRole: String(formData.get("targetRole") || "") || null,
      location: String(formData.get("location") || "") || null,
      slug: slug || user.slug,
      publicPortfolio: formData.get("publicPortfolio") === "on",
    },
  });
  revalidatePath("/app");
  revalidatePath(`/p/${slug || user.slug}`);
  return { ok: true };
}

export async function connectSourceAction(formData: FormData) {
  const user = await requireUser();
  const sourceType = String(formData.get("sourceType") || "") as SourceType;
  const catalog = SOURCE_CATALOG.find((s) => s.type === sourceType);
  if (!catalog?.live || sourceType === "manual") {
    return { error: "This source is not a live connector. Import evidence instead." };
  }

  const credentials: ConnectionCredentials = {};
  for (const field of catalog.fields) {
    const value = String(formData.get(field.key) || "").trim();
    if (!value && !field.optional) {
      return { error: `${field.label} is required.` };
    }
    if (value) credentials[field.key] = value;
  }

  if (sourceType === "github" && !credentials.accessToken) {
    return { error: "Paste a GitHub token, or use Connect with GitHub if OAuth is configured." };
  }

  try {
    const adapter = getAdapter(sourceType);
    const identity = adapter.identity
      ? await adapter.identity({ credentials })
      : {
          externalUserId: credentials.username || credentials.orcid || credentials.author || "default",
          displayName: credentials.username || credentials.author || credentials.orcid || sourceType,
        };

    const connection = await prisma.sourceConnection.upsert({
      where: {
        userId_sourceType_externalUserId: {
          userId: user.id,
          sourceType,
          externalUserId: identity.externalUserId,
        },
      },
      create: {
        userId: user.id,
        sourceType,
        displayName: identity.displayName,
        externalUserId: identity.externalUserId,
        profileUrl: identity.profileUrl,
        encryptedCredentials: sealCredentials(credentials),
        status: "connected",
      },
      update: {
        displayName: identity.displayName,
        profileUrl: identity.profileUrl,
        encryptedCredentials: sealCredentials(credentials),
        status: "connected",
        lastError: null,
      },
    });

    await enqueueSourceSync(connection.id, "manual-connect");
    revalidatePath("/app");
    revalidatePath("/app/sources");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not connect source." };
  }
}

export async function disconnectSourceAction(connectionId: string) {
  const user = await requireUser();
  await prisma.sourceConnection.deleteMany({ where: { id: connectionId, userId: user.id } });
  revalidatePath("/app/sources");
  revalidatePath("/app");
}

export async function syncNowAction(connectionId: string) {
  const user = await requireUser();
  const connection = await prisma.sourceConnection.findFirst({
    where: { id: connectionId, userId: user.id },
  });
  if (!connection) return { error: "Connection not found." };
  await enqueueSourceSync(connection.id, "manual-sync");
  revalidatePath("/app");
  return { ok: true };
}

export async function syncNowInlineAction(connectionId: string) {
  const user = await requireUser();
  const connection = await prisma.sourceConnection.findFirst({
    where: { id: connectionId, userId: user.id },
  });
  if (!connection) return { error: "Connection not found." };
  await runConnectionSync(connection.id, "inline-sync");
  revalidatePath("/app");
  revalidatePath("/app/discoveries");
  return { ok: true };
}

export async function reviewEvidenceAction(evidenceId: string, decision: "approved" | "rejected") {
  const user = await requireUser();
  const evidence = await prisma.evidence.findFirst({
    where: { id: evidenceId, userId: user.id },
    include: { curation: true },
  });
  if (!evidence) return { error: "Evidence not found." };

  await prisma.evidence.update({
    where: { id: evidence.id },
    data: { status: decision },
  });

  if (decision === "rejected") {
    await prisma.portfolioItem.deleteMany({ where: { evidenceId: evidence.id, userId: user.id } });
  }

  if (decision === "approved") {
    // Same helper autopilot uses, so a hand-approved item and an auto-published
    // one are byte-for-byte the same thing.
    await publishEvidence(user.id, evidence.id);
  }

  // The set of published items just changed, so mirror it to the member's own
  // website if they connected one. Queued, never inline: a repo write is a
  // slow network call and must not sit inside the approval request.
  await enqueueSitePublish(user.id, `review:${decision}`);

  revalidatePath("/app");
  revalidatePath("/app/reviews");
  revalidatePath("/app/portfolio");
  revalidatePath(`/p/${user.slug}`);
  return { ok: true };
}

export async function updatePortfolioItemAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  await prisma.portfolioItem.updateMany({
    where: { id, userId: user.id },
    data: {
      title: String(formData.get("title") || ""),
      summary: String(formData.get("summary") || ""),
      description: String(formData.get("description") || ""),
      role: String(formData.get("role") || "") || null,
      impact: String(formData.get("impact") || "") || null,
      published: formData.get("published") === "on",
    },
  });
  await enqueueSitePublish(user.id, "portfolio-edit");
  revalidatePath("/app/portfolio");
  revalidatePath(`/p/${user.slug}`);
  return { ok: true };
}

export async function importManualEvidenceAction(formData: FormData) {
  const user = await requireUser();
  const rawKind = String(formData.get("kind") || "achievement");
  // The select is client-side; an untrusted value must not become an evidence
  // kind, or it would fall through section routing into the wrong bucket.
  const kind: EvidenceKind = isEvidenceKind(rawKind) ? rawKind : "achievement";
  const title = String(formData.get("title") || "").trim();
  const url = String(formData.get("url") || "").trim() || undefined;
  const summary = String(formData.get("summary") || "").trim();
  const issuer = String(formData.get("issuer") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const sourceLabel = String(formData.get("sourceLabel") || "manual");
  if (!title) return { error: "Title is required." };

  await ingestItem(
    user.id,
    null,
    {
      sourceType: "manual",
      kind,
      externalId: `${sourceLabel}:${title}:${date || "undated"}`,
      url,
      title,
      summary: summary || undefined,
      occurredAt: date ? new Date(date) : undefined,
      payload: {
        issuer: issuer || null,
        date: date || null,
        userSummary: summary || null,
        sourceLabel,
        providedByUser: true,
      },
    },
    user.targetRole
  );
  revalidatePath("/app/discoveries");
  revalidatePath("/app/reviews");
  return { ok: true };
}

export async function goHome() {
  redirect("/app");
}


/* ------------------------------------------------------------------ *
 * LinkedIn publishing
 *
 * LinkedIn cannot be read from — `r_member_social` is partner-restricted — so
 * there is no import action here. What a self-serve app *can* do is publish,
 * and every publish below is an explicit, per-item user action with the exact
 * text shown beforehand. Nothing posts automatically.
 * ------------------------------------------------------------------ */

export async function disconnectLinkedInAction() {
  const user = await requireUser();
  await disconnectLinkedIn(user.id);
  revalidatePath("/app/sources");
  revalidatePath("/app/portfolio");
  return { ok: true };
}

/** Draft text for an item, so the UI can show exactly what would be posted. */
export async function draftLinkedInPostAction(portfolioItemId: string) {
  const user = await requireUser();
  const item = await prisma.portfolioItem.findFirst({
    where: { id: portfolioItemId, userId: user.id },
    include: { evidence: true },
  });
  if (!item) return { error: "Portfolio item not found." };
  return { ok: true, text: composePost(item, `${env.APP_URL}/p/${user.slug}`) };
}

export async function shareToLinkedInAction(
  portfolioItemId: string,
  commentary: string,
  visibility: LinkedInVisibility = "PUBLIC"
) {
  const user = await requireUser();

  const text = commentary.trim();
  if (!text) return { error: "Write something to post." };
  if (text.length > MAX_COMMENTARY) {
    return { error: `Post is ${text.length} characters; LinkedIn allows ${MAX_COMMENTARY}.` };
  }
  if (visibility !== "PUBLIC" && visibility !== "CONNECTIONS") {
    return { error: "Choose a valid audience." };
  }

  const item = await prisma.portfolioItem.findFirst({
    where: { id: portfolioItemId, userId: user.id },
    include: { evidence: true },
  });
  if (!item) return { error: "Portfolio item not found." };

  const credentials = await getPublishCredentials(user.id);
  if (!credentials) {
    return { error: "Connect LinkedIn first, or reconnect if the authorisation has expired." };
  }

  // LinkedIn allows 150 member posts per day; throttle well under that so a
  // runaway client cannot burn the member's quota.
  const limit = await rateLimit("linkedin:post", user.id, 20, 3600);
  if (!limit.ok) {
    return { error: `Slow down — try again in ${limit.retryAfterSeconds} seconds.` };
  }

  try {
    const result = await createMemberPost({
      accessToken: credentials.accessToken,
      authorUrn: credentials.authorUrn,
      commentary: text,
      visibility,
      article: item.evidence.url
        ? { source: item.evidence.url, title: item.title.slice(0, 200), description: item.summary.slice(0, 300) }
        : undefined,
    });

    await prisma.linkedinPost.create({
      data: {
        userId: user.id,
        portfolioItemId: item.id,
        postUrn: result.postUrn,
        postUrl: result.postUrl,
        commentary: text,
        visibility,
      },
    });
    await clearLinkedInError(user.id);
    logger.info("linkedin_post_created", { userId: user.id, portfolioItemId: item.id, postUrn: result.postUrn });

    revalidatePath("/app/portfolio");
    return { ok: true, postUrl: result.postUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish to LinkedIn.";
    await recordLinkedInError(user.id, message);
    logger.error("linkedin_post_failed", {
      userId: user.id,
      portfolioItemId: item.id,
      status: error instanceof LinkedInError ? error.status : undefined,
      message,
    });
    return { error: message };
  }
}


/* ------------------------------------------------------------------ *
 * Website delivery
 *
 * Two ways a member's own site stays current:
 *   A. It fetches GET /api/portfolio/{slug} (via public/embed.js or their own
 *      code). Nothing to configure here — it is live the moment they publish.
 *   B. This app commits the same payload into their site's repository, below.
 * ------------------------------------------------------------------ */

export async function connectSiteAction(formData: FormData) {
  const user = await requireUser();

  const repoInput = String(formData.get("repo") || "");
  const parsed = parseRepoInput(repoInput);
  if (!parsed) {
    return { error: "Enter the repository as owner/repo or a github.com URL." };
  }

  const branch = String(formData.get("branch") || "main").trim() || "main";
  if (!/^[\w.\-/]{1,255}$/.test(branch)) return { error: "That branch name is not valid." };

  const rawPath = String(formData.get("filePath") || "").trim();
  const strategyRaw = String(formData.get("strategy") || "file") === "append" ? "append" : "file";
  // Only append mode may target a source module; the file-owning strategy
  // overwrites the whole file and must stay JSON-only.
  const filePath = normalizeFilePath(rawPath || "data/portfolio.json", strategyRaw === "append");
  if (!filePath) {
    return { error: "The file path must be a .json file inside the repository, with no leading slash or '..'." };
  }

  const mode = String(formData.get("mode") || "pr") === "commit" ? "commit" : "pr";
  const strategy = strategyRaw;
  const token = String(formData.get("token") || "").trim();
  if (!token) return { error: "A GitHub token with Contents write access is required." };

  try {
    // Fail here rather than silently on the first background publish.
    const info = await verifyRepoAccess(token, { owner: parsed.owner, repo: parsed.repo, branch });

    // Detect the framework so the member does not have to know where their
    // generator expects data files. Only overrides the path when they left the
    // default untouched — an explicit choice always wins.
    const detected = await detectFramework(token, parsed.owner, parsed.repo, branch);
    const usedDefault = String(formData.get("filePath") || "").trim() === "";
    // Append mode always targets an explicit existing content file; only the
    // "own a file" strategy gets a framework-derived default.
    const resolvedPath =
      strategy === "file" && usedDefault && detected.confidence === "high" ? detected.suggestedPath : filePath;

    const data = {
      provider: "github",
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      filePath: resolvedPath,
      mode,
      strategy,
      encryptedToken: encryptSecret(token),
      // Force a real write on the next publish even if a previous target had
      // the identical payload hash.
      lastContentHash: null,
      lastError: null,
    };

    await prisma.siteTarget.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });

    logger.info("site_target_connected", { userId: user.id, mode, framework: detected.id, private: info.private });
    revalidatePath("/app/sources");
    return {
      ok: true,
      defaultBranch: info.defaultBranch,
      framework: detected.name,
      filePath: resolvedPath,
      usageHint: detected.usageHint,
    };
  } catch (error) {
    const message = error instanceof RepoWriteError ? error.message : "Could not verify repository access.";
    return { error: message };
  }
}

export async function disconnectSiteAction() {
  const user = await requireUser();
  await prisma.siteTarget.deleteMany({ where: { userId: user.id } });
  revalidatePath("/app/sources");
  return { ok: true };
}

/** Run a repo write immediately, so the member can see it work. */
export async function publishSiteNowAction() {
  const user = await requireUser();

  const limit = await rateLimit("site:publish", user.id, 10, 600);
  if (!limit.ok) return { error: `Too many publishes. Try again in ${limit.retryAfterSeconds} seconds.` };

  try {
    const result = await publishToSite(user.id, "manual");
    revalidatePath("/app/sources");
    if (result.status === "skipped") return { error: result.reason };
    if (result.status === "unchanged") return { ok: true, message: "Already up to date — nothing to commit." };
    if (result.status === "pull_request") {
      return { ok: true, message: `Opened pull request #${result.number}.`, url: result.url };
    }
    return { ok: true, message: "Committed to your repository.", url: result.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Publish failed." };
  }
}


/** Autopilot: how much the system may do without the member present. */
export async function updateAutopilotAction(formData: FormData) {
  const user = await requireUser();
  const mode = String(formData.get("autopilotMode") || "review");
  if (!isAutopilotMode(mode)) return { error: "Choose a valid autopilot mode." };

  const clamp = (value: string, fallback: number) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, n));
  };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      autopilotMode: mode,
      autopilotMinSignificance: clamp(String(formData.get("minSignificance") || ""), 70),
      autopilotMinConfidence: clamp(String(formData.get("minConfidence") || ""), 70),
    },
  });

  logger.info("autopilot_updated", { userId: user.id, mode });
  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { ok: true, modes: AUTOPILOT_MODES.length };
}


/**
 * Scan the connected repository for the content file its site already renders,
 * so the member can pick one instead of learning where their generator looks.
 */
export async function scanSiteContentAction() {
  const user = await requireUser();
  const target = await prisma.siteTarget.findUnique({ where: { userId: user.id } });
  if (!target) return { error: "Connect a repository first." };

  const limit = await rateLimit("site:scan", user.id, 10, 600);
  if (!limit.ok) return { error: `Too many scans. Try again in ${limit.retryAfterSeconds} seconds.` };

  try {
    const { candidates, rejected } = await discoverContentSources(
      decryptSecret(target.encryptedToken),
      target.owner,
      target.repo,
      target.branch
    );
    return {
      ok: true,
      candidates: candidates.map((c) => ({
        path: c.path,
        entryCount: c.entryCount,
        fields: Object.values(c.schema.fieldMap) as string[],
        unmapped: c.schema.unmapped,
        kind: c.kind,
        exportName: c.exportName ?? null,
        opaqueKeys: c.opaqueKeys,
      })),
      rejected,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not scan the repository." };
  }
}

/** Point the append strategy at a specific content file the member chose. */
export async function selectContentFileAction(path: string) {
  const user = await requireUser();
  const filePath = normalizeFilePath(path, true);
  if (!filePath) return { error: "That path is not a supported content file inside the repository." };

  const updated = await prisma.siteTarget.updateMany({
    where: { userId: user.id },
    data: { filePath, strategy: "append", lastContentHash: null, lastError: null },
  });
  if (updated.count === 0) return { error: "Connect a repository first." };

  revalidatePath("/app/sources");
  return { ok: true, filePath };
}
