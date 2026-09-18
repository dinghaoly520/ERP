import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    // Next 16 proxy 默认请求体上限 ~1.5MB——标书上传（50MB 级）会被悄悄截断
    // （2026-09-18 根因定位；与 apps/web 同值，对齐 50MB 上传 cap）
    proxyClientMaxBodySize: 500 * 1024 * 1024,
  },
};

export default nextConfig;
