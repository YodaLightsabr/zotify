"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { goToLogin } from "@/lib/api";
import { MAIN_URL } from "@/lib/config";
import { cx } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";

/** Zotify Meals' bar along the top: the logo, menus and favorites, and who's signed in (the same session as Zotify) */
export default function MealsHeader() {
    const { user, signOut } = useUser();
    const school = useSchool();
    const pathname = usePathname();

    const link = (href: string, label: string) =>
        <Link className={cx("meals-nav-link", pathname === href && "current")} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>;

    return (
        <header className="meals-header">
            <Link className="logo meals-logo" href="/"><LogoMark /> Zotify <span>Meals</span></Link>
            <nav className="meals-nav" aria-label="Zotify Meals">
                {link("/", "Menus")}
                {link("/favorites", "Favorites")}
                <a className="meals-nav-link subtle" href={MAIN_URL}>Zotify ↗</a>
                {user === null && (
                    <a className="meals-nav-link signin" href="/login" onClick={event => { event.preventDefault(); goToLogin(); }}>Sign in</a>
                )}
                {user && (
                    <button type="button" className="meals-nav-link" title={`Signed in as ${user.email}`} onClick={signOut}>
                        Sign out {school.shortEmail(user.email)}
                    </button>
                )}
            </nav>
        </header>
    );
}
