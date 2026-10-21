// Where each half of Zotify lives. Development runs both on this machine; production addresses are hardcoded.
// The API (this Express server) listens on 3001 (API_PORT can move it, for testing); the Next.js frontend in web/ listens on 3000
const production = process.env.NODE_ENV === "production";

export const API_PORT = Number(process.env.API_PORT) || 3001;

// Each school's Zotify is a subdomain of the site's domain: www.zotify.app for the main school, uf.zotify.app for UF.
// zotify.app itself redirects to www (see web/proxy.ts). Development uses localhost the same way (uf.localhost:3000), which
// browsers send to this machine, with the main school at localhost:3000 itself
export const SITE_DOMAIN = production ? "zotify.app" : "localhost:3000";
export const MAIN_HOST = production ? `www.${SITE_DOMAIN}` : SITE_DOMAIN;
const SITE_PROTOCOL = production ? "https" : "http";

/** A school's frontend, from its subdomain; null is the main school's, at MAIN_HOST */
export const siteUrl = (subdomain: string | null) => `${SITE_PROTOCOL}://${subdomain ? `${subdomain}.${SITE_DOMAIN}` : MAIN_HOST}`;

// Zotify Meals' dashboard, at meals.zotify.app
export const MEALS_SUBDOMAIN = "meals";

// The API's docs, at docs.zotify.app
export const DOCS_SUBDOMAIN = "docs";
export const DOCS_URL = siteUrl(DOCS_SUBDOMAIN);

/** The main school's frontend */
export const FRONTEND_URL = siteUrl(null);
export const API_URL = production ? "https://api.zotify.app" : "http://localhost:3001";
