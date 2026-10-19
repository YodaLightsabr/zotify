import { db } from "./db.js";
// The small sections of Zotify's data (sessions, members, invite codes, queued songs...), stored as JSON in SQLite's kv table.
// They're loaded into memory once, so code that reads a section, changes it and saves it always works on the same object;
// each save writes just that section, atomically. Songs, searches and pick history have their own tables (see db.ts)
export class Cache {
    #data;
    #save = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
    #load() {
        if (!this.#data) {
            this.#data = {};
            for (const row of db.prepare("SELECT key, value FROM kv").all()) {
                this.#data[row.key] = JSON.parse(row.value);
            }
        }
        return this.#data;
    }
    async get(key) {
        const segments = Array.isArray(key) ? key : key.split('.');
        return segments.reduce((acc, segment) => acc?.[segment], this.#load());
    }
    async set(key, value) {
        const segments = Array.isArray(key) ? [...key] : key.split('.');
        const data = this.#load();
        const lastSegment = segments.pop();
        if (!lastSegment)
            return;
        const target = segments.reduce((acc, segment) => acc?.[segment], data);
        if (!target)
            return;
        target[lastSegment] = value;
        // Only the top-level section that changed is written
        const section = segments[0] ?? lastSegment;
        this.#save.run(section, JSON.stringify(data[section]));
    }
}
export const cache = new Cache();
//# sourceMappingURL=cache.js.map