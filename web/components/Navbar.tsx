"use client";

import { usePathname } from "next/navigation";
import { useNavigation } from "@/lib/navigation";
import { useUser } from "@/lib/user";
import AppBar, { AppBarLink } from "./AppBar";

/**
 * Zotify's bar across the top, rendered once by its layout so it stays mounted between pages: the shared AppBar with Zotify's
 * own tabs. On phones the tabs are the bottom TabBar instead
 */
export default function Navbar() {
    const { user } = useUser();
    const { resetHome } = useNavigation();
    const pathname = usePathname();

    const link = (href: string, label: string) =>
        <AppBarLink href={href} current={href === "/" ? pathname === "/" : pathname.startsWith(href)}>{label}</AppBarLink>;

    return (
        <AppBar app="zotify" hideNavOnPhones
            // On the homepage the logo clears the search instead of reloading
            onBrandClick={event => { if (resetHome()) event.preventDefault(); }}
            nav={<>
                {link("/", "Queue")}
                {user?.approved && link("/my-picks", "My picks")}
                {user && !user.approved && link("/beta", "Join")}
                {user?.admin && link("/admin", "Admin")}
            </>} />
    );
}
