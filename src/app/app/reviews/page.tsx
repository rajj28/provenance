import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Badge, Card, Empty } from "@/components/ui";
import { ReviewButtons } from "@/components/review-buttons";
import Link from "next/link";

export default async function ReviewsPage() {
  const user = await requireUser();
  const pending = await prisma.evidence.findMany({
    where: { userId: user.id, status: "pending" },
    include: { curation: true },
    orderBy: [{ curation: { recommendation: "asc" } }, { curation: { significance: "desc" } }],
  });
  const recommended = pending.filter((p) => p.curation?.recommendation === "add");
  const skipped = pending.filter((p) => p.curation?.recommendation !== "add");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Review</p>
        <h1 className="serif mt-2 text-4xl">Approve what hiring managers should see</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Recommended items are scored for substance, recency, and your target role. Rejected items will not return
          unless the underlying evidence changes.
        </p>
      </div>

      <section>
        <h2 className="serif text-2xl">Recommended</h2>
        {recommended.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Queue is clear"
              body="Sync a source or import a credential to get recommendations."
              action={
                <Link href="/app/sources" className="text-sm text-copper-deep">
                  Sources
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {recommended.map((item) => (
              <ReviewCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="serif text-2xl">Suggested skip</h2>
        <p className="mt-1 text-sm text-ink-soft">Still yours to override. Typical skips: empty repos, typo PRs, thin tutorials.</p>
        <div className="mt-3 space-y-3">
          {skipped.map((item) => (
            <ReviewCard key={item.id} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewCard({
  item,
}: {
  item: {
    id: string;
    title: string;
    url: string | null;
    sourceType: string;
    kind: string;
    summary: string | null;
    curation: {
      recommendation: string;
      confidence: number;
      significance: number;
      roleRelevance: number;
      whyItMatters: string;
      skills: unknown;
      potentialImpact: string;
      suggestedTitle: string;
      suggestedDescription: string;
      evidenceNotes: string;
      uncertainFields: unknown;
      model: string;
    } | null;
  };
}) {
  const skills = (item.curation?.skills as string[] | null) || [];
  const uncertain = (item.curation?.uncertainFields as string[] | null) || [];
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <Badge tone="copper">{item.sourceType}</Badge>
        <Badge>{item.kind}</Badge>
        <Badge tone="pine">confidence {item.curation?.confidence ?? "—"}</Badge>
        <Badge>significance {item.curation?.significance ?? "—"}</Badge>
        <Badge>role {item.curation?.roleRelevance ?? "—"}</Badge>
        <Badge>{item.curation?.model}</Badge>
      </div>
      <h3 className="mt-3 text-xl font-medium">{item.curation?.suggestedTitle || item.title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{item.curation?.whyItMatters}</p>
      <p className="mt-3 text-sm">{item.curation?.suggestedDescription}</p>
      <p className="mt-3 text-sm text-ink-soft">
        <span className="text-ink">Impact: </span>
        {item.curation?.potentialImpact}
      </p>
      {skills.length ? (
        <p className="mt-2 text-sm text-ink-soft">Skills: {skills.join(", ")}</p>
      ) : null}
      <p className="mt-2 text-xs text-ink-soft">{item.curation?.evidenceNotes}</p>
      {uncertain.length ? (
        <p className="mt-2 text-xs text-[#9b2c2c]">Uncertain: {uncertain.join(", ")}</p>
      ) : null}
      {item.url ? (
        <a href={item.url} className="mt-2 inline-block text-xs text-copper-deep" target="_blank" rel="noreferrer">
          Open source evidence
        </a>
      ) : null}
      <ReviewButtons id={item.id} />
    </Card>
  );
}
