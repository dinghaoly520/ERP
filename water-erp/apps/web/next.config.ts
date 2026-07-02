import type { NextConfig } from "next";

const API_SERVER = process.env.API_SERVER_URL ?? "http://localhost:4001";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.111", "10.20.145.152"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: 500 * 1024 * 1024,
    // 优化 barrel imports，减少编译时间
    optimizePackageImports: ["lucide-react", "framer-motion"],
    // 缓存 Server Component fetch 响应，加速 HMR
    serverComponentsHmrCache: true,
    // 降低 Webpack 内存峰值
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_SERVER}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
