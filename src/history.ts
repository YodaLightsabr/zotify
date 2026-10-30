import type { VenueName } from "./accounts.js";
import { db } from "./db.js";

// A lasting record of every song queued through Zotify. The "queued" log only keeps two hours for badges; this keeps them all,
// since it's everyone's History in their Library. The admin dashboard only shows the newest
const ADMIN_HISTORY = 5000;

export interface HistoryEntry {
    pickId: string;
    songId: string;
    name: string;
    artist: string;
    cover?: string;
    venue: VenueName;
    requestedAt: number;
    // Who queued it; missing for picks from before the history existed
    requestedBy?: string;
}

interface HistoryRow {
    pick_id: string;
    song_id: string;
    name: string;
    artist: string;
    cover: string | null;
    venue: VenueName;
    requested_at: number;
    requested_by: string | null;
}

const toEntry = (row: HistoryRow): HistoryEntry => ({
    pickId: row.pick_id,
    songId: row.song_id,
    name: row.name,
    artist: row.artist,
    ...(row.cover ? { cover: row.cover } : {}),
    venue: row.venue,
    requestedAt: row.requested_at,
    ...(row.requested_by ? { requestedBy: row.requested_by } : {})
});

const insert = db.prepare(`
    INSERT INTO pick_history (pick_id, song_id, name, artist, cover, venue, requested_at, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectAll = db.prepare("SELECT * FROM pick_history ORDER BY requested_at DESC, id DESC LIMIT ?");
const selectFor = db.prepare("SELECT * FROM pick_history WHERE requested_by = ? ORDER BY requested_at DESC, id DESC");

export async function recordPick(entry: HistoryEntry) {
    insert.run(entry.pickId, entry.songId, entry.name, entry.artist, entry.cover ?? null, entry.venue, entry.requestedAt, entry.requestedBy ?? null);
}

/** The newest recorded picks, newest first */
export async function getHistory() {
    return (selectAll.all(ADMIN_HISTORY) as unknown as HistoryRow[]).map(toEntry);
}

/** One person's picks, newest first */
export async function getHistoryFor(email: string) {
    return (selectFor.all(email) as unknown as HistoryRow[]).map(toEntry);
}
