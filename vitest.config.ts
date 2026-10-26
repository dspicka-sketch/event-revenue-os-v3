import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // DB-backed tests share one test database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
