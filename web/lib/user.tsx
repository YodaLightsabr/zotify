"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, postJson } from "./api";

export interface CurrentUser {
    email: string;
    // Runs this school's Zotify
    admin: boolean;
    // Runs every school's: schools, venues and Rockbot accounts
    siteAdmin?: boolean;
    approved: boolean;
    request: { status: "pending" | "approved" | "rejected", requestedAt: number } | null;
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
    const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

    const refresh = useCallback(async () => {
        try {
            const response = await apiFetch("/api/auth/me");
            const me = response.ok ? await response.json() as CurrentUser : null;
            setUser(me);
            return me;
        } catch {
            setUser(null);
            return null;
        }
    }, []);

    // Signing out always lands on the homepage. Elsewhere that's a fresh load, so pages for signed-in people
    // don't see the signed-out user first and send them to sign in again
    const signOut = useCallback(async () => {
        await postJson("/api/auth/logout", {}).catch(() => {});
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
