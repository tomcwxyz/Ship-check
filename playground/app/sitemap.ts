import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://check.good-ship.co.uk/",
      changeFrequency: "monthly",
      priority: 1
    }
  ];
}
