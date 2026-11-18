import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // Preview aliases may share the same code, but must not compete with the
  // canonical production domain in search results.
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: "https://check.good-ship.co.uk/sitemap.xml",
    host: "https://check.good-ship.co.uk"
  };
}
