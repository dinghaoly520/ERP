import type { NextConfig } from "next";

// 局域网访问的开发源（Turbopack HMR 白名单）——与 apps/web 同款
const ALLOWED_DEV_ORIGINS = (process.env.ALLOWED_DEV_ORIGINS ?? "192.168.1.*,10.20.145.*,localhost,127.0.0.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: ALLOWED_DEV_ORIGINS,
  // API 代理在 src/proxy.ts（Next 16 middleware 更名；cookie/header 全量透传，
  // 解决 rewrites 丢 Cookie 导致后端 401 的问题——同 apps/web）
};

export default nextConfig;
