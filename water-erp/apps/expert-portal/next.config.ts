import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 允许局域网（平板/外部设备）访问 dev 服务器：否则 HMR websocket 只信任 localhost，
  // 非 localhost 主机连不上 HMR → dev 客户端运行时不 hydrate → 页面是死 SSR（登录原生提交、
  // useEffect 不跑）。生产构建无此问题。
  allowedDevOrigins: ['192.168.1.111'],
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
};

export default nextConfig;
