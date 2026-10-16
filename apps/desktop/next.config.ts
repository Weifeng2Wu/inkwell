import type { NextConfig } from "next";
import TerserPlugin from "terser-webpack-plugin";
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

  webpack: (config: Configuration, { isServer }) => {
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

    if (isProd && !isServer) {
      config.optimization = {
        ...config.optimization,
        minimize: true,
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              compress: {
                drop_console: true,
                drop_debugger: true,
                pure_funcs: ["console.info", "console.debug", "console.warn"],
                passes: 3,
              },
              mangle: {
                safari10: true,
                properties: {
                  regex: /^_/,
                },
              },
              format: {
                comments: false,
              },
            },
            extractComments: false,
          }),
        ],
      };
    }

    return config;
  },
};

export default nextConfig;
