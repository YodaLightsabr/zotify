/*
 * Yubico OTP generation, for Zotify Keys.
 *
 * Ported from yksim's JavaScript version (lib/yksim.js), itself loosely based on YubiOTP 1.0.0
 * (https://pypi.org/project/YubiOTP/). yksim is licensed under the GNU General Public License, version 3 or later, and so is
 * this file: you can redistribute it and/or modify it under the terms of the GPL as published by the Free Software
 * Foundation, either version 3 of the License or (at your option) any later version. See https://www.gnu.org/licenses/.
 *
 * Yubico OTP reference: https://docs.yubico.com/yesdk/users-manual/application-otp/yubico-otp.html
 */

import { createCipheriv, randomBytes, randomInt } from "node:crypto";

/** The highest usage counter a YubiKey can have; once it's reached, the key can't make OTPs */
export const MAX_COUNTER = 0x7fff;

const HEX_CHARS = "0123456789abcdef";
const MODHEX_CHARS = "cbdefghijklnrtuv";

/** Whether a string is ModHex, YubiKey's keyboard-safe hex */
export const isModHex = (text: string) => text.length % 2 === 0 && [...text.toLowerCase()].every(char => MODHEX_CHARS.includes(char));

const toModHex = (data: Buffer) => [...data.toString("hex")].map(char => MODHEX_CHARS[HEX_CHARS.indexOf(char)]).join("");

const fromModHex = (text: string) =>
    Buffer.from([...text.toLowerCase()].map(char => HEX_CHARS[MODHEX_CHARS.indexOf(char)]).join(""), "hex");

/** A serial number as a YubiKey public ID, like ddddcccbudfc */
export function publicIdFor(serial: number) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(serial);
    return `dddd${toModHex(bytes)}`;
}

/** The serial number in a public ID made by publicIdFor */
export const serialOf = (publicId: string) => fromModHex(publicId.slice(4)).readUInt32BE();

function crc16(data: Buffer) {
    let crc = 0xffff;
    for (const byte of data) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            const lsb = crc & 1;
            crc >>= 1;
            if (lsb) crc ^= 0x8408;
        }
    }
    return crc;
}

/**
 * One Yubico OTP, as a YubiKey just plugged in would type it: this usage counter, a session counter of 0 and a random
 * timestamp. The caller must save counter + 1 before the OTP is used, since a service rejects any OTP whose counter isn't higher
 * than the last one it accepted
 */
export function generateOtp(key: { publicId: string, privateId: Buffer, aesKey: Buffer }, counter: number) {
    if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) throw new RangeError(`Usage counter must be 0 to ${MAX_COUNTER}`);

    // <6s H 3s B H, then the inverted CRC (H)
    const token = Buffer.alloc(16);
    key.privateId.copy(token, 0);
    token.writeUInt16LE(counter, 6);
    // A random timestamp with 20 bits (about a day and a half) of margin, as on power-on
    token.writeUIntLE(randomInt(0xf00000), 8, 3);
    token.writeUInt8(0, 11);
    token.writeUInt16LE(randomInt(0x10000), 12);
    token.writeUInt16LE(~crc16(token.subarray(0, 14)) & 0xffff, 14);

    const cipher = createCipheriv("aes-128-ecb", key.aesKey, null);
    cipher.setAutoPadding(false);
    return key.publicId + toModHex(Buffer.concat([cipher.update(token), cipher.final()]));
}

/** A new random private ID and AES key, as hex, for registering a new key with a service */
export const randomSecrets = () => ({ privateId: randomBytes(6).toString("hex"), aesKey: randomBytes(16).toString("hex") });
