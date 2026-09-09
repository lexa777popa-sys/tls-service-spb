import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
        privacy: resolve(__dirname, "privacy.html"),
        consent: resolve(__dirname, "consent.html"),
        cookies: resolve(__dirname, "cookies.html"),
      },
    },
  },
});
