import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db.js";
import { getVersion } from "./version.js";

// How long deploys take, for the admin dashboard's progress bar. Each release records how long its commit took from being
// committed to going live (the API starting on it). deploy/deploy.sh writes the newest commit on GitHub, and whether it's
// building, failed or live, to shared/deploy-status every minute, which says when a new one is on its way

// Deploys this long or longer are left out of the average: they're commits that sat on a computer before being pushed
const OUTLIER_MS = 60 * 60 * 1000;
// How many recent deploys the average is over
const RECENT = 20;
// Until there are any, a guess
const DEFAULT_TTL_MS = 3 * 60 * 1000;

// Written by deploy/deploy.sh. Only exists on the server, where ZOTIFY_ROOT is set
const STATUS_FILE = process.env.ZOTIFY_ROOT ? join(process.env.ZOTIFY_ROOT, "shared", "deploy-status") : null;

/** Records the running release's time to live, the first time it starts. Releases only; nothing is recorded in development */
export function recordGoLive() {
    const version = getVersion();
    const committedAt = version?.committedAt ? Date.parse(version.committedAt) : NaN;
    if (!version?.deployedAt || Number.isNaN(committedAt)) return;

    db.prepare("INSERT OR IGNORE INTO deploy_times (commit_hash, committed_at, live_at) VALUES (?, ?, ?)").run(version.commit, committedAt, Date.now());
}

/** The average time from commit to live over recent deploys, and how many it's from */
export function averageTimeToLive() {
    const rows = db.prepare("SELECT live_at - committed_at AS ttl FROM deploy_times WHERE live_at - committed_at BETWEEN 0 AND ? ORDER BY live_at DESC LIMIT ?")
        .all(OUTLIER_MS, RECENT) as { ttl: number }[];

    return {
        averageMs: rows.length ? Math.round(rows.reduce((total, row) => total + row.ttl, 0) / rows.length) : DEFAULT_TTL_MS,
        samples: rows.length
    };
}

export interface DeployStatus {
    commit: string;
    committedAt: string;
    state: "building" | "failed" | "live";
    subject: string;
}

/** The newest commit on GitHub and where it stands, as of the deploy script's last run. Null off the server */
export function deployStatus(): DeployStatus | null {
    if (!STATUS_FILE) return null;

    try {
        const [commit, committedAt, state, subject] = readFileSync(STATUS_FILE, "utf8").split("\n");
        if (!/^[0-9a-f]{40}$/.test(commit) || !["building", "failed", "live"].includes(state)) return null;
        return { commit, committedAt, state: state as DeployStatus["state"], subject: subject ?? "" };
    } catch {
        return null;
    }
}
