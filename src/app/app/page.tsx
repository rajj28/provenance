import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Badge, Button, Card, Empty } from "@/components/ui";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await requireUser();
  const [connections, pending, recommended, published, recentLogs] = await Promise.all([
    prisma.sourceConnection.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.evidence.count({ where: { userId: user.id, status: "pending" } }),
    prisma.evidence.count({
      where: { userId: user.id, status: "pending", curation: { recommendation: "add" } },
    }),
    prisma.portfolioItem.count({ where: { userId: user.id, published: true } }),
    prisma.syncLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  const queue = await prisma.evidence.findMany({
    where: { userId: user.id, status: "pending", curation: { recommendation: "add" } },
    include: { curation: true },
    orderBy: { curation: { significance: "desc" } },
    take: 5,
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Overview</p>
        <h1 className="serif mt-2 text-4xl">
          {user.name ? `Hello, ${user.name.split(" ")[0]}` : "Your evidence workspace"}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {user.targetRole
            ? `Ranking evidence for ${user.targetRole}. Nothing publishes until you approve it.`
            : "Connect sources, let curation run, then approve what belongs on your public page."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Sources", String(connections.length)],
          ["Pending review", String(pending)],
          ["Recommended", String(recommended)],
          ["Published items", String(published)],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
            <p className="serif mt-2 text-4xl">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="serif text-2xl">Recommended additions</h2>
            <Link href="/app/reviews" className="text-sm text-copper-deep">
              Review queue
            </Link>
          </div>
          {queue.length === 0 ? (
            <Empty
              title="Nothing waiting"
              body="Connect GitHub or another live source to discover work worth showing."
              action={<Button href="/app/sources">Connect a source</Button>}
            />
          ) : (
            <div className="space-y-3">
              {queue.map((item) => (
                <Card key={item.id} className="lift">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="copper">{item.sourceType}</Badge>
                    <Badge>{item.kind}</Badge>
                    <Badge tone="pine">{item.curation?.significance}/100</Badge>
                  </div>
                  <h3 className="mt-3 text-lg font-medium">{item.curation?.suggestedTitle || item.title}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{item.curation?.whyItMatters}</p>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="serif text-2xl">Sources</h2>
          {connections.length === 0 ? (
            <Empty title="No sources yet" body="GitHub is the fastest way to see the product work." />
          ) : (
            connections.map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium capitalize">{c.sourceType}</p>
                    <p className="text-sm text-ink-soft">{c.displayName}</p>
                  </div>
                  <Badge tone={c.status === "connected" ? "pine" : "warn"}>{c.status.replaceAll("_", " ")}</Badge>
                </div>
                <p className="mt-3 text-xs text-ink-soft">
                  {c.lastSyncedAt ? `Last synced ${c.lastSyncedAt.toLocaleString()}` : "Not synced yet"}
                </p>
              </Card>
            ))
          )}
          <h2 className="serif pt-2 text-2xl">Recent syncs</h2>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-ink-soft">Sync activity will appear here.</p>
          ) : (
            recentLogs.map((log) => (
              <p key={log.id} className="text-sm text-ink-soft">
                <span className="capitalize text-ink">{log.sourceType}</span> · {log.status}
                {log.message ? ` · ${log.message}` : ""}
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
