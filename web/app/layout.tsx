import type { Metadata, Viewport } from "next";
import Navbar from "@/components/Navbar";
import NowPlayingBar from "@/components/NowPlayingBar";
import ServiceWorker from "@/components/ServiceWorker";
import TabBar from "@/components/TabBar";
import { currentSchool } from "@/lib/currentSchool";
import { LiveProvider } from "@/lib/live";
import { NavigationProvider } from "@/lib/navigation";
import { listOf } from "@/lib/format";
import { SchoolProvider } from "@/lib/school";
import { UserProvider } from "@/lib/user";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const school = await currentSchool();
    const venues = listOf(school.venues.map(venue => venue.name));

    return {
        title: { default: "Zotify", template: "%s · Zotify" },
        description: `Queue music at ${school.shortName}${venues ? `'s ${venues}` : ""}.`,
        applicationName: "Zotify",
        // Added to the home screen on iPhone, it opens full screen like an app. The icon is app/apple-icon.png
        appleWebApp: { capable: true, title: "Zotify", statusBarStyle: "black" }
    };
}

// viewportFit lets the tab bar reach the bottom edge of iPhones, padded clear of the home indicator
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#002244", viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    // Which school's Zotify this is, from the address (see proxy.ts)
    const school = await currentSchool();

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
                {/* Which school's Zotify this is, for every page */}
                <SchoolProvider school={school}>
                    <UserProvider>
                        {/* One live connection for the whole visit, so pages update without polling */}
                        <LiveProvider>
                            <NavigationProvider>
                                {/* One navbar for every page, kept mounted while moving between them */}
                                <Navbar />
                                {children}
                                {/* Everywhere but the homepage, which shows the queue itself */}
                                <NowPlayingBar />
                                {/* Phones only: navigation along the bottom */}
                                <TabBar />
                            </NavigationProvider>
                        </LiveProvider>
                    </UserProvider>
                </SchoolProvider>
                <ServiceWorker />
            </body>
        </html>
    );
}
