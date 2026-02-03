import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/server": "next/server.js",
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    deps: {
      inline: ["next-auth"],
    },
  },
});
