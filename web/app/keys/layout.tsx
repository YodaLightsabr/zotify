import type { Metadata } from "next";
import KeysHeader from "@/components/keys/KeysHeader";
import "./keys.css";

const description = "A virtual YubiKey for Duo: the Zotify Keys Chrome extension fills in Duo's passcode for you.";

export const metadata: Metadata = {
    // absolute, so the root layout's "· Zotify" isn't added
    title: { absolute: "Zotify Keys", template: "%s · Zotify Keys" },
    description,
    openGraph: { type: "website", siteName: "Zotify Keys", title: "Zotify Keys", description, url: "/" },
    twitter: { card: "summary_large_image", title: "Zotify Keys", description },
    robots: { index: false }
};

/** Zotify Keys (keys.zotify.app; see proxy.ts): a virtual YubiKey, and API keys for its Chrome extension */
export default function KeysLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="keys">
            <KeysHeader />
            {children}
        </div>
    );
}
