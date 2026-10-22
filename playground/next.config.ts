import type { NextConfig } from "next";

// Public-facing links remain stable when the GitHub repository's owner changes.
const sourceRepo = "https://github.com/tomcwxyz/Ship-check";
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/source", destination: sourceRepo, permanent: false },
      { source: "/issues", destination: `${sourceRepo}/issues`, permanent: false },
      { source: "/releases", destination: `${sourceRepo}/releases`, permanent: false },
      { source: "/guide", destination: `${sourceRepo}/blob/main/docs/CLI_GUIDE.md`, permanent: false }
    ];
  }
};
export default config;
