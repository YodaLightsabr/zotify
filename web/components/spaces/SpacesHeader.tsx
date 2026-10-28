"use client";

import { usePathname } from "next/navigation";
import AppBar, { AppBarLink } from "@/components/AppBar";

/** Zotify Spaces' bar along the top: the shared AppBar, with its three views */
export default function SpacesHeader() {
    const pathname = usePathname().replace(/^\/spaces(?=\/|$)/, "") || "/";

    const link = (href: string, label: string) =>
        <AppBarLink href={href} current={href === "/" ? pathname === "/" : pathname.startsWith(href)}>{label}</AppBarLink>;

    return <AppBar app="spaces" nav={<>{link("/", "Free Now")}{link("/find", "Find a Time")}{link("/browse", "Browse")}</>} />;
}
