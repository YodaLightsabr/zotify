import type { VenueName } from "./accounts.js";
import { db, transaction } from "./db.js";

// A lasting record of every song queued through Zotify. The "queued" log only keeps two hours for badges; this keeps them all
const MAX_HISTORY = 5000;

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
// Drop the oldest picks so the history can't grow forever
const trim = db.prepare("DELETE FROM pick_history WHERE id NOT IN (SELECT id FROM pick_history ORDER BY id DESC LIMIT ?)");
const selectAll = db.prepare("SELECT * FROM pick_history ORDER BY requested_at DESC, id DESC");
const selectFor = db.prepare("SELECT * FROM pick_history WHERE requested_by = ? ORDER BY requested_at DESC, id DESC");

export async function recordPick(entry: HistoryEntry) {
    transaction(() => {
        insert.run(entry.pickId, entry.songId, entry.name, entry.artist, entry.cover ?? null, entry.venue, entry.requestedAt, entry.requestedBy ?? null);
        trim.run(MAX_HISTORY);
    });
}

/** Every recorded pick, newest first */
export async function getHistory() {
    return (selectAll.all() as unknown as HistoryRow[]).map(toEntry);
}

/** One person's picks, newest first */
export async function getHistoryFor(email: string) {
    return (selectFor.all(email) as unknown as HistoryRow[]).map(toEntry);
}
