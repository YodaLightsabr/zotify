// Writes a consistent copy of the database to backups/, safe to run while the server is up.
// Copying .zotify.db directly can catch it mid-write; VACUUM INTO can't
import { mkdirSync } from "node:fs";
import { db, DB_FILE } from "../db.js";

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const target = `backups/zotify-${stamp}.db`;

mkdirSync("backups", { recursive: true });
db.prepare("VACUUM INTO ?").run(target);

console.log(`Backed up ${DB_FILE} to ${target}`);
