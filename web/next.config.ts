import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
    // The repo root, where node_modules lives. Without this Next.js guesses from the nearest lockfile, which can be outside the repo
    turbopack: { root: path.join(__dirname, "..") }
};

export default config;
