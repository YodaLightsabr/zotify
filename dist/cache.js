import { readFile, rename, writeFile } from "node:fs/promises";
export class Cache {
    fileName;
    // The file is read once and kept in memory, so reads never see a half-written file
    #data;
    // Writes run one at a time so concurrent saves can't overwrite each other
    #writing = Promise.resolve();
    constructor(fileName) {
        this.fileName = fileName;
    }
    async get(key) {
        const segments = Array.isArray(key) ? key : key.split('.');
        const data = await this.#readWhole();
        return segments.reduce((acc, segment) => acc?.[segment], data);
    }
    async set(key, value) {
        const segments = Array.isArray(key) ? key : key.split('.');
        const data = await this.#readWhole();
        const lastSegment = segments.pop();
        if (!lastSegment)
            return;
        const target = segments.reduce((acc, segment) => acc?.[segment], data);
        if (target) {
            target[lastSegment] = value;
            await this.#writeWhole(data);
        }
    }
    async #readWhole() {
        this.#data ??= readFile(this.fileName, "utf8").then(text => JSON.parse(text), 
        // A missing file is just an empty cache
        error => { if (error?.code === "ENOENT")
            return {}; throw error; });
        // Don't keep a failed read around; try the file again next time
        return await this.#data.catch(error => {
            this.#data = undefined;
            throw error;
        });
    }
    async #writeWhole(data) {
        const write = this.#writing.then(async () => {
            // Write a temporary file and rename it over the real one, so the file is never half-written
            const temporary = `${this.fileName}.tmp`;
            // No indentation: it nearly doubled the file's size
            await writeFile(temporary, JSON.stringify(data));
            await rename(temporary, this.fileName);
        });
        // A failed write shouldn't block the ones after it
        this.#writing = write.catch(() => { });
        return await write;
    }
}
export const cache = new Cache(".cache.json");
//# sourceMappingURL=cache.js.map