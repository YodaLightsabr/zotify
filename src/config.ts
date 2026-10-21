// Where each half of Zotify lives. Development runs both on this machine; production addresses are hardcoded.
// The API (this Express server) always listens on 3001; the Next.js frontend in web/ listens on 3000
const production = process.env.NODE_ENV === "production";

export const API_PORT = 3001;

// Each school's Zotify is the main domain or a subdomain of it: zotify.app for the main school, uf.zotify.app for UF.
// Development uses localhost the same way (uf.localhost:3000), which browsers send to this machine
export const SITE_DOMAIN = production ? "zotify.app" : "localhost:3000";
const SITE_PROTOCOL = production ? "https" : "http";

/** A school's frontend, from its subdomain; null is the main domain */
export const siteUrl = (subdomain: string | null) => `${SITE_PROTOCOL}://${subdomain ? `${subdomain}.` : ""}${SITE_DOMAIN}`;

// Zotify Meals' dashboard, at meals.zotify.app
export const MEALS_SUBDOMAIN = "meals";

/** The main school's frontend */
export const FRONTEND_URL = siteUrl(null);
export const API_URL = production ? "https://api.zotify.app" : "http://localhost:3001";
