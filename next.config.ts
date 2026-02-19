//import type { NextConfig } from "next";
//
//const nextConfig: NextConfig = {
//  /* config options here */
//  output: "standalone"
//};
//
//export default nextConfig;


import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
    
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  
};

export default nextConfig;
