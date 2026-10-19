import type { Metadata, Viewport } from "next";
import Navbar from "@/components/Navbar";
import NowPlayingBar from "@/components/NowPlayingBar";
import ServiceWorker from "@/components/ServiceWorker";
import { LiveProvider } from "@/lib/live";
import { NavigationProvider } from "@/lib/navigation";
import { UserProvider } from "@/lib/user";
import "./globals.css";

export const metadata: Metadata = {
    title: { default: "Zotify", template: "%s · Zotify" },
    description: "Queue music at UCI's Anteatery and Brandywine.",
    applicationName: "Zotify",
    // Added to the home screen on iPhone, it opens full screen like an app. The icon is app/apple-icon.png
    appleWebApp: { capable: true, title: "Zotify", statusBarStyle: "black" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#002244" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                {/* eslint-disable-next-line @next/next/no-page-custom-font */}
                <link href="https://fonts.googleapis.com/css2?family=Jua&display=swap" rel="stylesheet" />
                <link href="https://cdn.jsdelivr.net/npm/@cds/city@1.1.0/css/bundles/default.min.css" rel="stylesheet" />
            </head>
            <body>
                <UserProvider>
                    {/* One live connection for the whole visit, so pages update without polling */}
                    <LiveProvider>
                        <NavigationProvider>
                            {/* One navbar for every page, kept mounted while moving between them */}
                            <Navbar />
                            {children}
                            {/* Everywhere but the homepage, which shows the queue itself */}
                            <NowPlayingBar />
                        </NavigationProvider>
                    </LiveProvider>
                </UserProvider>
                <ServiceWorker />
            </body>
        </html>
    );
}
