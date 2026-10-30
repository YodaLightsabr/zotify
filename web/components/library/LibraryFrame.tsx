"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

/**
 * Around every Library page: its heading and tabs. Requests go to the venue picked in the bar at the top. Buttons and badges
 * borrow the homepage's styles, so they look the same as in search results
 */
export default function LibraryFrame({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const user = useMember(pathname);

    return (
        <div className="page-home page-library">
            <main className="has-results">
                <h1>Library</h1>
                <nav className="library-tabs" aria-label="Library">
                    {TABS.map(tab => {
                        const current = pathname === tab.href;
                        return <Link key={tab.href} href={tab.href} className={cx("library-tab", current && "current")} aria-current={current ? "page" : undefined}>{tab.label}</Link>;
                    })}
                </nav>
                {user && children}
            </main>
        </div>
    );
}
