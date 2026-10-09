import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost", "127.0.0.1"], // 裸 "*" 无效（66256e4e 同根），显式列表才能放行局域网 HMR
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
  ],
  // Next.js 代理默认 30s 超时，综合类请求（董事长驾驶舱）需要两次 DeepSeek 调用，
  // 耗时可达 30-50s，这里将代理超时提升至 120s 避免误杀。
  experimental: {
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
