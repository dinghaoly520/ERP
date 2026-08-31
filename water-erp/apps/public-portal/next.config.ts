import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
  ],
};

export default nextConfig;
