"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { cx } from "@/lib/format";
import { useMember } from "@/lib/useMember";
// The homepage's buttons and badges
import "@/app/(zotify)/home.css";
import "./library.css";

const TABS = [
    { href: "/library", label: "Songs" },
    { href: "/library/playlists", label: "Playlists" },
    { href: "/library/history", label: "History" }
];

export type LibraryView = "list" | "grid";

// Remembered in this browser. Storage can be missing or blocked, in which case it's a list until reload
const VIEW_KEY = "zotify:library-view";

const ViewContext = createContext<LibraryView>("list");

/** Whether the Library's songs and playlists show as a list (the default) or a grid of cards */
export const useLibraryView = () => useContext(ViewContext);

const icon = (paths: React.ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

const VIEWS: { id: LibraryView, label: string, icon: React.ReactNode }[] = [
    { id: "list", label: "List", icon: icon(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>) },
    { id: "grid", label: "Grid", icon: icon(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>) }
];

/**
 * Around every Library page: its heading, tabs, and the switch between a list and a grid (History is always a list). Requests go to the venue picked in the bar at the top. Buttons and badges
 * borrow the homepage's styles, so they look the same as in search results
 */
export default function LibraryFrame({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const user = useMember(pathname);
    const [view, setView] = useState<LibraryView>("list");

    // Read after the first render, which is prerendered without storage
    useEffect(() => {
        try {
            if (localStorage.getItem(VIEW_KEY) === "grid") setView("grid");
        } catch {}
    }, []);

    function pickView(next: LibraryView) {
        setView(next);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {}
    }

    return (
        <div className="page-home page-library">
            <main className="has-results">
                <h1>Library</h1>
                <div className="library-head">
                    <nav className="library-tabs" aria-label="Library">
                        {TABS.map(tab => {
                            const current = pathname === tab.href;
                            return <Link key={tab.href} href={tab.href} className={cx("library-tab", current && "current")} aria-current={current ? "page" : undefined}>{tab.label}</Link>;
                        })}
                    </nav>
                    {pathname !== "/library/history" && (
                        <div className="library-views" role="group" aria-label="View">
                            {VIEWS.map(option => (
                                <button key={option.id} type="button" className={cx("library-view", view === option.id && "current")} title={`${option.label} view`}
                                    aria-label={`${option.label} view`} aria-pressed={view === option.id} onClick={() => pickView(option.id)}>{option.icon}</button>
                            ))}
                        </div>
                    )}
                </div>
                <ViewContext.Provider value={view}>{user && children}</ViewContext.Provider>
            </main>
        </div>
    );
}
