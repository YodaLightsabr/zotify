import type { Metadata, Viewport } from "next";
import SpacesHeader from "@/components/spaces/SpacesHeader";
import "./spaces.css";

const description = "Study rooms free right now at UCI's libraries and housing, and when every room is free, live from the booking sites.";

export const metadata: Metadata = {
    // absolute, so the root layout's "· Zotify" isn't added
    title: { absolute: "Zotify Spaces", template: "%s · Zotify Spaces" },
    description,
    openGraph: { type: "website", siteName: "Zotify Spaces", title: "Zotify Spaces", description, url: "/" },
    twitter: { card: "summary_large_image", title: "Zotify Spaces", description }
};

// Matches the light theme in spaces.css
export const viewport: Viewport = { themeColor: "#f7f5f0" };

/** Zotify Spaces (spaces.zotify.app; see proxy.ts): study rooms and when they're free */
export default function SpacesLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="spaces">
            <SpacesHeader />
            {children}
        </div>
    );
}
