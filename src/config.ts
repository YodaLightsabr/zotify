// Where each half of Zotify lives. Development runs both on this machine; production addresses are hardcoded.
// The API (this Express server) always listens on 3001; the Next.js frontend in web/ listens on 3000
const production = process.env.NODE_ENV === "production";

export const API_PORT = 3001;
export const FRONTEND_URL = production ? "https://zotify.app" : "http://localhost:3000";
export const API_URL = production ? "https://api.zotify.app" : "http://localhost:3001";
