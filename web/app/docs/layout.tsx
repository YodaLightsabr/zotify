import type { Metadata, Viewport } from "next";
import DocsNav from "@/components/docs/DocsNav";
import { LogoMark } from "@/components/Logo";
import { MAIN_URL } from "@/lib/config";
import "./docs.css";

const description = "Build on Zotify: search for songs and request them at dining halls, vote, read Zotify Meals' menus, and sign people in with OAuth.";

export const metadata: Metadata = {
    // absolute, so the root layout's "· Zotify" isn't added
    title: { absolute: "Zotify API", template: "%s · Zotify API" },
    description,
    openGraph: { type: "website", siteName: "Zotify API", title: "Zotify API", description, url: "/" },
    twitter: { card: "summary_large_image", title: "Zotify API", description }
};

// Matches the light theme in docs.css
export const viewport: Viewport = { themeColor: "#f7f5f0" };

/** The API's docs (docs.zotify.app; see proxy.ts): guides, and a reference built from the API's OpenAPI description */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="docs">
            <header className="docs-header">
                <a className="logo docs-logo" href="/"><LogoMark /> Zotify <span>API</span></a>
                <a className="docs-header-link" href={`${MAIN_URL}/developers`}>Your tokens and apps ↗</a>
            </header>
            <div className="docs-body">
                <DocsNav />
                <main className="docs-main">{children}</main>
            </div>
        </div>
    );
}
