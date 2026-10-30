"use client";

import { usePathname } from "next/navigation";
import { useNavigation } from "@/lib/navigation";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import { useVenue } from "@/lib/venue";
import AppBar, { AppBarLink } from "./AppBar";

/**
 * Zotify's bar across the top, rendered once by its layout so it stays mounted between pages: the shared AppBar with Zotify's
 * own tabs and the venue picker. On phones the tabs are the bottom TabBar instead
 */
export default function Navbar() {
    const { user } = useUser();
    const { resetHome } = useNavigation();
    const pathname = usePathname();

    const link = (href: string, label: string) =>
        <AppBarLink href={href} current={href === "/" ? pathname === "/" : pathname.startsWith(href)}>{label}</AppBarLink>;

    return (
        <AppBar app="zotify" hideNavOnPhones actions={<VenueSelect />}
            // On the homepage the logo clears the search instead of reloading
            onBrandClick={event => { if (resetHome()) event.preventDefault(); }}
            nav={<>
                {link("/", "Queue")}
                {user?.approved && link("/library", "Library")}
                {user && !user.approved && link("/beta", "Join")}
                {user?.admin && link("/admin", "Admin")}
            </>} />
    );
}

/** The venue every page shows and requests at, shared with the homepage's own buttons. Schools with one venue don't need it */
function VenueSelect() {
    const school = useSchool();
    const [venue, setVenue] = useVenue();
    if (school.venues.length < 2) return null;

    return (
        <label className="app-bar-venue" title="The venue you're queuing at">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" />
            </svg>
            <select aria-label="Venue" value={venue} onChange={event => setVenue(event.target.value)}>
                {school.venues.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
        </label>
    );
}
