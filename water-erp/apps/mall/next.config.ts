import type { NextConfig } from 'next';
import { apiOrigin } from '@water-erp/config';

const config: NextConfig = {
  allowedDevOrigins: ["*"],
  rewrites: async () => [
    { source: '/api/:path*', destination: `${apiOrigin()}/api/:path*` },
  ],
};

export default config;
