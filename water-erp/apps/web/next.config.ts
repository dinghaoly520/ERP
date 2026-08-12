import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.109", "192.168.1.111", "10.20.145.152", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: 500 * 1024 * 1024,
    optimizePackageImports: ["lucide-react", "framer-motion"],
    serverComponentsHmrCache: true,
  },
  // ★ API proxy 已从 rewrites 迁移至 middleware.ts ——
  //    middleware 显式 fetch + Cookie/Header 全量透传，解决 rewrites 丢 Cookie 导致后端 401 的问题。
};

export default nextConfig;
