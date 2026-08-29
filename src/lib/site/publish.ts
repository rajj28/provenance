import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import { sha256 } from "../crypto";
import { logger } from "../logger";
import { env } from "../env";
import { loadPayloadByUserId, stableContent } from "../portfolio/payload";
import { writePortfolioFile, readRepoFile, RepoWriteError, type RepoTarget } from "./github-repo";
import { locateJsonArray, appendToJson, AppendError } from "./append";
import { locateTsArray, appendToTsArray, isSourceModule } from "./ts-append";
import { inferSchema, isUsableSchema, mapItemToRow } from "./schema-infer";
import { selectNewItems } from "./content-source";
import { deliveryEnabled, settingsOf } from "../portfolio/autopilot";

export type PublishOutcome =
  | { status: "skipped"; reason: string }
  | { status: "appended"; url: string; sha: string; added: number }
  | { status: "unchanged" }
  | { status: "committed"; url: string; sha: string }
  | { status: "pull_request"; url: string; number: number };

/**
 * Push the current portfolio into the member's own site repository.
 *
 * Called from the queue after an approval or edit, and directly from the
 * "Publish now" button. Safe to call repeatedly: an unchanged payload is
 * detected by hash and produces no commit.
 */
export async function publishToSite(userId: string, reason: string): Promise<PublishOutcome> {
  const target = await prisma.siteTarget.findUnique({ where: { userId } });
  if (!target) return { status: "skipped", reason: "No website connected." };

  // Draft mode means "never change my live website". Enforced here rather than
  // at each call site so no future caller can route around it.
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { autopilotMode: true, autopilotMinSignificance: true, autopilotMinConfidence: true },
  });
  if (owner && !deliveryEnabled(settingsOf(owner).mode)) {
    return { status: "skipped", reason: "Autopilot is set to draft only, so your website was not changed." };
  }

  const payload = await loadPayloadByUserId(userId, env.APP_URL);
  if (!payload) return { status: "skipped", reason: "User not found." };

  const repoTarget: RepoTarget = {
    owner: target.owner,
    repo: target.repo,
    branch: target.branch,
    filePath: target.filePath,
    mode: target.mode === "commit" ? "commit" : "pr",
  };

  if (target.strategy === "append") {
    return appendToExistingContent(userId, target, repoTarget, payload, reason);
  }

  const content = stableContent(payload);
  const hash = sha256(content);

  // Nothing changed since the last successful write, so writing again would
  // only add an empty commit to someone's repository history.
  if (target.lastContentHash === hash) {
    logger.info("site_publish_unchanged", { userId, reason });
    return { status: "unchanged" };
  }

  const message = `chore(portfolio): sync ${payload.counts.items} item${payload.counts.items === 1 ? "" : "s"}`;

  try {
    // The committed file carries generatedAt for humans reading the repo, even
    // though the change check deliberately ignores it.
    const fileBody = `${JSON.stringify(payload, null, 2)}\n`;
    const result = await writePortfolioFile(decryptSecret(target.encryptedToken), repoTarget, fileBody, message);

    if (result.status === "unchanged") {
      await prisma.siteTarget.update({ where: { userId }, data: { lastContentHash: hash, lastError: null } });
      return { status: "unchanged" };
    }

    await prisma.siteTarget.update({
      where: { userId },
      data: {
        lastContentHash: hash,
        lastCommitSha: result.sha,
        lastCommitUrl: result.url,
        lastPublishedAt: new Date(),
        lastError: null,
      },
    });
    await prisma.sitePublish.create({
      data: {
        userId,
        status: "ok",
        mode: repoTarget.mode,
        itemCount: payload.counts.items,
        commitSha: result.sha,
        url: result.url,
        message: reason,
      },
    });

    logger.info("site_publish_ok", { userId, mode: repoTarget.mode, items: payload.counts.items, reason });

    return result.status === "pull_request"
      ? { status: "pull_request", url: result.url, number: result.number }
      : { status: "committed", url: result.url, sha: result.sha };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Site publish failed.";
    await prisma.siteTarget.update({ where: { userId }, data: { lastError: message.slice(0, 500) } });
    await prisma.sitePublish.create({
      data: { userId, status: "error", mode: repoTarget.mode, itemCount: payload.counts.items, message },
    });
    logger.error("site_publish_failed", {
      userId,
      status: error instanceof RepoWriteError ? error.status : undefined,
      message,
    });
    throw error;
  }
}


/**
 * Append strategy: add rows to the content file the member's site already
 * renders, in that file's own shape.
 *
 * Everything here is bounded by the append-only invariant in ./append.ts. If
 * anything about the file is surprising — unparseable, ambiguous, no inferable
 * schema — we decline and say why instead of writing.
 */
async function appendToExistingContent(
  userId: string,
  target: { encryptedToken: string; filePath: string },
  repoTarget: RepoTarget,
  payload: Awaited<ReturnType<typeof loadPayloadByUserId>>,
  reason: string
): Promise<PublishOutcome> {
  if (!payload) return { status: "skipped", reason: "User not found." };
  const token = decryptSecret(target.encryptedToken);

  let source: string;
  try {
    const file = await readRepoFile(token, repoTarget.owner, repoTarget.repo, target.filePath, repoTarget.branch);
    if (file === null) {
      return { status: "skipped", reason: `${target.filePath} no longer exists in the repository.` };
    }
    source = file;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the content file.";
    await recordFailure(userId, repoTarget.mode, 0, message);
    throw error;
  }

  try {
    const isModule = isSourceModule(target.filePath);

    // Both readers expose the same thing: the rows already in the file. The
    // module reader uses a real TypeScript parser; neither one guesses.
    const existingRows = isModule
      ? locateTsArray(source, target.filePath).elements.map((el) => el.value)
      : locateJsonArray(source).rows;

    const schema = inferSchema(existingRows);
    if (!isUsableSchema(schema)) {
      return { status: "skipped", reason: `Could not infer the field names used in ${target.filePath}.` };
    }

    // Only items not already in the file, judged from the file itself.
    const fresh = selectNewItems(payload.items, existingRows, schema);
    if (fresh.length === 0) {
      await prisma.siteTarget.update({ where: { userId }, data: { lastError: null } });
      return { status: "unchanged" };
    }

    const rows = fresh.map((item) => mapItemToRow(item, schema, existingRows).row);
    // Both appenders verify their append-only invariant and throw on violation:
    // appendToJson re-serialises and diffs; appendToTsArray inserts text at one
    // offset and re-parses the result.
    const updated = isModule
      ? appendToTsArray(source, target.filePath, rows)
      : appendToJson(source, rows);

    const message = `chore(portfolio): add ${rows.length} item${rows.length === 1 ? "" : "s"}`;
    const result = await writePortfolioFile(token, repoTarget, updated, message);
    if (result.status === "unchanged") return { status: "unchanged" };

    await prisma.siteTarget.update({
      where: { userId },
      data: {
        lastCommitSha: result.sha,
        lastCommitUrl: result.url,
        lastPublishedAt: new Date(),
        lastError: null,
      },
    });
    await prisma.sitePublish.create({
      data: {
        userId,
        status: "ok",
        mode: repoTarget.mode,
        itemCount: rows.length,
        commitSha: result.sha,
        url: result.url,
        message: `append:${reason}`,
      },
    });

    logger.info("site_append_ok", { userId, added: rows.length, path: target.filePath, mode: repoTarget.mode });
    return { status: "appended", url: result.url, sha: result.sha, added: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Append failed.";
    await recordFailure(userId, repoTarget.mode, 0, message);
    if (error instanceof AppendError) {
      // A refused append is a safety stop, not a crash: report it and leave the
      // member's file exactly as it was.
      logger.warn("site_append_refused", { userId, path: target.filePath, message });
      return { status: "skipped", reason: message };
    }
    throw error;
  }
}

async function recordFailure(userId: string, mode: string, itemCount: number, message: string) {
  await prisma.siteTarget.update({ where: { userId }, data: { lastError: message.slice(0, 500) } }).catch(() => undefined);
  await prisma.sitePublish
    .create({ data: { userId, status: "error", mode, itemCount, message } })
    .catch(() => undefined);
}
