import type { NextFunction, Request, Response } from "express";
import { isApproved } from "../beta.js";
import { isSiteAdmin } from "../auth.js";
import {
    createToken, deleteDevice, deleteToken, getDevice, KeysError, listTokens, listUses, nextOtp, raiseCounter, saveDevice, tokenOwner
} from "../keys/store.js";
import { MAX_COUNTER, randomSecrets } from "../keys/yubikey.js";
import { getSchools } from "../schools.js";
import { deny } from "./auth.js";

// Zotify Keys: a virtual YubiKey for Duo, at keys.zotify.app. People add their key there and make API keys for the Zotify
// Keys Chrome extension, which asks for an OTP whenever Duo wants one
//
//   GET    /v1/keys                 your key, API keys and recent OTPs (Zotify's own pages)
//   PUT    /v1/keys/device          adds or replaces your key
//   PATCH  /v1/keys/device          raises its usage counter
//   DELETE /v1/keys/device          deletes it, and its API keys
//   GET    /v1/keys/random          a new random private ID and AES key, for registering a new key with Duo
//   POST   /v1/keys/tokens          makes an API key for the extension
//   DELETE /v1/keys/tokens/:id      deletes one
//   POST   /v1/keys/otp             the next OTP (Bearer zotify_key_…)
//   GET    /v1/keys/whoami          checks an API key without using up an OTP (Bearer zotify_key_…)
//
// An API key can only make OTPs for its owner's key; nothing else in the API accepts one, and it can't read anything back

// OTPs each API key can make an hour: plenty for signing in, too few to burn through the counter
const OTP_LIMIT = 30;
const OTP_WINDOW_MS = 60 * 60 * 1000;
const otpWindows = new Map<number, number[]>();

const noStore = (res: Response) => res.set("Cache-Control", "no-store");

function sendError(res: Response, error: unknown) {
    if (error instanceof KeysError) return deny(res, error.status, error.status === 404 ? "not_found" : "invalid", error.message);
    console.error("Zotify Keys:", error);
    deny(res, 500, "internal", "Something went wrong. Please try again.");
}

/** For keys.zotify.app: signed in with the session cookie, and approved at some school's Zotify. Use after sessionOnly */
export async function keysMember(_req: Request, res: Response, next: NextFunction) {
    const { email } = res.locals.session as { email: string };
    try {
        if (isSiteAdmin(email)) return next();
        for (const school of getSchools()) if (await isApproved(email, school.id)) return next();
        deny(res, 403, "not_approved", "Zotify Keys is for people in Zotify's beta.");
    } catch (error) {
        next(error);
    }
}

const overview = (email: string) => ({ device: getDevice(email), apiKeys: listTokens(email), uses: listUses(email), maxCounter: MAX_COUNTER });

export function keysOverview(_req: Request, res: Response) {
    noStore(res);
    res.json(overview(res.locals.session.email));
}

export function saveDeviceRoute(req: Request, res: Response) {
    noStore(res);
    try {
        saveDevice(res.locals.session.email, req.body ?? {});
        res.json(overview(res.locals.session.email));
    } catch (error) {
        sendError(res, error);
    }
}

export function raiseCounterRoute(req: Request, res: Response) {
    noStore(res);
    try {
        raiseCounter(res.locals.session.email, req.body?.counter);
        res.json(overview(res.locals.session.email));
    } catch (error) {
        sendError(res, error);
    }
}

export function deleteDeviceRoute(_req: Request, res: Response) {
    deleteDevice(res.locals.session.email);
    noStore(res);
    res.json(overview(res.locals.session.email));
}

export function randomSecretsRoute(_req: Request, res: Response) {
    noStore(res);
    res.json(randomSecrets());
}

export function createTokenRoute(req: Request, res: Response) {
    noStore(res);
    try {
        res.status(201).json(createToken(res.locals.session.email, req.body?.name));
    } catch (error) {
        sendError(res, error);
    }
}

export function deleteTokenRoute(req: Request, res: Response) {
    try {
        deleteToken(res.locals.session.email, Number(req.params.id));
        res.sendStatus(204);
    } catch (error) {
        sendError(res, error);
    }
}

/** The API key in a request's Authorization header, or null after answering with a 401 */
function apiKeyOf(req: Request, res: Response) {
    noStore(res);
    const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const owner = token ? tokenOwner(token) : null;
    if (owner) return owner;

    res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    deny(res, 401, "invalid_token", "That API key isn't valid. It may have been deleted; make a new one at keys.zotify.app.");
    return null;
}

export function whoamiRoute(req: Request, res: Response) {
    const owner = apiKeyOf(req, res);
    if (!owner) return;

    const device = getDevice(owner.email);
    res.json({ email: owner.email, apiKey: owner.name, device: device && { publicId: device.publicId, countersLeft: device.countersLeft } });
}

export function otpRoute(req: Request, res: Response) {
    const owner = apiKeyOf(req, res);
    if (!owner) return;

    const now = Date.now();
    const recent = (otpWindows.get(owner.id) ?? []).filter(time => now - time < OTP_WINDOW_MS);
    if (recent.length >= OTP_LIMIT) {
        res.set("Retry-After", String(Math.ceil((recent[0] + OTP_WINDOW_MS - now) / 1000)));
        deny(res, 429, "rate_limited", `Each API key can make ${OTP_LIMIT} OTPs an hour.`);
        return;
    }

    try {
        const otp = nextOtp(owner);
        otpWindows.set(owner.id, [...recent, now]);
        res.json({ otp });
    } catch (error) {
        sendError(res, error);
    }
}
