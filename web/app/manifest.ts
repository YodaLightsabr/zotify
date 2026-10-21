import type { MetadataRoute } from "next";

/** Makes Zotify installable: its name, icons and colours when added to a home screen or dock */
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: "/",
        name: "Zotify",
        short_name: "Zotify",
        description: "Queue music at your dining hall.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#002244",
        theme_color: "#002244",
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            // The mark sits well inside the safe zone, so the same art works when it's cropped to a circle or squircle
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
    };
}
