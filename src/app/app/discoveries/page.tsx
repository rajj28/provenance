import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Badge, Card, Empty } from "@/components/ui";
import { ReviewButtons } from "@/components/review-buttons";
import Link from "next/link";

type EvidenceWithCuration = Awaited<ReturnType<typeof loadEvidence>>[number];

async function loadEvidence(userId: string) {
  return prisma.evidence.findMany({
    where: { userId },
    include: { curation: true },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
}

function matches(item: EvidenceWithCuration, params: Record<string, string | undefined>) {
  if (params.source && item.sourceType !== params.source) return false;
  if (params.type && item.kind !== params.type) return false;
  if (params.status && item.status !== params.status) return false;
  if (params.significance) {
    const min = Number(params.significance);
    if ((item.curation?.significance ?? 0) < min) return false;
  }
  if (params.skill) {
    const skills = (item.curation?.skills as string[] | null) || [];
    if (!skills.some((s) => s.toLowerCase().includes(params.skill!.toLowerCase()))) return false;
  }
  return true;
}

export default async function DiscoveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const items = (await loadEvidence(user.id)).filter((item) => matches(item, params));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Discoveries</p>
        <h1 className="serif mt-2 text-4xl">Everything we found, with judgment attached</h1>
        <p className="mt-2 text-ink-soft">Filter by source, type, status, skill, and significance. Raw dumps stay out of the way.</p>
      </div>

      <form className="grid gap-3 rounded-3xl border border-ink/10 bg-white/50 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Filter name="source" label="Source" defaultValue={params.source} options={["github", "gitlab", "npm", "pypi", "devto", "hashnode", "arxiv", "orcid", "kaggle", "manual"]} />
        <Filter name="type" label="Type" defaultValue={params.type} options={["project", "contribution", "article", "package", "publication", "certification", "achievement"]} />
        <Filter name="status" label="Status" defaultValue={params.status} options={["pending", "approved", "rejected"]} />
        <Filter name="significance" label="Min significance" defaultValue={params.significance} options={["40", "55", "70"]} />
        <label className="text-xs text-ink-soft">
          Skill
          <input
            name="skill"
            defaultValue={params.skill || ""}
            className="mt-1 w-full rounded-2xl border border-ink/12 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button className="self-end rounded-full bg-ink px-4 py-2 text-sm text-paper">Apply</button>
      </form>

      {items.length === 0 ? (
        <Empty
          title="No matching evidence"
          body="Connect a source or clear filters. Discovery never invents items that APIs did not return."
          action={
            <Link href="/app/sources" className="text-sm text-copper-deep">
              Connect sources
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{item.sourceType}</Badge>
                <Badge>{item.kind}</Badge>
                <Badge tone={item.status === "approved" ? "pine" : item.status === "rejected" ? "warn" : "copper"}>
                  {item.status}
                </Badge>
                {item.curation ? (
                  <>
                    <Badge tone="pine">sig {item.curation.significance}</Badge>
                    <Badge>{item.curation.recommendation}</Badge>
                  </>
                ) : null}
              </div>
              <h2 className="mt-3 text-lg font-medium">{item.curation?.suggestedTitle || item.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{item.curation?.whyItMatters || item.summary}</p>
              {item.url ? (
                <a href={item.url} className="mt-2 inline-block text-xs text-copper-deep" target="_blank" rel="noreferrer">
                  Evidence
                </a>
              ) : null}
              {item.status === "pending" ? <ReviewButtons id={item.id} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Filter({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: string[];
  defaultValue?: string;
}) {
  return (
    <label className="text-xs text-ink-soft">
      {label}
      <select
        name={name}
        defaultValue={defaultValue || ""}
        className="mt-1 w-full rounded-2xl border border-ink/12 bg-white px-3 py-2 text-sm capitalize"
      >
        <option value="">Any</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
