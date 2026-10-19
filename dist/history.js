import { db, transaction } from "./db.js";
// A lasting record of every song queued through Zotify. The "queued" log only keeps two hours for badges; this keeps them all
const MAX_HISTORY = 5000;
const toEntry = (row) => ({
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
export async function recordPick(entry) {
    transaction(() => {
        insert.run(entry.pickId, entry.songId, entry.name, entry.artist, entry.cover ?? null, entry.venue, entry.requestedAt, entry.requestedBy ?? null);
        trim.run(MAX_HISTORY);
    });
}
/** Every recorded pick, newest first */
export async function getHistory() {
    return selectAll.all().map(toEntry);
}
/** One person's picks, newest first */
export async function getHistoryFor(email) {
    return selectFor.all(email).map(toEntry);
}
//# sourceMappingURL=history.js.map