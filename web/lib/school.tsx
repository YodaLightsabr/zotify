"use client";

import { createContext, useContext, useMemo } from "react";
import type { Venue } from "./api";

/** The school whose Zotify this is, from the API (see src/schools.ts publicSchool) */
export interface SchoolInfo {
    id: string;
    name: string;
    shortName: string;
    // Null for the main school at the main domain
    subdomain: string | null;
    // A bare ID becomes id@emailDomain at sign-in; null means full emails only
    emailDomain: string | null;
    // What those IDs are called, e.g. "UCInetID"
    idLabel: string | null;
    idPlaceholder: string | null;
    tagline: string | null;
    footer: string | null;
    url: string;
    venues: { id: Venue, name: string }[];
}

export interface School extends SchoolInfo {
    venueName: (id: Venue) => string;
    // UCI accounts show just their UCInetID (and likewise at other schools); other addresses show in full
    shortEmail: (email: string) => string;
}

const SchoolContext = createContext<School | null>(null);

/** Shares the school with every page. The root layout gets it from the proxy (see proxy.ts), so it's there from the first render */
export function SchoolProvider({ school, children }: { school: SchoolInfo, children: React.ReactNode }) {
    const value = useMemo<School>(() => {
        const names = new Map(school.venues.map(venue => [venue.id, venue.name]));
        const suffix = school.emailDomain ? `@${school.emailDomain}`.toLowerCase() : null;

        return {
            ...school,
            venueName: id => names.get(id) ?? id,
            shortEmail: email => suffix && email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email
        };
    }, [school]);

    return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
    const school = useContext(SchoolContext);
    if (!school) throw new Error("useSchool must be used inside SchoolProvider");
    return school;
}
