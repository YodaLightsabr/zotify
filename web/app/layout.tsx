import type { Metadata, Viewport } from "next";
import { UserProvider } from "@/lib/user";
import "./globals.css";

export const metadata: Metadata = {
    title: { default: "Zotify", template: "%s · Zotify" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

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
                <UserProvider>{children}</UserProvider>
            </body>
        </html>
    );
}
