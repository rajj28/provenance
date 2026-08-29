import { env } from "../env";

/**
 * LinkedIn integration — publishing only.
 *
 * What LinkedIn actually allows a self-serve app to do (verified against
 * learn.microsoft.com/linkedin, August 2026):
 *
 *   - "Sign In with LinkedIn using OpenID Connect" grants `openid profile email`
 *     and returns ONLY: sub, name, given_name, family_name, picture, locale,
 *     email, email_verified. No headline, positions, education, or skills.
 *   - "Share on LinkedIn" grants `w_member_social`, which can CREATE posts on
 *     behalf of the member. Both products are self-serve in the developer portal.
 *   - Reading a member's own posts needs `r_member_social`, which LinkedIn
 *     documents as "restricted and available to approved users only". There is
 *     no self-serve path to it, so this app cannot import LinkedIn posts.
 *
 * Hence: outbound publishing is implemented, inbound discovery is not, and
 * LinkedIn evidence is captured through manual import instead.
 */

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";

export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

/** LinkedIn caps post commentary at 3000 characters. */
export const MAX_COMMENTARY = 3000;

/** Documented member throttle for Share on LinkedIn. */
export const MEMBER_DAILY_POST_LIMIT = 150;

export type LinkedInVisibility = "PUBLIC" | "CONNECTIONS";

export class LinkedInError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly needsReconnect = false
  ) {
    super(message);
    this.name = "LinkedInError";
  }
}

export function callbackUrl() {
  return `${env.APP_URL}/api/integrations/linkedin/callback`;
}

export function authorizeUrl(state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  return url.toString();
}

export type LinkedInToken = {
  accessToken: string;
  expiresAt: Date;
  scope: string;
};

export async function exchangeCode(code: string): Promise<LinkedInToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.LINKEDIN_CLIENT_ID || "",
    client_secret: env.LINKEDIN_CLIENT_SECRET || "",
    redirect_uri: callbackUrl(),
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new LinkedInError(
      json.error_description || json.error || `LinkedIn token exchange failed (${res.status}).`,
      res.status
    );
  }

  // LinkedIn member tokens last ~60 days. Refresh tokens are only issued to
  // approved partners, so when this expires the member must reconnect.
  const expiresInSeconds = Number(json.expires_in) || 60 * 60 * 24 * 60;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scope: json.scope || LINKEDIN_SCOPES.join(" "),
  };
}

export type LinkedInProfile = {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
};

export async function fetchProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new LinkedInError(`Could not read LinkedIn profile (${res.status}).`, res.status, res.status === 401);
  }
  const json = (await res.json()) as LinkedInProfile;
  if (!json.sub) throw new LinkedInError("LinkedIn did not return a member id.", 502);
  return json;
}

export function personUrn(sub: string) {
  return `urn:li:person:${sub}`;
}

/**
 * Escape text for LinkedIn's "little" text format.
 *
 * LinkedIn's docs are explicit: "All reserved characters need to be escaped
 * with a backslash, even if those characters are not used in one of the
 * supported elements or templates." An unescaped paren or hash makes the post
 * render wrong or the request fail with 422.
 */
const RESERVED = /[|{}@[\]()<>#*_~\\]/g;

export function escapeLittleText(text: string) {
  return text.replace(RESERVED, (char) => `\\${char}`);
}

/**
 * Escape a whole commentary while keeping hashtags working.
 *
 * A bare "#tag" must become the HashtagTemplate "{hashtag|\#|tag}" to render as
 * a real hashtag; everything around it is escaped as plain text. Tags are
 * limited to alphanumerics because underscore and dash are themselves reserved.
 */
export function formatCommentary(text: string) {
  const hashtag = /(^|\s)#([A-Za-z][A-Za-z0-9]*)/g;
  let out = "";
  let lastIndex = 0;
  for (const match of text.matchAll(hashtag)) {
    const [full, lead, tag] = match;
    const start = match.index ?? 0;
    out += escapeLittleText(text.slice(lastIndex, start));
    out += `${escapeLittleText(lead)}{hashtag|\\#|${tag}}`;
    lastIndex = start + full.length;
  }
  out += escapeLittleText(text.slice(lastIndex));
  return out;
}

export type CreatePostInput = {
  accessToken: string;
  authorUrn: string;
  commentary: string;
  visibility: LinkedInVisibility;
  /**
   * Optional link attachment. LinkedIn does not scrape the URL, so title and
   * description must be supplied explicitly or the card renders bare.
   */
  article?: { source: string; title?: string; description?: string };
};

export type CreatePostResult = { postUrn: string; postUrl: string };

export async function createMemberPost(input: CreatePostInput): Promise<CreatePostResult> {
  const trimmed = input.commentary.trim();
  if (!trimmed) throw new LinkedInError("Post text cannot be empty.", 400);
  if (trimmed.length > MAX_COMMENTARY) {
    throw new LinkedInError(`Post text is ${trimmed.length} characters; LinkedIn allows ${MAX_COMMENTARY}.`, 400);
  }

  const body: Record<string, unknown> = {
    author: input.authorUrn,
    commentary: formatCommentary(trimmed),
    visibility: input.visibility,
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (input.article?.source) {
    body.content = {
      article: {
        source: input.article.source,
        ...(input.article.title ? { title: input.article.title.slice(0, 400) } : {}),
        ...(input.article.description ? { description: input.article.description.slice(0, 4000) } : {}),
      },
    };
  }

  const res = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": env.LINKEDIN_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 201) {
    const postUrn = res.headers.get("x-restli-id") || "";
    return {
      postUrn,
      postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : "https://www.linkedin.com/feed/",
    };
  }

  const detail = await res.text().catch(() => "");
  throw new LinkedInError(linkedInErrorMessage(res.status, detail), res.status, res.status === 401);
}

function linkedInErrorMessage(status: number, detail: string) {
  const snippet = detail.slice(0, 300);
  if (status === 401) return "LinkedIn rejected the access token. Reconnect your LinkedIn account.";
  if (status === 403) {
    return "LinkedIn denied the post. The connected app needs the 'Share on LinkedIn' product (w_member_social).";
  }
  if (status === 422) return `LinkedIn could not process the post. ${snippet}`;
  if (status === 429) return "LinkedIn rate limit reached (150 posts per member per day). Try again tomorrow.";
  return `LinkedIn returned ${status}. ${snippet}`;
}
