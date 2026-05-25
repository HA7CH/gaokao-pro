import type { MetadataRoute } from "next";

const BASE_URL = "https://gaokao.ha7ch.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: [
          "Googlebot",
          "Baiduspider",
          "Sogou web spider",
          "Sogou inst spider",
          "360Spider",
          "Bingbot",
          "Slurp",
          "DuckDuckBot",
          "YandexBot",
          "GPTBot",
          "ClaudeBot",
          "anthropic-ai",
          "PerplexityBot",
          "cohere-ai",
          "Bytespider",
          "*"
        ],
        allow: "/"
      }
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL
  };
}
