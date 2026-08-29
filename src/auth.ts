import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./lib/db";
import { env } from "./lib/env";
import { rateLimit } from "./lib/ratelimit";
import { logger } from "./lib/logger";

/**
 * Client identity for throttling. Behind a proxy the socket address is the
 * proxy, so a forwarded header is preferred. Used only to bucket rate limits,
 * never for authorization.
 */
function clientKeyFrom(request: Request | undefined) {
  const headers = request?.headers;
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip") || "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email || "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;

        // Throttling lives here, not only in the sign-in server action: the
        // action is just one caller, and POSTing straight to
        // /api/auth/callback/credentials reaches this function while skipping
        // the action entirely. This is the real chokepoint for credential
        // stuffing, so the limit has to sit on it.
        //
        // Two buckets: by client, so one source cannot sweep many accounts;
        // and by email, so a distributed attack cannot grind one account.
        const [byClient, byAccount] = await Promise.all([
          rateLimit("signin:ip", clientKeyFrom(request)),
          rateLimit("signin:email", email),
        ]);
        if (!byClient.ok || !byAccount.ok) {
          logger.warn("signin_rate_limited", { bucket: byClient.ok ? "email" : "ip" });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
