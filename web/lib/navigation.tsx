"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";

interface Navigation {
    setHomeReset: (reset: (() => void) | null) => void;
    // Runs the homepage's reset. False when the homepage isn't showing
    resetHome: () => boolean;
}

const NavigationContext = createContext<Navigation | null>(null);

/** Lets the navbar, which lives in the layout, ask the homepage to reset itself when the logo is clicked */
export function NavigationProvider({ children }: { children: React.ReactNode }) {
    const reset = useRef<(() => void) | null>(null);

    const value = useMemo<Navigation>(() => ({
        setHomeReset: next => { reset.current = next; },
        resetHome: () => {
            if (!reset.current) return false;
            reset.current();
            return true;
        }
    }), []);

    return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
    const navigation = useContext(NavigationContext);
    if (!navigation) throw new Error("useNavigation must be used inside NavigationProvider");
    return navigation;
}

/** For the homepage: what the logo does instead of navigating, while the homepage is showing */
export function useHomeReset(reset: () => void) {
    const { setHomeReset } = useNavigation();
    const latest = useRef(reset);

    useLayoutEffect(() => { latest.current = reset; });

    useEffect(() => {
        setHomeReset(() => latest.current());
        return () => setHomeReset(null);
    }, [setHomeReset]);
}
