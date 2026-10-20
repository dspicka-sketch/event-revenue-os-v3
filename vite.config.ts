import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web UI only talks to the RevOS server API. It never receives provider
// secrets and never calls vendor APIs directly.
export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
