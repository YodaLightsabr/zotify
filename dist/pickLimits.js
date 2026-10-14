import { cache } from "./cache.js";
// Rockbot doesn't say when a pick limit resets, so treat a hit as valid for this long
export const PICK_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
async function readLog() {
    return (await cache.get(["pickLimits"])) ?? {};
}
async function writeLog(update) {
    const log = await readLog();
    const cutoff = Date.now() - PICK_LIMIT_COOLDOWN_MS;
    // Drop expired entries so the cache doesn't grow forever
    for (const [venueName, accounts] of Object.entries(log)) {
        log[venueName] = Object.fromEntries(Object.entries(accounts).filter(([, time]) => time >= cutoff));
    }
    update(log);
    await cache.set(["pickLimits"], log);
}
/** Returns usernames that hit their pick limit at this venue within the cooldown, mapped to when they hit it */
export async function getPickLimited(venue) {
    const cutoff = Date.now() - PICK_LIMIT_COOLDOWN_MS;
    const entries = Object.entries((await readLog())[venue] ?? {});
    return Object.fromEntries(entries.filter(([, hitAt]) => hitAt >= cutoff));
}
export async function markPickLimited(venue, username, hitAt = Date.now()) {
    await writeLog(log => {
        log[venue] = { ...log[venue], [username]: hitAt };
    });
}
export async function clearPickLimited(venue, username) {
    await writeLog(log => {
        if (log[venue])
            delete log[venue][username];
    });
}
//# sourceMappingURL=pickLimits.js.map