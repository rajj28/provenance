import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy.
 *
 * The app ships no third-party scripts, so the policy can be tight. Next's
 * inline bootstrap and Tailwind's injected styles still need 'unsafe-inline'
 * for scripts/styles; `img-src` allows LinkedIn's CDN because a connected
 * account's avatar is served from there.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://media.licdn.com https://media.licdn-ei.com https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS is only meaningful over TLS, and setting it in local dev would pin
  // http://localhost to https in the browser for a year.
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack does not pick up a stray lockfile
  // from a parent directory (e.g. the user's home folder).
  turbopack: { root: path.resolve(".") },
  // typescript is a runtime dependency now: the append writer parses a member's
  // .ts/.tsx content module with the real compiler API. It must stay external
  // rather than be bundled into the server output.
  serverExternalPackages: ["@prisma/client", "prisma", "bullmq", "ioredis", "octokit", "typescript"],

  // Self-contained server bundle for the container image.
  output: "standalone",

  // Do not advertise the framework.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Never let a proxy or browser cache an authenticated page or an API
      // response; several of these carry per-user data.
      {
        source: "/app/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      // Only the authenticated / stateful API surfaces. NOT /api/portfolio,
      // which is a public feed embedded on other people's sites and is meant to
      // be cached — a blanket /api/:path* no-store would silently override the
      // cache headers that route sets.
      ...["auth", "cron", "integrations", "webhooks", "health"].map((segment) => ({
        source: `/api/${segment}/:path*`,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
      {
        source: "/api/health",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      // The embed script is loaded by third-party sites by design.
      {
        source: "/embed.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
