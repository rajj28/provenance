import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Public portfolios are the point of the product, so they stay indexable.
      // Everything behind auth, and every API surface, is not.
      allow: "/",
      disallow: ["/app/", "/api/", "/login", "/signup"],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
