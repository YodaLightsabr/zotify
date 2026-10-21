"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, deleteJson } from "./api";
import { useSchool } from "./school";

export interface CurrentUser {
    email: string;
    // Runs this school's Zotify
    admin: boolean;
    // Runs every school's: schools, venues and Rockbot accounts
    siteAdmin?: boolean;
    // Can make API tokens and apps
    developer: boolean;
    approved: boolean;
    request: { status: "pending" | "approved" | "rejected", requestedAt: number } | null;
}

/** GET /v1/me, which says where someone stands at every school */
interface Me {
    email: string;
    siteAdmin: boolean;
    developer: boolean;
    schools: { id: string, admin: boolean, approved: boolean, request: CurrentUser["request"] }[];
}

interface UserState {
    // undefined while loading, null when signed out
    user: CurrentUser | null | undefined;
    refresh: () => Promise<CurrentUser | null>;
    signOut: () => Promise<void>;
}

const UserContext = createContext<UserState | null>(null);

/** Loads who's signed in once and shares it with the navbar and every page */
export function UserProvider({ children }: { children: React.ReactNode }) {
    const school = useSchool();
    const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

    const refresh = useCallback(async () => {
        try {
            const response = await apiFetch("/v1/me");
            const me = response.ok ? await response.json() as Me : null;
            // Only this school's standing matters here; a school missing from the list means no standing at all
            const here = me?.schools.find(entry => entry.id === school.id);
            const current: CurrentUser | null = me && {
                email: me.email,
                admin: here?.admin ?? false,
                siteAdmin: me.siteAdmin,
                developer: me.developer,
                approved: here?.approved ?? false,
                request: here?.request ?? null
            };
            setUser(current);
            return current;
        } catch {
            setUser(null);
            return null;
        }
    }, [school.id]);

    // Signing out always lands on the homepage. Elsewhere that's a fresh load, so pages for signed-in people
    // don't see the signed-out user first and send them to sign in again
    const signOut = useCallback(async () => {
        await deleteJson("/v1/auth/session").catch(() => {});
        if (location.pathname === "/") setUser(null);
        else location.assign("/");
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    return <UserContext.Provider value={{ user, refresh, signOut }}>{children}</UserContext.Provider>;
}

export function useUser() {
    const state = useContext(UserContext);
    if (!state) throw new Error("useUser must be used inside UserProvider");
    return state;
}
