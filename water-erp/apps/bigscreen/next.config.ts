import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost", "127.0.0.1"], // 裸 "*" 无效（66256e4e 同根），显式列表才能放行局域网 HMR
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
  ],
};

export default nextConfig;
