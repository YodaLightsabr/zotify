import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DB_FILE } from "./db.js";

// Encryption for secrets kept in the database: Zotify Keys' YubiKey secrets and people's Spotify tokens. The key isn't in the
// database: KEYS_SECRET (64 hex digits), or else .keys-secret, a file made next to the database the first time it's needed.
// Database backups (npm run backup) don't include it, so without it these can't be read

let secretKey: Buffer | null = null;

function encryptionKey() {
    if (secretKey) return secretKey;

    const fromEnv = process.env.KEYS_SECRET?.trim();
    if (fromEnv) {
        if (!/^[0-9a-f]{64}$/i.test(fromEnv)) throw new Error("KEYS_SECRET must be 64 hex digits");
        return (secretKey = Buffer.from(fromEnv, "hex"));
    }

    const file = join(dirname(DB_FILE), ".keys-secret");
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    return (secretKey = Buffer.from(readFileSync(file, "utf8").trim(), "hex"));
}

/** Encrypts a value for the database (AES-256-GCM), as iv.tag.ciphertext in base64url */
export function seal(value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const sealed = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), sealed].map(part => part.toString("base64url")).join(".");
}

/** Decrypts what seal made. Throws if it was changed, or sealed with another key */
export function unseal<T>(text: string): T {
    const [iv, tag, sealed] = text.split(".").map(part => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(sealed), decipher.final()]).toString("utf8"));
}
