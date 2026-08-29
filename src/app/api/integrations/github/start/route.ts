import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { createOAuthState } from "@/lib/oauth-state";
import { env, githubOAuthConfigured } from "@/lib/env";

export async function GET() {
  const user = await requireUser();
  if (!githubOAuthConfigured) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID is not configured. Use a personal access token instead." },
      { status: 400 }
    );
  }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${env.APP_URL}/api/integrations/github/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", createOAuthState(user.id, "github"));
  return NextResponse.redirect(url);
}
