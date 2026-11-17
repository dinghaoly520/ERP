import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
    // bug#163（2026-11-17）：门户同源 /socket.io 反代到 API（生产门户 vhost nginx 无此
    // location，由门户自身转发；proxy.ts publicPaths 已放行）。两条 source 兼容带/不带
    // 尾斜杠（旧版 socket.io-client 不补斜杠，API 网关已 addTrailingSlash:false 双形式兼容）。
    // WS 升级请求过不了 rewrites——socket.io 自动降级留轮询，功能完整（设计内降级）。
    { source: '/socket.io', destination: `${apiOrigin()}/socket.io` },
    { source: '/socket.io/:path*', destination: `${apiOrigin()}/socket.io/:path*` },
  ],
  // L4（2026-08-28）：旧开标大厅链接兼容重定向——工作区化后 /bid/open 路由被删，
  // 外部留存的旧链接（历史通知/归档材料/书签）404。has 命名捕获把查询参数 id 映射进
  // 目标路径；先匹配带 id（→工作区开标大厅 tab），再兜底无 id（→任务板）。
  // 用 config redirects 而非页面内 redirect()：后者 await searchParams 后触发已晚于
  // 流式首块 flush，会降级为 200+客户端跳转，对书签/链接预览不友好。
  redirects: async () => [
    {
      source: '/bid/open',
      has: [{ type: 'query', key: 'id', value: '(?<id>[^&]+)' }],
      destination: '/bid/project/:id?tab=open',
      permanent: false,
    },
    { source: '/bid/open', destination: '/bid', permanent: false },
  ],
};

export default nextConfig;
