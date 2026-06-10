import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  rewrites: [
    { source: '/api/:path*', destination: 'http://localhost:4001/:path*' },
  ],
};

export default nextConfig;
