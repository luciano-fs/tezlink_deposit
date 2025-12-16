import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import eslintPlugin from "@nabla/vite-plugin-eslint";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    eslintPlugin({
      eslintOptions: {
        cache: false,
        fix: true, // supported by @nabla/vite-plugin-eslint >= 1.3.4
      },
      shouldLint: (path) => {
        // include: src/**/*.(ts|tsx|js|jsx)
        const inSrc = /\/src\/[^?]*\.(ts|tsx|js|jsx)$/.test(path);
        // exclude: node_modules, dist
        const excluded = /\/(node_modules|dist)\//.test(path);
        return inSrc && !excluded;
      },
    }),
    nodePolyfills({
      protocolImports: true, // supports "node:crypto" etc
    }),
  ],
  resolve: {
    alias: {
      crypto: "crypto-browserify",
      stream: "stream-browserify",
      http: "stream-http",
      https: "https-browserify",
      util: "util",
      zlib: "browserify-zlib",
    },
  },
  define: {
    global: "globalThis",
  },
  preview: {
    allowedHosts: ["bridge.shadownet.tezlink.nomadic-labs.com"],
  },
});
