"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { goToLogin } from "@/lib/api";
import { shortEmail } from "@/lib/format";
import { useNavigation } from "@/lib/navigation";
import { useUser } from "@/lib/user";
import { Logo } from "./Logo";
import "./navbar.css";

/**
 * The bar across the top of every page, rendered once by the root layout: the logo, then who's signed in and where they can go.
 * It stays mounted between pages, so the account links never reload or flash
 */
export default function Navbar() {
    const { user, signOut } = useUser();
    const { resetHome } = useNavigation();
    const pathname = usePathname();

    // Links to the page you're already on are left out
    const link = (href: string, label: string) => pathname === href ? null : <Link className="account-link" href={href}>{label}</Link>;

    async function handleSignOut() {
        await signOut();
        resetHome();
    }

    return (
        <header>
            {/* On the homepage the logo clears the search instead of reloading */}
            <Logo onClick={event => { if (resetHome()) event.preventDefault(); }} />
            {/* Empty while loading, so the links don't flash "Sign in" for someone who's signed in */}
            <div className="account">
                {user === null && !pathname.startsWith("/login") && (
                    <a className="account-link" href="/login" onClick={event => { event.preventDefault(); goToLogin(); }}>Sign in</a>
                )}
                {user && <>
                    <span className="account-email" title={user.email}>{shortEmail(user.email)}</span>
                    {user.approved && link("/my-picks", "My picks")}
                    {user.admin && link("/admin", "Admin")}
                    {!user.approved && link("/beta", "Join")}
                    <button type="button" className="account-link" onClick={handleSignOut}>Sign out</button>
                </>}
            </div>
        </header>
    );
}
