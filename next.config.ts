import type { NextConfig } from "next";

const config: NextConfig = {
  // CLI is a sibling workspace; Next must not crawl it.
  outputFileTracingExcludes: { "*": ["./cli/**/*"] }
};

export default config;
