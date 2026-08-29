import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { env } from "@/lib/env";
import { groupIntoSections, KIND_LABELS, sourceLabel } from "@/lib/portfolio/sections";
import type { EvidenceKind } from "@/lib/sources/types";

export const revalidate = 60;

async function loadPortfolio(slug: string) {
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user || !user.publicPortfolio) return null;
  const items = await prisma.portfolioItem.findMany({
    where: { userId: user.id, published: true },
    include: { evidence: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return { user, items };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPortfolio(slug);
  if (!data) return { title: "Portfolio not found", robots: { index: false, follow: false } };

  const name = data.user.name || "Portfolio";
  const description =
    data.user.headline ||
    data.user.bio?.slice(0, 160) ||
    `Verified professional evidence from ${data.items.length} approved item${data.items.length === 1 ? "" : "s"}.`;
  const url = `${env.APP_URL}/p/${slug}`;

  return {
    title: `${name} — Portfolio`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${name} — Portfolio`, description, url, type: "profile" },
    twitter: { card: "summary", title: `${name} — Portfolio`, description },
  };
}

export default async function PublicPortfolioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadPortfolio(slug);
  if (!data) notFound();
  const { user, items } = data;

  const skills = [
    ...new Set(
      items.flatMap((item) =>
        Array.isArray(item.skills) ? item.skills.filter((s): s is string => typeof s === "string") : []
      )
    ),
  ].slice(0, 16);

  // Every approved item lands in exactly one section, derived from its evidence
  // kind — so anything imported or discovered files itself automatically.
  const sections = groupIntoSections(items);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6">
        <Link href="/" className="serif text-xl">
          Provenance
        </Link>
        <span className="text-xs uppercase tracking-[0.18em] text-ink-soft">Living professional profile</span>
      </header>
      <article className="mx-auto max-w-3xl px-5 pb-20">
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">{user.location || "Portfolio"}</p>
        <h1 className="serif mt-3 text-5xl">{user.name || "Professional"}</h1>
        {user.headline ? <p className="mt-4 text-xl text-ink-soft">{user.headline}</p> : null}
        {user.bio ? <p className="mt-4 leading-7 text-ink-soft">{user.bio}</p> : null}
        {user.targetRole ? (
          <p className="mt-3 text-sm text-ink-soft">Currently highlighting evidence for {user.targetRole}.</p>
        ) : null}

        {skills.length ? (
          <div className="mt-8 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span key={skill} className="rounded-full border border-ink/10 px-3 py-1 text-xs">
                {skill}
              </span>
            ))}
          </div>
        ) : null}

        {sections.length > 1 ? (
          <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-y border-ink/10 py-3 text-xs uppercase tracking-wide text-ink-soft">
            {sections.map(({ section }) => (
              <a key={section.id} href={`#${section.id}`} className="hover:text-ink">
                {section.title}
              </a>
            ))}
          </nav>
        ) : null}

        {items.length === 0 ? (
          <p className="mt-12 text-ink-soft">No approved items yet.</p>
        ) : (
          sections.map(({ section, items: sectionItems }) => (
            <section key={section.id} id={section.id} className="mt-14 scroll-mt-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-ink/15 pb-2">
                <h2 className="serif text-sm uppercase tracking-[0.2em] text-copper-deep">{section.title}</h2>
                <span className="text-xs text-ink-soft">{sectionItems.length}</span>
              </div>

              <div className="space-y-8">
                {sectionItems.map((item) => {
                  const links = (Array.isArray(item.links) ? item.links : []) as { label?: string; url?: string }[];
                  const kindLabel = KIND_LABELS[item.evidence.kind as EvidenceKind] || item.evidence.kind;
                  return (
                    <div key={item.id} className="pt-8">
                      <p className="text-xs uppercase tracking-wide text-ink-soft">
                        {kindLabel} · {sourceLabel(item.evidence.sourceType, item.evidence.payload)}
                        {item.evidence.occurredAt ? ` · ${item.evidence.occurredAt.getFullYear()}` : ""}
                      </p>
                      <h3 className="serif mt-2 text-3xl">{item.title}</h3>
                      {item.role ? <p className="mt-1 text-sm text-ink-soft">{item.role}</p> : null}
                      <p className="mt-3 leading-7">{item.summary}</p>
                      {item.description && item.description !== item.summary ? (
                        <p className="mt-3 text-sm leading-6 text-ink-soft">{item.description}</p>
                      ) : null}
                      {item.impact ? <p className="mt-3 text-sm text-ink-soft">{item.impact}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-3 text-xs">
                        {item.evidence.url ? (
                          <a href={item.evidence.url} className="text-copper-deep" target="_blank" rel="noreferrer">
                            Source evidence
                          </a>
                        ) : null}
                        {links.map((link) =>
                          link.url ? (
                            <a
                              key={link.url}
                              href={link.url}
                              className="text-copper-deep"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {link.label || "Link"}
                            </a>
                          ) : null
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </article>
    </div>
  );
}
