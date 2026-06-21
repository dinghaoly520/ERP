import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
  // Next.js 代理默认 30s 超时，综合类请求（董事长驾驶舱）需要两次 DeepSeek 调用，
  // 耗时可达 30-50s，这里将代理超时提升至 120s 避免误杀。
  experimental: {
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
