import { createHash, randomBytes } from "node:crypto";
import { db, transaction } from "../db.js";
import { seal, unseal } from "../secrets.js";
import { generateOtp, isModHex, MAX_COUNTER, publicIdFor, serialOf } from "./yubikey.js";

// Zotify Keys: each person's virtual YubiKey, the API keys their Chrome extension uses to ask for OTPs, and a record of each OTP.
//
// The private ID and AES key are someone's second factor, so they're encrypted at rest (AES-256-GCM) with a key that isn't in
// the database (see secrets.ts). Once saved, they're never sent back, even to their owner.
//
// The usage counter only ever goes up: every OTP is made and the counter raised in one transaction, and a service like Duo
// rejects any OTP whose counter isn't higher than the last it accepted. Restoring an older copy of the database would roll
// counters back, so after one, raise each key's counter past what it was (keys.zotify.app can)

db.exec(`
    CREATE TABLE IF NOT EXISTS keys_devices (
        email TEXT PRIMARY KEY,
        public_id TEXT NOT NULL,
        -- The private ID and AES key, encrypted (see seal)
        secrets TEXT NOT NULL,
        counter INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );

    -- API keys for the Chrome extension: each can only make OTPs for its owner's key. Only a hash is kept
    CREATE TABLE IF NOT EXISTS keys_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
    );

    -- Every OTP made, so people can spot one they didn't ask for
    CREATE TABLE IF NOT EXISTS keys_uses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        token_name TEXT NOT NULL,
        counter INTEGER NOT NULL,
        used_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS keys_uses_email ON keys_uses (email, used_at);
`);

// How many recent uses each person's record keeps
const KEEP_USES = 100;
const MAX_TOKENS = 10;

/** A problem with what someone asked for. status is the HTTP status to answer with */
export class KeysError extends Error {
    status: number;

    constructor (message: string, status = 400) {
        super(message);
        this.name = "KeysError";
        this.status = status;
    }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Keys

interface DeviceRow { email: string, public_id: string, secrets: string, counter: number, created_at: number }

const toDevice = (row: DeviceRow) => ({
    publicId: row.public_id,
    // Keys made from a serial number have one; others, with a public ID of their own, may not
    serial: row.public_id.startsWith("dddd") ? serialOf(row.public_id) : null,
    // The next OTP's usage counter
    counter: row.counter,
    countersLeft: MAX_COUNTER - row.counter + 1,
    createdAt: row.created_at
});

export function getDevice(email: string) {
    const row = db.prepare("SELECT * FROM keys_devices WHERE email = ?").get(email) as unknown as DeviceRow | undefined;
    return row ? toDevice(row) : null;
}

/**
 * Saves someone's key, replacing any they had: serial (a number) or publicId (12 ModHex digits), privateId (12 hex digits),
 * aesKey (32 hex digits), and counter, the usage counter to start from (past the last one the service saw)
 */
export function saveDevice(email: string, input: { serial?: unknown, publicId?: unknown, privateId?: unknown, aesKey?: unknown, counter?: unknown }) {
    const serial = input.serial === undefined || input.serial === null || input.serial === "" ? null : Number(input.serial);
    const givenPublicId = typeof input.publicId === "string" && input.publicId.trim() ? input.publicId.trim().toLowerCase() : null;
    const privateId = typeof input.privateId === "string" ? input.privateId.trim().toLowerCase() : "";
    const aesKey = typeof input.aesKey === "string" ? input.aesKey.trim().toLowerCase() : "";
    const counter = input.counter === undefined || input.counter === "" ? 0 : Number(input.counter);

    if ((serial === null) === (givenPublicId === null)) throw new KeysError("Give either the serial number or the public ID.");
    if (serial !== null && !(Number.isInteger(serial) && serial >= 0 && serial <= 0xffffffff)) throw new KeysError("The serial number must be a whole number up to 4294967295.");
    if (givenPublicId !== null && !(givenPublicId.length === 12 && isModHex(givenPublicId))) throw new KeysError("The public ID must be 12 ModHex characters (cbdefghijklnrtuv).");
    if (!/^[0-9a-f]{12}$/.test(privateId)) throw new KeysError("The private ID must be 12 hex digits.");
    if (!/^[0-9a-f]{32}$/.test(aesKey)) throw new KeysError("The AES key must be 32 hex digits.");
    if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) throw new KeysError(`The usage counter must be 0 to ${MAX_COUNTER}.`);

    const publicId = givenPublicId ?? publicIdFor(serial!);
    db.prepare(`
        INSERT INTO keys_devices (email, public_id, secrets, counter, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (email) DO UPDATE SET public_id = excluded.public_id, secrets = excluded.secrets, counter = excluded.counter, created_at = excluded.created_at
    `).run(email, publicId, seal({ privateId, aesKey }), counter, Date.now());

    return getDevice(email)!;
}

/** Raises a key's usage counter, e.g. after an older copy of it was used. It never goes down */
export function raiseCounter(email: string, counter: unknown) {
    const device = getDevice(email);
    if (!device) throw new KeysError("You haven't added a key yet.", 404);

    const next = Number(counter);
    if (!Number.isInteger(next) || next <= device.counter || next > MAX_COUNTER) {
        throw new KeysError(`The counter can only go up: give a number from ${device.counter + 1} to ${MAX_COUNTER}.`);
    }

    db.prepare("UPDATE keys_devices SET counter = ? WHERE email = ? AND counter < ?").run(next, email, next);
    return getDevice(email)!;
}

/** Deletes someone's key, and their API keys with it */
export function deleteDevice(email: string) {
    transaction(() => {
        db.prepare("DELETE FROM keys_devices WHERE email = ?").run(email);
        db.prepare("DELETE FROM keys_tokens WHERE email = ?").run(email);
    });
}

// API keys

interface TokenRow { id: number, email: string, name: string, prefix: string, created_at: number, last_used_at: number | null }

const toToken = (row: TokenRow) => ({ id: row.id, name: row.name, prefix: row.prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at });

export const listTokens = (email: string) =>
    (db.prepare("SELECT * FROM keys_tokens WHERE email = ? ORDER BY created_at DESC").all(email) as unknown as TokenRow[]).map(toToken);

/** Makes an API key for the Chrome extension. The key itself is only returned here */
export function createToken(email: string, name: unknown) {
    const label = typeof name === "string" ? name.trim() : "";
    if (!label || label.length > 60) throw new KeysError("Give the API key a name of up to 60 characters, like the computer it's for.");
    if (!getDevice(email)) throw new KeysError("Add your key before making an API key for it.", 409);

    const { count } = db.prepare("SELECT COUNT(*) AS count FROM keys_tokens WHERE email = ?").get(email) as { count: number };
    if (count >= MAX_TOKENS) throw new KeysError(`You can have up to ${MAX_TOKENS} API keys. Delete one you don't use first.`, 409);

    const token = `zotify_key_${randomBytes(32).toString("base64url")}`;
    const { lastInsertRowid } = db.prepare("INSERT INTO keys_tokens (email, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(email, label, sha256(token), token.slice(0, 15), Date.now());

    return { ...toToken(db.prepare("SELECT * FROM keys_tokens WHERE id = ?").get(lastInsertRowid) as unknown as TokenRow), token };
}

export function deleteToken(email: string, id: number) {
    const { changes } = db.prepare("DELETE FROM keys_tokens WHERE id = ? AND email = ?").run(id, email);
    if (!changes) throw new KeysError("There's no API key with that ID.", 404);
}

/** Who an API key belongs to, or null */
export function tokenOwner(token: string) {
    if (!token.startsWith("zotify_key_")) return null;
    return (db.prepare("SELECT * FROM keys_tokens WHERE token_hash = ?").get(sha256(token)) as unknown as TokenRow | undefined) ?? null;
}

// OTPs

/**
 * Makes the next OTP for an API key's owner and raises their counter, in one transaction, so no two OTPs share a counter
 * and the counter is saved before the OTP leaves the server
 */
export function nextOtp(token: TokenRow) {
    return transaction(() => {
        const row = db.prepare("SELECT * FROM keys_devices WHERE email = ?").get(token.email) as unknown as DeviceRow | undefined;
        if (!row) throw new KeysError("This API key's owner has no key. Add one at keys.zotify.app.", 404);
        if (row.counter > MAX_COUNTER) throw new KeysError("This key has used every counter it has. Register a new one with Duo, then add it at keys.zotify.app.", 409);

        const { privateId, aesKey } = unseal<{ privateId: string, aesKey: string }>(row.secrets);
        const otp = generateOtp({ publicId: row.public_id, privateId: Buffer.from(privateId, "hex"), aesKey: Buffer.from(aesKey, "hex") }, row.counter);
        const now = Date.now();

        db.prepare("UPDATE keys_devices SET counter = counter + 1 WHERE email = ?").run(token.email);
        db.prepare("UPDATE keys_tokens SET last_used_at = ? WHERE id = ?").run(now, token.id);
        db.prepare("INSERT INTO keys_uses (email, token_name, counter, used_at) VALUES (?, ?, ?, ?)").run(token.email, token.name, row.counter, now);
        db.prepare("DELETE FROM keys_uses WHERE email = ? AND id NOT IN (SELECT id FROM keys_uses WHERE email = ? ORDER BY id DESC LIMIT ?)")
            .run(token.email, token.email, KEEP_USES);

        return otp;
    });
}

/** Someone's recent OTPs, newest first: when, which API key, and which counter */
export const listUses = (email: string) =>
    (db.prepare("SELECT token_name, counter, used_at FROM keys_uses WHERE email = ? ORDER BY id DESC LIMIT 30").all(email) as { token_name: string, counter: number, used_at: number }[])
        .map(row => ({ apiKey: row.token_name, counter: row.counter, usedAt: row.used_at }));
