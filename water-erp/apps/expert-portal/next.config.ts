import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  // 允许局域网（平板/外部设备）访问 dev 服务器：否则 HMR websocket 只信任 localhost，
  // 非 localhost 主机连不上 HMR → dev 客户端运行时不 hydrate → 页面是死 SSR（登录原生提交、
  // useEffect 不跑）。生产构建无此问题。
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
    // bug#163（2026-11-17）：门户同源 /socket.io 反代到 API（生产门户 vhost nginx 无此
    // location，由门户自身转发；proxy.ts 已放行）。两条 source 兼容带/不带尾斜杠；WS 升级
    // 过不了 rewrites——socket.io 自动降级留轮询（设计内降级）。
    { source: '/socket.io', destination: `${apiOrigin()}/socket.io` },
    { source: '/socket.io/:path*', destination: `${apiOrigin()}/socket.io/:path*` },
  ],
};

export default nextConfig;
