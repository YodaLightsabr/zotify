import type { Request, Response } from "express";
import { AccountError, deleteAccount, listAccounts, saveAccount } from "../accounts.js";
import { signInEmail } from "../auth.js";
import {
    addSchoolAdmin, deleteSchool, deleteVenue, getSchoolAdmins, getSchools, getVenues, publicSchool, removeSchoolAdmin,
    saveSchool, saveVenue, SchoolConfigError, schoolForHost
} from "../schools.js";
import { requestSchool } from "./params.js";

function sendConfigError(res: Response, error: unknown, context: string) {
    if (error instanceof SchoolConfigError || error instanceof AccountError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

// For everyone

/**
 * A school's name, sign-in details, wording and venues. The frontend's server passes ?host= (it has no Origin);
 * browsers get the school whose site they're on
 */
export function school(req: Request, res: Response) {
    const host = typeof req.query.host === "string" ? req.query.host : undefined;
    const found = host ? schoolForHost(host) : requestSchool(res);

    if (!found) {
        res.status(404).json({ error: "There's no school at that address" });
        return;
    }

    res.json(publicSchool(found));
}

/** Every school, as above. The frontend uses this to tell which subdomains are real */
export function schools(_req: Request, res: Response) {
    res.json(getSchools().map(publicSchool));
}

// Site admins

/** Every school with its venues (Rockbot IDs and home accounts included) and admins */
export function adminSchools(_req: Request, res: Response) {
    res.json(getSchools().map(school => ({
        ...publicSchool(school),
        venues: getVenues(school.id),
        admins: getSchoolAdmins(school.id)
    })));
}

/** Body: a school's fields. Adds it, or updates the school with that id */
export function saveSchoolRoute(req: Request, res: Response) {
    try {
        res.json(publicSchool(saveSchool(req.body ?? {})));
    } catch (error) {
        sendConfigError(res, error, "Error saving a school:");
    }
}

/** Body: { id } */
export function deleteSchoolRoute(req: Request, res: Response) {
    try {
        deleteSchool(String(req.body?.id ?? ""));
        res.json({ ok: true });
    } catch (error) {
        sendConfigError(res, error, "Error removing a school:");
    }
}

/** Body: a venue's fields. Adds it, or updates the venue with that id */
export function saveVenueRoute(req: Request, res: Response) {
    try {
        res.json(saveVenue(req.body ?? {}));
    } catch (error) {
        sendConfigError(res, error, "Error saving a venue:");
    }
}

/** Body: { id } */
export function deleteVenueRoute(req: Request, res: Response) {
    try {
        deleteVenue(String(req.body?.id ?? ""));
        res.json({ ok: true });
    } catch (error) {
        sendConfigError(res, error, "Error removing a venue:");
    }
}

/** Body: { schoolId, email, remove? }. Adds or removes one of a school's admins; a bare ID gets the school's email domain */
export function schoolAdminRoute(req: Request, res: Response) {
    const schoolId = String(req.body?.schoolId ?? "");
    const target = getSchools().find(school => school.id === schoolId);
    const email = target ? signInEmail(req.body?.email, target) : null;

    if (!target || !email) {
        res.status(400).json({ error: "Pick a school and enter an email address." });
        return;
    }

    try {
        if (req.body?.remove === true) removeSchoolAdmin(schoolId, email);
        else addSchoolAdmin(schoolId, email);
        res.json({ admins: getSchoolAdmins(schoolId) });
    } catch (error) {
        sendConfigError(res, error, "Error changing a school's admins:");
    }
}

/** Every Rockbot account, without its secrets */
export function rockbotAccounts(_req: Request, res: Response) {
    res.json(listAccounts());
}

/** Body: { username, email?, refreshToken?, key?, password? }. Adds an account, or updates one, keeping secrets left empty */
export function saveRockbotAccount(req: Request, res: Response) {
    try {
        res.json(saveAccount(req.body ?? {}));
    } catch (error) {
        sendConfigError(res, error, "Error saving a Rockbot account:");
    }
}

/** Body: { username } */
export function deleteRockbotAccount(req: Request, res: Response) {
    try {
        deleteAccount(String(req.body?.username ?? ""));
        res.json({ ok: true });
    } catch (error) {
        sendConfigError(res, error, "Error removing a Rockbot account:");
    }
}
