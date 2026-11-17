import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // bug#163（2026-11-17）：补生产域名家族——域名模式本地 QA（host 映射 *.scsfjt.com → 本机，
  // 走生产同款同源 WS/跳转链路）时 HMR 需放行，否则非白名单主机 hydration 死（登录原生
  // 提交无参无跳转，见 memory 死 SSR 形态）。生产构建不受本项影响。
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost", "*.scsfjt.com"],
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
