import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** The commit being built, so the admin dashboard can tell if the frontend and API are running the same one. See src/version.ts */
function buildCommit() {
    try {
        return readFileSync(path.join(__dirname, "..", ".release-info"), "utf8").split("\n")[0];
    } catch {}

    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return "";
    }
}

const config: NextConfig = {
    env: { NEXT_PUBLIC_BUILD_COMMIT: buildCommit() },
    // The repo root, where node_modules lives. Without this Next.js guesses from the nearest lockfile, which can be outside the repo
    turbopack: { root: path.join(__dirname, "..") }
};

export default config;
