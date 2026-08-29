import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import { Badge, Card, Empty } from "@/components/ui";
import { ConnectForm } from "@/components/connect-form";
import { ConnectionControls } from "@/components/connection-controls";
import { ManualImportForm } from "@/components/manual-import-form";
import { LinkedInDisconnect } from "@/components/linkedin-connection";
import { EmbedSnippet, SiteRepoForm } from "@/components/site-delivery";
import { getLinkedInAccount } from "@/lib/linkedin/account";
import { env, githubOAuthConfigured, linkedinOAuthConfigured } from "@/lib/env";
import Link from "next/link";

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; reason?: string; warn?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [connections, linkedin, siteTarget] = await Promise.all([
    prisma.sourceConnection.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    getLinkedInAccount(user.id),
    prisma.siteTarget.findUnique({ where: { userId: user.id } }),
  ]);
  const appUrl = env.APP_URL;
  const live = SOURCE_CATALOG.filter((s) => s.live && s.type !== "manual");
  const publishOnly = SOURCE_CATALOG.filter((s) => s.publish);
  const restricted = SOURCE_CATALOG.filter((s) => !s.live && !s.publish);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Sources</p>
        <h1 className="serif mt-2 text-4xl">Connect where the work already lives</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Live connectors use official APIs. Restricted platforms are not scraped; import the evidence you can prove.
        </p>
        {params.connected ? (
          <p className="mt-3 text-sm text-pine">Connected {params.connected}. Discovery is running.</p>
        ) : null}
        {params.warn === "no_share_scope" ? (
          <p className="mt-3 text-sm text-[#9b2c2c]">
            LinkedIn connected, but without the w_member_social scope. Add the “Share on LinkedIn” product to your
            LinkedIn app, then reconnect.
          </p>
        ) : null}
        {params.error === "linkedin" ? (
          <p className="mt-3 text-sm text-[#9b2c2c]">
            LinkedIn connection failed. {params.reason || "Check the client id, secret, and redirect URL."}
          </p>
        ) : params.error ? (
          <p className="mt-3 text-sm text-[#9b2c2c]">GitHub OAuth failed. Check client id/secret, or use a token.</p>
        ) : null}
      </div>

      <section>
        <h2 className="serif text-2xl">Connected</h2>
        {connections.length === 0 ? (
          <div className="mt-3">
            <Empty title="None yet" body="Start with GitHub. A fine-grained or classic token with public repo read access is enough." />
          </div>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {connections.map((c) => (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium capitalize">{c.sourceType}</p>
                    <p className="text-sm text-ink-soft">{c.displayName}</p>
                    {c.profileUrl ? (
                      <a className="text-xs text-copper-deep" href={c.profileUrl} target="_blank" rel="noreferrer">
                        Profile
                      </a>
                    ) : null}
                  </div>
                  <Badge tone={c.status === "connected" ? "pine" : c.status === "syncing" ? "copper" : "warn"}>
                    {c.status.replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-ink-soft">
                  {c.lastSyncedAt ? `Last synced ${c.lastSyncedAt.toLocaleString()}` : "Waiting for first sync"}
                </p>
                {c.lastError ? <p className="mt-2 text-xs text-[#9b2c2c]">{c.lastError}</p> : null}
                <ConnectionControls id={c.id} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="serif text-2xl">Live integrations</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {live.map((source) => (
            <Card key={source.type}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-medium">{source.name}</h3>
                <Badge tone="pine">Official API</Badge>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{source.blurb}</p>
              <p className="mt-2 text-xs text-ink-soft">{source.apiNotes}</p>
              {source.type === "github" && githubOAuthConfigured ? (
                <Link
                  href="/api/integrations/github/start"
                  className="mt-4 inline-flex rounded-full bg-ink px-4 py-2 text-sm text-paper"
                >
                  Connect with GitHub
                </Link>
              ) : null}
              {source.fields.length > 0 ? <ConnectForm source={source} /> : null}
            </Card>
          ))}
        </div>
      </section>

      <section id="website" className="scroll-mt-20 space-y-4">
        <h2 className="serif text-2xl">Your own website</h2>
        <p className="text-sm text-ink-soft">
          Keep your existing site and its design. Approved items are delivered to it automatically — pick either route,
          or both.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-medium">Embed or fetch</h3>
              <Badge tone="pine">No setup</Badge>
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              Your portfolio is already served as JSON. Paste one snippet into any site — React, Astro, WordPress,
              plain HTML — and it stays current with no further work.
            </p>
            <EmbedSnippet appUrl={appUrl} slug={user.slug} />
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-medium">Commit to your site&apos;s repo</h3>
              <Badge tone="copper">GitHub</Badge>
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              For a static site (Astro, Next, Hugo, Jekyll). We write one JSON file into your repository on every
              approval, and your existing build renders it. Only that file is ever touched.
            </p>
            <SiteRepoForm
              target={
                siteTarget
                  ? {
                      owner: siteTarget.owner,
                      repo: siteTarget.repo,
                      branch: siteTarget.branch,
                      filePath: siteTarget.filePath,
                      mode: siteTarget.mode,
                      strategy: siteTarget.strategy,
                      lastPublishedAt: siteTarget.lastPublishedAt,
                      lastCommitUrl: siteTarget.lastCommitUrl,
                      lastError: siteTarget.lastError,
                    }
                  : null
              }
            />
          </Card>
        </div>
      </section>

      <section id="linkedin" className="scroll-mt-20 space-y-4">
        <h2 className="serif text-2xl">Publishing</h2>
        <p className="text-sm text-ink-soft">
          One-way by necessity. These platforms accept posts from this app but do not let it read your history back.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {publishOnly.map((source) => (
            <Card key={source.type}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-medium">{source.name}</h3>
                <Badge tone="copper">Publish only</Badge>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{source.blurb}</p>
              <p className="mt-2 text-xs text-ink-soft">{source.apiNotes}</p>

              {source.type === "linkedin" ? (
                linkedin ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm">
                      Connected as {linkedin.displayName || "your LinkedIn account"}
                      {linkedin.expired ? " — authorisation expired" : ""}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {linkedin.canPublish
                        ? `Publishing enabled. Authorisation valid until ${linkedin.expiresAt.toLocaleDateString()}.`
                        : "Connected without w_member_social — add the “Share on LinkedIn” product and reconnect."}
                    </p>
                    {linkedin.lastError ? (
                      <p className="text-xs text-[#9b2c2c]">Last error: {linkedin.lastError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link
                        href="/api/integrations/linkedin/start"
                        className="inline-flex rounded-full border border-ink/15 px-4 py-2 text-sm"
                      >
                        Reconnect
                      </Link>
                      <LinkedInDisconnect />
                    </div>
                  </div>
                ) : linkedinOAuthConfigured ? (
                  <Link
                    href="/api/integrations/linkedin/start"
                    className="mt-4 inline-flex rounded-full bg-ink px-4 py-2 text-sm text-paper"
                  >
                    Connect LinkedIn
                  </Link>
                ) : (
                  <p className="mt-4 text-xs text-ink-soft">
                    Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, and add the “Sign In with LinkedIn using OpenID
                    Connect” and “Share on LinkedIn” products to your LinkedIn app, to enable this.
                  </p>
                )
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="serif text-2xl">Restricted platforms</h2>
        <p className="mt-1 text-sm text-ink-soft">
          These vendors do not expose a usable portfolio API for this product. Import a verifiable item instead.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {restricted.map((source) => (
            <Card key={source.type}>
              <h3 className="font-medium">{source.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{source.apiNotes}</p>
            </Card>
          ))}
        </div>
        <Card className="mt-6">
          <h3 className="serif text-2xl">Import evidence</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Use this for certifications, hackathon wins, talks, and anything we cannot fetch.
          </p>
          <ManualImportForm />
        </Card>
      </section>
    </div>
  );
}
