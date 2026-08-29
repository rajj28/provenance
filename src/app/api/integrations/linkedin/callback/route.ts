import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { readOAuthState } from "@/lib/oauth-state";
import { exchangeCode, LinkedInError } from "@/lib/linkedin/client";
import { saveLinkedInAccount, scopeCanPublish } from "@/lib/linkedin/account";

function back(params: Record<string, string>) {
  const url = new URL(`${env.APP_URL}/app/sources`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // LinkedIn reports a member declining consent as an error param, not a code.
  const denied = url.searchParams.get("error");
  if (denied) {
    return back({ error: "linkedin", reason: url.searchParams.get("error_description") || denied });
  }
  if (!code || !state) return back({ error: "linkedin", reason: "Missing authorization code." });

  try {
    const userId = readOAuthState(state, "linkedin");
    const token = await exchangeCode(code);
    await saveLinkedInAccount(userId, token);

    // The member can connect while the LinkedIn app still lacks the Share
    // product. Sign-in succeeds but publishing would 403 later, so say so now.
    if (!scopeCanPublish(token.scope)) {
      return back({ connected: "linkedin", warn: "no_share_scope" });
    }
    return back({ connected: "linkedin" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("linkedin_oauth_failed", {
      status: error instanceof LinkedInError ? error.status : undefined,
      message,
    });
    return back({ error: "linkedin", reason: message.slice(0, 200) });
  }
}
