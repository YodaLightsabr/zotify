import { db } from "./db.js";

// When each person last used Zotify: any signed-in request to the API, by session or token, or a page connecting for live
// updates. Written at most once a minute per person, so busy pages don't write on every request

const WRITE_EVERY_MS = 60_000;

const upsert = db.prepare(`
    INSERT INTO user_activity (email, last_active_at) VALUES (?, ?)
    ON CONFLICT (email) DO UPDATE SET last_active_at = MAX(user_activity.last_active_at, excluded.last_active_at)
`);
const selectAll = db.prepare("SELECT email, last_active_at FROM user_activity");

// When each person's activity was last written, this run
const written = new Map<string, number>();

/** Notes that someone just did something */
export function noteActivity(email: string) {
    const now = Date.now();
    if (now - (written.get(email) ?? 0) < WRITE_EVERY_MS) return;

    written.set(email, now);
    try {
        upsert.run(email, now);
    } catch (error) {
        console.error(`Could not note ${email}'s activity:`, error);
    }
}

/** When each of these people was last active, for the ones who have been */
export function lastActive(emails: string[]): Record<string, number> {
    const wanted = new Set(emails);
    return Object.fromEntries((selectAll.all() as { email: string, last_active_at: number }[])
        .filter(row => wanted.has(row.email)).map(row => [row.email, row.last_active_at]));
}
