import type { Request, Response } from "express";
import { signInEmail } from "../auth.js";
import {
    addDeveloper, createApp, createToken, deleteApp, deleteToken, DeveloperError, listApps, listAuthorizations, listDevelopers,
    listTokens, removeDeveloper, resetAppSecret, revokeAuthorization, updateApp
} from "../developers.js";
import { mainSchool } from "../schools.js";

// Developers' tokens and apps, the apps people have signed in to, and (for site admins) who's a developer. Only Zotify's own
// pages can reach these (see sessionOnly and developer in auth.ts), so a token can never make more tokens

const sessionEmail = (res: Response): string => res.locals.session.email;

function sendError(res: Response, error: unknown, context: string) {
    if (error instanceof DeveloperError) {
        res.status(error.status).json({ error: error.message, code: error.status === 404 ? "not_found" : "invalid_request" });
        return;
    }

    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

// Personal access tokens

export function myTokens(_req: Request, res: Response) {
    res.json(listTokens(sessionEmail(res)));
}

/** Body: { name, scopes, expiresInDays }. Answers with the token, which is only ever shown this once */
export function createTokenRoute(req: Request, res: Response) {
    try {
        res.status(201).json(createToken(sessionEmail(res), req.body ?? {}));
    } catch (error) {
        sendError(res, error, "Error making a token:");
    }
}

export function deleteTokenRoute(req: Request, res: Response) {
    try {
        deleteToken(sessionEmail(res), Number(req.params.id));
        res.status(204).end();
    } catch (error) {
        sendError(res, error, "Error deleting a token:");
    }
}

// OAuth apps

export function myApps(_req: Request, res: Response) {
    res.json(listApps(sessionEmail(res)));
}

/** Body: { name, description?, homepageUrl?, redirectUris, confidential? }. Confidential apps' secret is only shown this once */
export function createAppRoute(req: Request, res: Response) {
    try {
        res.status(201).json(createApp(sessionEmail(res), req.body ?? {}));
    } catch (error) {
        sendError(res, error, "Error making an app:");
    }
}

/** Body: any of { name, description, homepageUrl, redirectUris } */
export function updateAppRoute(req: Request, res: Response) {
    try {
        res.json(updateApp(sessionEmail(res), String(req.params.clientId), req.body ?? {}));
    } catch (error) {
        sendError(res, error, "Error changing an app:");
    }
}

export function deleteAppRoute(req: Request, res: Response) {
    try {
        deleteApp(sessionEmail(res), String(req.params.clientId));
        res.status(204).end();
    } catch (error) {
        sendError(res, error, "Error deleting an app:");
    }
}

/** Replaces a confidential app's client secret. Answers with the new one, which is only shown this once */
export function resetSecretRoute(req: Request, res: Response) {
    try {
        res.json(resetAppSecret(sessionEmail(res), String(req.params.clientId)));
    } catch (error) {
        sendError(res, error, "Error replacing an app's secret:");
    }
}

// Apps people have signed in to

export function myAuthorizations(_req: Request, res: Response) {
    res.json(listAuthorizations(sessionEmail(res)));
}

/** Signs you out of an app, everywhere it's signed in */
export function revokeAuthorizationRoute(req: Request, res: Response) {
    revokeAuthorization(sessionEmail(res), String(req.params.clientId));
    res.status(204).end();
}

// Site admins: who's a developer

export function developers(_req: Request, res: Response) {
    res.json(listDevelopers());
}

/** PUT makes someone a developer and DELETE stops them being one, which deletes their tokens. A bare ID is the main school's */
export function developerRoute(req: Request, res: Response) {
    const email = signInEmail(req.params.email, mainSchool());

    if (!email) {
        res.status(400).json({ error: "Enter an email address.", code: "invalid_request" });
        return;
    }

    if (req.method === "DELETE") removeDeveloper(email);
    else addDeveloper(email, sessionEmail(res));

    res.json(listDevelopers());
}
