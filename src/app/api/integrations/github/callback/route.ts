import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/sources/registry";
import { sealCredentials } from "@/lib/sync/engine";
import { enqueueSourceSync } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { readOAuthState } from "@/lib/oauth-state";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appUrl = env.APP_URL;
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/app/sources?error=github_oauth`);
  }

  try {
    const userId = readOAuthState(state, "github");
    const body = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID || "",
      client_secret: env.GITHUB_CLIENT_SECRET || "",
      code,
      redirect_uri: `${appUrl}/api/integrations/github/callback`,
    });
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json" },
      body,
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenJson.access_token) throw new Error(tokenJson.error || "No access token");

    const credentials = { accessToken: tokenJson.access_token };
    const identity = await getAdapter("github").identity!({ credentials });
    const connection = await prisma.sourceConnection.upsert({
      where: {
        userId_sourceType_externalUserId: {
          userId,
          sourceType: "github",
          externalUserId: identity.externalUserId,
        },
      },
      create: {
        userId,
        sourceType: "github",
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
    await enqueueSourceSync(connection.id, "github-oauth");
    return NextResponse.redirect(`${appUrl}/app/sources?connected=github`);
  } catch (error) {
    logger.error("github_oauth_failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.redirect(`${appUrl}/app/sources?error=github_oauth`);
  }
}
