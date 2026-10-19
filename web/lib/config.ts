// Where the API lives. Development runs it on this machine; production is hardcoded. Next.js sets NODE_ENV for builds
export const API_URL = process.env.NODE_ENV === "production" ? "https://api.zotify.app" : "http://localhost:3001";
