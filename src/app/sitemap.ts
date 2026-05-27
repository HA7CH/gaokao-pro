import type { MetadataRoute } from "next";

const BASE_URL = "https://gaokao.ha7ch.com";

// The app currently has a single route: `/` (src/app/page.tsx is the only
// page in the App Router tree). Add new entries here if/when more routes ship.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0
    }
  ];
}
