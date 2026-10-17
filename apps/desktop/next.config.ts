import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const isProd = process.env.NODE_ENV === "production";
const internalHost = process.env.TAURI_DEV_HOST || "localhost";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
  productionBrowserSourceMaps: false,
  turbopack: {},

  webpack: (config: Configuration) => {
    config.module = config.module || { rules: [] };
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules\/framer-motion/,
      loader: "string-replace-loader",
      options: {
        search: /\/\/# sourceMappingURL=.+\.map/g,
        replace: "",
      },
    });

    return config;
  },
};

export default nextConfig;
