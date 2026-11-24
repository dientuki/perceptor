import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const domain = process.env.DOMAIN || "localhost";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  allowedDevOrigins: [domain],
  experimental: {
    serverActions: {
      bodySizeLimit: "24mb",
    },
  },
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
