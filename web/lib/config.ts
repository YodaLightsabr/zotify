const production = process.env.NODE_ENV === "production";

// Where the API lives. Development runs it on this machine; production is hardcoded. Next.js sets NODE_ENV for builds
export const API_URL = production ? "https://api.zotify.app" : "http://localhost:3001";

// The frontend's own server reaches the API directly, since both run on the same machine
export const INTERNAL_API_URL = "http://localhost:3001";

// Each school's Zotify is a subdomain of the site's domain, like uf.zotify.app (uf.localhost:3000 in development). The main
// school is at www.zotify.app (localhost:3000 in development), and zotify.app itself redirects there (see proxy.ts)
export const SITE_DOMAIN = production ? "zotify.app" : "localhost:3000";
export const SITE_PROTOCOL = production ? "https" : "http";
export const MAIN_HOST = production ? `www.${SITE_DOMAIN}` : SITE_DOMAIN;
export const MAIN_URL = `${SITE_PROTOCOL}://${MAIN_HOST}`;

// Zotify Meals' dashboard: meals.zotify.app, served from the pages under app/meals (see proxy.ts)
export const MEALS_HOST = `meals.${SITE_DOMAIN}`;
export const MEALS_URL = `${SITE_PROTOCOL}://${MEALS_HOST}`;

// Zotify Spaces' dashboard: spaces.zotify.app, served from the pages under app/spaces (see proxy.ts)
export const SPACES_HOST = `spaces.${SITE_DOMAIN}`;
export const SPACES_URL = `${SITE_PROTOCOL}://${SPACES_HOST}`;

// Zotify Keys, a virtual YubiKey for Duo: keys.zotify.app, served from the pages under app/keys (see proxy.ts)
export const KEYS_HOST = `keys.${SITE_DOMAIN}`;
export const KEYS_URL = `${SITE_PROTOCOL}://${KEYS_HOST}`;

// The API's docs: docs.zotify.app, served from the pages under app/docs (see proxy.ts)
export const DOCS_HOST = `docs.${SITE_DOMAIN}`;
export const DOCS_URL = `${SITE_PROTOCOL}://${DOCS_HOST}`;
