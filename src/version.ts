import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Which commit is running, for the admin dashboard. Deployed releases are plain copies without .git, so deploy/deploy.sh
// writes .release-info into each one: the commit, when it was committed, its message, the repo, and when it was deployed,
// one per line. Running from a checkout (like in development), git is asked instead
const RELEASE_INFO = ".release-info";

export interface VersionInfo {
    commit: string;
    committedAt: string;
    subject: string;
    // The commit on GitHub, when the repo is there
    url: string | null;
    // When this release went live; null when running from a checkout
    deployedAt: string | null;
    // When this API process started
    startedAt: string;
}

const startedAt = new Date().toISOString();

/** A GitHub page for the commit, from a remote like git@github.com:owner/repo.git or https://github.com/owner/repo.git */
function commitUrl(remote: string, commit: string) {
    const match = remote.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
    return match ? `https://github.com/${match[1]}/${match[2]}/commit/${commit}` : null;
}

function readVersion(): Omit<VersionInfo, "startedAt"> | null {
    try {
        const [commit, committedAt, subject, remote, deployedAt] = readFileSync(RELEASE_INFO, "utf8").split("\n");
        if (commit) return { commit, committedAt, subject, url: commitUrl(remote ?? "", commit), deployedAt: deployedAt || null };
    } catch {}

    try {
        const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const [commit, committedAt, subject] = git("log", "-1", "--format=%H%n%cI%n%s").split("\n");
        const remote = (() => { try { return git("remote", "get-url", "origin"); } catch { return ""; } })();
        return { commit, committedAt, subject, url: commitUrl(remote, commit), deployedAt: null };
    } catch {
        return null;
    }
}

// Read once: the running code doesn't change until the process restarts
const version = readVersion();

/** The running commit, or null if it can't be told */
export function getVersion(): VersionInfo | null {
    return version && { ...version, startedAt };
}
