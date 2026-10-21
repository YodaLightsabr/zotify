"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { MAIN_URL, MEALS_URL } from "@/lib/config";
import { cx } from "@/lib/format";

/** Zotify Spaces' bar along the top. Nothing here needs signing in */
export default function SpacesHeader() {
    const pathname = usePathname().replace(/^\/spaces(?=\/|$)/, "") || "/";

    const link = (href: string, label: string) => {
        const current = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <Link className={cx("spaces-nav-link", current && "current")} href={href} aria-current={current ? "page" : undefined}>{label}</Link>;
    };

    return (
        <header className="spaces-header">
            <Link className="logo spaces-logo" href="/"><LogoMark /> Zotify <span>Spaces</span></Link>
            <nav className="spaces-nav" aria-label="Zotify Spaces">
                {link("/", "Free Now")}
                {link("/find", "Find a Time")}
                {link("/browse", "Browse")}
                <a className="spaces-nav-link subtle" href={MEALS_URL}>Meals ↗</a>
                <a className="spaces-nav-link subtle" href={MAIN_URL}>Zotify ↗</a>
            </nav>
        </header>
    );
}
