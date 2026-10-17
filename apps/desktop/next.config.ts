import type { NextConfig } from "next";
import { type Configuration, NormalModuleReplacementPlugin } from "webpack";

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

  webpack: (config: Configuration, { isServer }) => {
    if (!isServer) {
      // PptxGenJS conditionally imports these on Node. Webpack processes node: schemes
      // before its browser mappings, so normalize them before applying the fallbacks.
      config.plugins = config.plugins || [];
      config.plugins.push(
        new NormalModuleReplacementPlugin(/^node:(fs|https)$/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve = config.resolve || {};
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, https: false };
    }
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
