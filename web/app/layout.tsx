import type { Metadata, Viewport } from "next";
import ServiceWorker from "@/components/ServiceWorker";
import { currentSchool } from "@/lib/currentSchool";
import { listOf } from "@/lib/format";
import { SchoolProvider } from "@/lib/school";
import { UserProvider } from "@/lib/user";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const school = await currentSchool();
    const venues = listOf(school.venues.map(venue => venue.name));

    const description = `Queue music at ${school.shortName}${venues ? `'s ${venues}` : ""}.`;
    // Link previews: each school's site describes itself, with its own image (app/og/route.tsx)
    const title = school.subdomain ? `Zotify at ${school.shortName}` : "Zotify";
    const image = { url: "/og", width: 1200, height: 630, alt: `Zotify for ${school.name}` };

    return {
        // Makes the preview image's address absolute, on the school's own site
        metadataBase: new URL(school.url),
        title: { default: title, template: "%s · Zotify" },
        description,
        openGraph: { type: "website", siteName: "Zotify", title, description, url: "/", images: [image] },
        twitter: { card: "summary_large_image", title, description, images: [image] },
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
                {/* Which school's Zotify this is, and who's signed in, for every page. Zotify's pages add their navbar and
                    live updates in (zotify)/layout.tsx; Zotify Meals has its own in meals/layout.tsx */}
                <SchoolProvider school={school}>
                    <UserProvider>{children}</UserProvider>
                </SchoolProvider>
                <ServiceWorker />
            </body>
        </html>
    );
}
