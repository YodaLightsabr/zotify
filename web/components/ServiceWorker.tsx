"use client";

import { useEffect } from "react";

/** Registers public/sw.js in production builds, which shows a "back shortly" page instead of the browser's or Cloudflare's error */
export default function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("/sw.js").catch(error => console.error("Couldn't register the service worker:", error));
    }, []);

    return null;
}
