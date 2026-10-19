"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { goToLogin } from "@/lib/api";
import { shortEmail } from "@/lib/format";
import { useUser } from "@/lib/user";
import { Logo } from "./Logo";
import "./navbar.css";

/**
 * The bar across the top of the homepage, My picks and the admin dashboard: the logo, then who's signed in and where they can go.
 * onHome runs instead of following the logo link, so the homepage can reset itself without reloading
 */
export default function Navbar({ onHome }: { onHome?: () => void }) {
    const { user, signOut } = useUser();
    const pathname = usePathname();

    const link = (href: string, label: string) => pathname === href ? null : <Link className="account-link" href={href}>{label}</Link>;

    async function handleSignOut() {
        await signOut();
        onHome?.();
    }

    return (
        <header>
            <Logo onClick={onHome && (event => { event.preventDefault(); onHome(); })} />
            {/* Empty while loading, so the links don't flash "Sign in" for someone who's signed in */}
            <div className="account">
                {user === null && (
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
