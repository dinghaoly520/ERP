import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
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
