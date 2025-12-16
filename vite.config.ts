import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
});
