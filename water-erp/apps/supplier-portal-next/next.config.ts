import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*", "10.20.145.*", "localhost"],
};

export default nextConfig;
