import { db } from "./db.js";

// Everyone Zotify knows (the users table): anyone who's signed in, been invited or asked to join, by email. Also when each
// last used Zotify: any signed-in request to the API, by session or token, or a page connecting for live updates. That's
// written at most once a minute per person, so busy pages don't write on every request

const WRITE_EVERY_MS = 60_000;

const addUser = db.prepare("INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)");
const saveActivity = db.prepare(`
    INSERT INTO users (email, created_at, last_active_at) VALUES (?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET last_active_at = MAX(COALESCE(users.last_active_at, 0), excluded.last_active_at)
`);
const selectActivity = db.prepare("SELECT email, last_active_at FROM users WHERE last_active_at IS NOT NULL");

// When each person's activity was last written, this run
const written = new Map<string, number>();

/** Makes sure Zotify knows someone, before anything else is saved about them */
export function ensureUser(email: string) {
    addUser.run(email, Date.now());
}

/** Notes that someone just did something */
export function noteActivity(email: string) {
    const now = Date.now();
    if (now - (written.get(email) ?? 0) < WRITE_EVERY_MS) return;

    written.set(email, now);
    try {
        saveActivity.run(email, now, now);
    } catch (error) {
        console.error(`Could not note ${email}'s activity:`, error);
    }
}

/** When each of these people was last active, for the ones who have been */
export function lastActive(emails: string[]): Record<string, number> {
    const wanted = new Set(emails);
    return Object.fromEntries((selectActivity.all() as { email: string, last_active_at: number }[])
        .filter(row => wanted.has(row.email)).map(row => [row.email, row.last_active_at]));
}
