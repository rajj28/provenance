import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Rebuild hourly rather than per request; a portfolio index does not need to be
// fresher than that, and this keeps a crawler from hammering the database.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only portfolios that are public AND have something published are listed —
  // an empty page is not worth a crawl budget.
  const users = await prisma.user.findMany({
    where: { publicPortfolio: true, portfolioItems: { some: { published: true } } },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  return [
    { url: env.APP_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    ...users.map((user) => ({
      url: `${env.APP_URL}/p/${user.slug}`,
      lastModified: user.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
