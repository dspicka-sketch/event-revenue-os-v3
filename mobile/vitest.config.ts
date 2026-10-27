import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@revos/domain": path.resolve(__dirname, "../src/domain"),
      "@revos/shared": path.resolve(__dirname, "../src/shared"),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
