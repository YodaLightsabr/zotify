import type { Request, Response } from "express";
import { API_URL, FRONTEND_URL } from "../config.js";
import {
    checkAppSecret, checkCodeVerifier, createAuthorizationCode, createGrant, getApp, hasAuthorized, matchesRedirectUri, parseScopes,
    redeemAuthorizationCode, refreshGrant, revokeToken, SCOPES, type OAuthApp, type Scope
} from "../developers.js";

// OAuth 2.0 for apps made by developers: the authorization code flow, with PKCE (RFC 7636) required for public apps like
// Raycast extensions, refresh tokens that change on every use, and revocation (RFC 7009).
//
//   1. The app sends people to www.zotify.app/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…&state=…
//      &code_challenge=…&code_challenge_method=S256. That page (web/app/(zotify)/oauth) checks the request with GET
//      /v1/oauth/authorize, asks them, and sends their answer to POST /v1/oauth/authorize, which says where to send them back
//   2. The app swaps the code for tokens at POST /v1/oauth/token, and later swaps refresh tokens for new ones there
//   3. Access tokens go in the Authorization header: Bearer zotify_at_…
//
// Errors on the token and revoke endpoints use OAuth's format, { error, error_description }, so OAuth libraries understand them

export const AUTHORIZE_URL = `${FRONTEND_URL}/oauth/authorize`;

type AuthorizeRequest =
    | { ok: true, app: OAuthApp, redirectUri: string, scopes: Scope[], state: string | undefined, codeChallenge: string | null }
    // Errors that can't safely go back to the app, because the app or its redirect URI isn't right: show them on the page
    | { ok: false, status: number, error: string, description: string, redirect?: undefined }
    // Errors to send back to the app at its redirect URI
    | { ok: false, status: number, error: string, description: string, redirect: string };

const param = (source: Record<string, unknown>, name: string) => typeof source[name] === "string" ? source[name] as string : undefined;

/** The app's redirect URI with these parameters added, keeping any it already has (like Raycast's ?packageName=) */
function redirectWith(uri: string, params: Record<string, string | undefined>) {
    const url = new URL(uri);
    for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value);
    return url.toString();
}

/** Checks an authorization request's parameters, from the query string (GET) or the body (POST) */
function readAuthorizeRequest(source: Record<string, unknown>): AuthorizeRequest {
    const app = getApp(param(source, "client_id"));
    if (!app) return { ok: false, status: 400, error: "invalid_client", description: "There's no app with that client_id." };

    // Apps with one redirect URI may leave it out
    const redirectUri = param(source, "redirect_uri") ?? (app.redirectUris.length === 1 ? app.redirectUris[0] : undefined);
    if (!redirectUri || !matchesRedirectUri(app, redirectUri)) {
        return { ok: false, status: 400, error: "invalid_request", description: `${app.name} didn't send a redirect_uri it registered.` };
    }

    const state = param(source, "state");
    const fail = (error: string, description: string): AuthorizeRequest =>
        ({ ok: false, status: 400, error, description, redirect: redirectWith(redirectUri, { error, error_description: description, state }) });

    if (param(source, "response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");

    const scopes = parseScopes(param(source, "scope") ?? "");
    if (!scopes?.length) return fail("invalid_scope", `Ask for one or more of these scopes: ${Object.keys(SCOPES).join(" ")}.`);

    const codeChallenge = param(source, "code_challenge") ?? null;
    const method = param(source, "code_challenge_method") ?? (codeChallenge ? "plain" : undefined);

    if (codeChallenge && (method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))) {
        return fail("invalid_request", "code_challenge must be an S256 challenge, with code_challenge_method=S256.");
    }
    if (!app.confidential && !codeChallenge) return fail("invalid_request", "Public apps must use PKCE: send code_challenge and code_challenge_method=S256.");

    return { ok: true, app, redirectUri, scopes, state, codeChallenge };
}

/**
 * For the sign-in page: whether an authorization request is valid, and what to show. alreadyAuthorized means they've allowed this
 * app these scopes before, so the page can go straight on. Bad requests get { error, error_description }, plus redirect when the
 * page should send them back to the app with the error
 */
export function describeAuthorization(req: Request, res: Response) {
    const request = readAuthorizeRequest(req.query);

    if (!request.ok) {
        res.status(request.status).json({ error: request.error, error_description: request.description, redirect: request.redirect ?? null });
        return;
    }

    const { app } = request;
    res.json({
        app: { clientId: app.clientId, name: app.name, description: app.description, homepageUrl: app.homepageUrl, developer: app.owner },
        scopes: request.scopes.map(scope => ({ scope, description: SCOPES[scope] })),
        redirectUri: request.redirectUri,
        alreadyAuthorized: hasAuthorized(res.locals.session.email, app.clientId, request.scopes)
    });
}

/** Body: the authorization request's parameters, and approve. Answers with where to send them: back to the app, with a code or an error */
export function decideAuthorization(req: Request, res: Response) {
    const request = readAuthorizeRequest(req.body ?? {});

    if (!request.ok) {
        res.status(request.status).json({ error: request.error, error_description: request.description, redirect: request.redirect ?? null });
        return;
    }

    if (req.body?.approve !== true) {
        res.json({ redirect: redirectWith(request.redirectUri, { error: "access_denied", error_description: "They didn't allow it.", state: request.state }) });
        return;
    }

    const code = createAuthorizationCode(request.app, res.locals.session.email, request.scopes, request.redirectUri, request.codeChallenge);
    res.json({ redirect: redirectWith(request.redirectUri, { code, state: request.state }) });
}

function oauthError(res: Response, status: number, error: string, description: string) {
    res.status(status).set("Cache-Control", "no-store").json({ error, error_description: description });
}

/**
 * The app making a token request: client_id with client_secret in a Basic Authorization header or in the body, or client_id
 * alone for public apps. Null if it isn't a real app or the secret is wrong
 */
function authenticateClient(req: Request): OAuthApp | null {
    let clientId = param(req.body ?? {}, "client_id");
    let clientSecret = param(req.body ?? {}, "client_secret");

    const basic = req.headers.authorization?.match(/^Basic\s+(\S+)$/i)?.[1];
    if (basic) {
        const [id, secret] = Buffer.from(basic, "base64").toString().split(":").map(part => decodeURIComponent(part));
        clientId = id;
        clientSecret = secret;
    }

    const app = getApp(clientId);
    if (!app) return null;
    if (app.confidential) return clientSecret && checkAppSecret(app.clientId, clientSecret) ? app : null;
    // Public apps have no secret, so sending one is a mistake worth catching
    return clientSecret ? null : app;
}

/** Swaps an authorization code or a refresh token for an access token and a new refresh token */
export function token(req: Request, res: Response) {
    const body = req.body ?? {};
    const app = authenticateClient(req);

    if (!app) {
        res.set("WWW-Authenticate", 'Basic realm="Zotify"');
        oauthError(res, 401, "invalid_client", "Unknown client_id, or the wrong client_secret. Public apps don't send a secret.");
        return;
    }

    res.set("Cache-Control", "no-store");

    if (body.grant_type === "authorization_code") {
        const code = param(body, "code");
        if (!code) return oauthError(res, 400, "invalid_request", "Missing code.");

        const grant = redeemAuthorizationCode(code, app.clientId, param(body, "redirect_uri"));
        if (!grant) return oauthError(res, 400, "invalid_grant", "That code isn't valid. It may have expired, been used already, or been for a different redirect_uri.");

        if (grant.codeChallenge && !checkCodeVerifier(grant.codeChallenge, body.code_verifier)) {
            return oauthError(res, 400, "invalid_grant", "The code_verifier doesn't match the code_challenge.");
        }

        res.json(createGrant(app.clientId, grant.email, grant.scopes));
        return;
    }

    if (body.grant_type === "refresh_token") {
        const refreshToken = param(body, "refresh_token");
        if (!refreshToken) return oauthError(res, 400, "invalid_request", "Missing refresh_token.");

        const requested = param(body, "scope") !== undefined ? parseScopes(body.scope) : null;
        if (requested !== null && !requested.length) return oauthError(res, 400, "invalid_scope", "Unknown scope.");

        const result = refreshGrant(app.clientId, refreshToken, requested);
        if (!result) return oauthError(res, 400, "invalid_grant", "That refresh token isn't valid. It may have expired, been used already, or been revoked.");
        if (result === "invalid_scope") return oauthError(res, 400, "invalid_scope", "A refresh can only ask for the scopes already allowed, or fewer.");

        res.json(result);
        return;
    }

    oauthError(res, 400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
}

/** Body: { token }. Revokes an access or refresh token, which signs that sign-in out. Always 200, even for unknown tokens */
export function revoke(req: Request, res: Response) {
    const value = param(req.body ?? {}, "token");
    if (!value) return oauthError(res, 400, "invalid_request", "Missing token.");

    const app = authenticateClient(req);
    revokeToken(value, app?.clientId);
    res.status(200).end();
}

/** OAuth authorization server metadata (RFC 8414), so OAuth libraries can find the endpoints themselves */
export function metadata(_req: Request, res: Response) {
    res.set("Cache-Control", "public, max-age=3600").json({
        issuer: API_URL,
        authorization_endpoint: AUTHORIZE_URL,
        token_endpoint: `${API_URL}/v1/oauth/token`,
        revocation_endpoint: `${API_URL}/v1/oauth/revoke`,
        scopes_supported: Object.keys(SCOPES),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
        service_documentation: "https://docs.zotify.app"
    });
}
