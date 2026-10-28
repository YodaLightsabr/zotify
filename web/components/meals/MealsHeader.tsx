"use client";

import { usePathname } from "next/navigation";
import AppBar, { AppBarLink } from "@/components/AppBar";

/** Zotify Meals' bar along the top: the shared AppBar, with menus and favorites */
export default function MealsHeader() {
    const pathname = usePathname();

    return (
        <AppBar app="meals" nav={<>
            <AppBarLink href="/" current={pathname === "/"}>Menus</AppBarLink>
            <AppBarLink href="/favorites" current={pathname === "/favorites"}>Favorites</AppBarLink>
        </>} />
    );
}
