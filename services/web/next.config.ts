import type { NextConfig } from "next";

const domain = process.env.DOMAIN || 'localhost';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  allowedDevOrigins: [domain],
};

export default nextConfig;
