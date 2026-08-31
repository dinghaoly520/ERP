import type { NextConfig } from "next";

// 局域网访问的开发源（Turbopack HMR 白名单）——环境可覆盖：ALLOWED_DEV_ORIGINS="192.168.1.109,localhost"
const ALLOWED_DEV_ORIGINS = (process.env.ALLOWED_DEV_ORIGINS ?? "192.168.1.*,10.20.145.*,localhost")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: ALLOWED_DEV_ORIGINS,
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: 500 * 1024 * 1024,
    optimizePackageImports: ["lucide-react", "framer-motion"],
    serverComponentsHmrCache: true,
  },
  // ★ API proxy 已从 rewrites 迁移至 src/proxy.ts（Next 16 middleware 更名）——
  //    proxy 显式 fetch + Cookie/Header 全量透传，解决 rewrites 丢 Cookie 导致后端 401 的问题。
};

export default nextConfig;
