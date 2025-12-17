import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Allow Safe to iframe your app
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://app.safe.global https://*.safe.global https://safe.optimism.io;",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
