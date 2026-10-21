const production = process.env.NODE_ENV === "production";

// Where the API lives. Development runs it on this machine; production is hardcoded. Next.js sets NODE_ENV for builds
export const API_URL = production ? "https://api.zotify.app" : "http://localhost:3001";

// The frontend's own server reaches the API directly, since both run on the same machine
export const INTERNAL_API_URL = "http://localhost:3001";

// Each school's Zotify is the main domain or a subdomain of it, like uf.zotify.app (uf.localhost:3000 in development)
export const SITE_DOMAIN = production ? "zotify.app" : "localhost:3000";
export const SITE_PROTOCOL = production ? "https" : "http";

// Zotify Meals' dashboard: meals.zotify.app, served from the pages under app/meals (see proxy.ts)
export const MEALS_HOST = `meals.${SITE_DOMAIN}`;
export const MEALS_URL = `${SITE_PROTOCOL}://${MEALS_HOST}`;
