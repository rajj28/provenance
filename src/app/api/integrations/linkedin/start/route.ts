import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { createOAuthState } from "@/lib/oauth-state";
import { authorizeUrl } from "@/lib/linkedin/client";
import { linkedinOAuthConfigured } from "@/lib/env";

export async function GET() {
  const user = await requireUser();
  if (!linkedinOAuthConfigured) {
    return NextResponse.json(
      {
        error:
          "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, and add the 'Sign In with LinkedIn using OpenID Connect' and 'Share on LinkedIn' products to your LinkedIn app.",
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(authorizeUrl(createOAuthState(user.id, "linkedin")));
}
