import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, Empty } from "@/components/ui";
import { PortfolioEditor } from "@/components/portfolio-editor";
import { LinkedInShare } from "@/components/linkedin-share";
import { getLinkedInAccount } from "@/lib/linkedin/account";
import { groupIntoSections, KIND_LABELS, sourceLabel } from "@/lib/portfolio/sections";
import type { EvidenceKind } from "@/lib/sources/types";
import Link from "next/link";

export default async function PortfolioPage() {
  const user = await requireUser();
  const [items, linkedin, shares] = await Promise.all([
    prisma.portfolioItem.findMany({
      where: { userId: user.id },
      include: { evidence: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    getLinkedInAccount(user.id),
    prisma.linkedinPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { portfolioItemId: true, postUrl: true },
    }),
  ]);

  // Most recent share per item, for the "previously shared" hint.
  const lastShare = new Map<string, string>();
  for (const share of shares) {
    if (share.portfolioItemId && !lastShare.has(share.portfolioItemId)) {
      lastShare.set(share.portfolioItemId, share.postUrl);
    }
  }

  const sections = groupIntoSections(items);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Portfolio</p>
          <h1 className="serif mt-2 text-4xl">Published from approved evidence</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Edit tone, not facts you cannot support. Items file themselves into sections by kind. Public page: /p/
            {user.slug}
          </p>
        </div>
        <Link href={`/p/${user.slug}`} className="rounded-full bg-ink px-4 py-2 text-sm text-paper">
          View public page
        </Link>
      </div>

      {items.length === 0 ? (
        <Empty
          title="Nothing approved yet"
          body="Review recommended discoveries first. The public page stays empty until you approve."
          action={
            <Link href="/app/reviews" className="text-sm text-copper-deep">
              Open review queue
            </Link>
          }
        />
      ) : (
        <div className="space-y-10">
          {sections.map(({ section, items: sectionItems }) => (
            <section key={section.id}>
              <div className="flex items-baseline justify-between gap-4 border-b border-ink/10 pb-2">
                <h2 className="serif text-2xl">{section.title}</h2>
                <span className="text-xs text-ink-soft">
                  {sectionItems.length} item{sectionItems.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{section.blurb}</p>

              <div className="mt-4 space-y-4">
                {sectionItems.map((item) => (
                  <Card key={item.id}>
                    <p className="text-xs uppercase tracking-wide text-ink-soft">
                      {sourceLabel(item.evidence.sourceType, item.evidence.payload)} ·{" "}
                      {KIND_LABELS[item.evidence.kind as EvidenceKind] || item.evidence.kind}
                      {item.published ? " · live" : " · hidden"}
                    </p>
                    <PortfolioEditor item={item} />
                    <LinkedInShare
                      portfolioItemId={item.id}
                      connected={Boolean(linkedin)}
                      needsReconnect={Boolean(linkedin && (linkedin.expired || !linkedin.canPublish))}
                      alreadySharedUrl={lastShare.get(item.id) ?? null}
                    />
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
