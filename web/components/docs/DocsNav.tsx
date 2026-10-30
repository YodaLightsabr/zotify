"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import { sectionId } from "@/lib/openapi";

// The docs' sidebar. On docs.zotify.app, paths have no /docs in front (see proxy.ts)

const GUIDES = [
    ["/", "Getting started"],
    ["/authentication", "Authentication"],
    ["/conventions", "Errors and limits"],
    ["/reference", "API reference"]
] as const;

// The reference's sections, matching the OpenAPI description's tags (src/openapi.ts)
const REFERENCE_SECTIONS = ["Basics", "You", "Music", "Votes", "Zotify's queue", "Playlists", "Library", "Zotify Meals", "Zotify Spaces", "Admin", "OAuth"];

export default function DocsNav() {
    // Rewritten pages still report the address people see
    const pathname = usePathname().replace(/^\/docs(?=\/|$)/, "") || "/";

    return (
        <nav className="docs-nav" aria-label="Docs">
            <ul>
                {GUIDES.map(([href, label]) => (
                    <li key={href}>
                        <Link className={cx(pathname === href && "current")} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
                        {href === "/reference" && (
                            <ul>
                                {REFERENCE_SECTIONS.map(tag => <li key={tag}><a href={`/reference#${sectionId(tag)}`}>{tag}</a></li>)}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </nav>
    );
}
