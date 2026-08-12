import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.109", "192.168.1.111", "10.20.145.152", "localhost"],
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://localhost:4001/api/:path*' },
  ],
};

export default nextConfig;
