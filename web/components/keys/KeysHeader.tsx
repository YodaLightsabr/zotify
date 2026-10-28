"use client";

import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { goToLogin } from "@/lib/api";
import { MAIN_URL } from "@/lib/config";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";

/** Zotify Keys' bar along the top: the logo and who's signed in (the same session as Zotify) */
export default function KeysHeader() {
    const { user, signOut } = useUser();
    const school = useSchool();

    return (
        <header className="keys-header">
            <Link className="logo keys-logo" href="/"><LogoMark /> Zotify <span>Keys</span></Link>
            <nav className="keys-nav" aria-label="Zotify Keys">
                <a className="keys-nav-link subtle" href={MAIN_URL}>Zotify ↗</a>
                {user === null && (
                    <a className="keys-nav-link signin" href="/login" onClick={event => { event.preventDefault(); goToLogin("/"); }}>Sign in</a>
                )}
                {user && (
                    <button type="button" className="keys-nav-link" title={`Signed in as ${user.email}`} onClick={signOut}>
                        Sign out {school.shortEmail(user.email)}
                    </button>
                )}
            </nav>
        </header>
    );
}
