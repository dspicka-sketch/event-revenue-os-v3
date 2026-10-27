import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Executive OS imports RevOS's shared API types and money formatting from ../src.
  turbopack: { root: path.join(__dirname, "..") },
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
