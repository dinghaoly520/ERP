import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
};

export default nextConfig;
