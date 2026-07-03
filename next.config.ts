import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // HTML 頁面不快取在 CDN，JS/CSS chunk 則可以無限期快取（有 content hash）
        source: "/((?!_next/static|_next/image|favicon\\.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ]
  },
}

export default nextConfig;
