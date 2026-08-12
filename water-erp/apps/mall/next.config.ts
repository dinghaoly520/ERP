import type { NextConfig } from 'next';

const config: NextConfig = {
  allowedDevOrigins: ["*"],
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
};

export default config;
