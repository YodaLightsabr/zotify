"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import { useMember } from "@/lib/useMember";
import { useSchool } from "@/lib/school";
import { useVenue } from "@/lib/venue";
// The homepage's song rows, buttons and badges
import "@/app/(zotify)/home.css";
import "./library.css";

const TABS = [
    { href: "/library", label: "Songs" },
    { href: "/library/playlists", label: "Playlists" },
    { href: "/library/history", label: "History" }
];

/**
 * Around every Library page: its heading and tabs, and the venue that requests go to. Song rows borrow the homepage's styles,
 * so they look the same as search results
 */
export default function LibraryFrame({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const user = useMember(pathname);
    const school = useSchool();
    const [venue, setVenue] = useVenue();
    const onPlaylists = pathname.startsWith("/library/playlists");

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
                {/* Requests go to the venue picked here, the same one the homepage shows. Playlists pick their own, and one venue needs no choice */}
                {!onPlaylists && school.venues.length > 1 && (
                    <div className="venue-picker" role="radiogroup" aria-label="Venue to request at">
                        <span>Requests go to</span>
                        {school.venues.map(({ id, name }) => (
                            <button key={id} type="button" role="radio" aria-checked={venue === id}
                                className={cx("venue-option", venue === id && "current")} onClick={() => setVenue(id)}>{name}</button>
                        ))}
                    </div>
                )}
                {user && children}
            </main>
        </div>
    );
}
