"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { goToLogin } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import { adminGet, useEvery20s, useLoad } from "./shared";
import "./admin.css";

// The admin dashboard's frame: a sidebar with this school's pages, then (for site admins) the ones that cover every school.
// It lets in only admins, and only site admins onto the site-wide pages

const SCHOOL_PAGES = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/beta", label: "Beta" },
    { href: "/admin/history", label: "History" }
];

const SITE_PAGES = [
    { href: "/admin/schools", label: "Schools" },
    { href: "/admin/rockbot-accounts", label: "Rockbot accounts" },
    { href: "/admin/developers", label: "Developers" },
    { href: "/admin/test-accounts", label: "Test accounts" },
    { href: "/admin/data", label: "Raw data" }
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const school = useSchool();
    const router = useRouter();
    const pathname = usePathname();

    const sitePage = SITE_PAGES.some(page => page.href === pathname);
    const current = [...SCHOOL_PAGES, ...SITE_PAGES].find(page => page.href === pathname);

    useEffect(() => {
        if (user === null) goToLogin(pathname);
        else if (user && !user.admin) router.replace("/");
        else if (user && sitePage && !user.siteAdmin) router.replace("/admin");
    }, [user, router, pathname, sitePage]);

    const allowed = user?.admin && (!sitePage || user.siteAdmin);

    return (
        <div className="page-admin">
            <div className="admin-layout">
                <nav className="admin-nav" aria-label="Admin">
                    <h2 className="admin-nav-title">{school.shortName}</h2>
                    <ul>
                        {SCHOOL_PAGES.map(page => (
                            <NavLink key={page.href} href={page.href} label={page.label} current={pathname === page.href}
                                badge={page.href === "/admin/beta" && user?.admin ? <PendingRequests /> : null} />
                        ))}
                    </ul>
                    {user?.siteAdmin && <>
                        <h2 className="admin-nav-title">All schools</h2>
                        <ul>
                            {SITE_PAGES.map(page => <NavLink key={page.href} href={page.href} label={page.label} current={pathname === page.href} />)}
                        </ul>
                    </>}
                </nav>
                {/* Each page's panels have their own headings, and the sidebar shows which page this is */}
                <main aria-label={current?.label ?? "Admin"}>{allowed && children}</main>
            </div>
        </div>
    );
}

function NavLink({ href, label, current, badge }: { href: string, label: string, current: boolean, badge?: React.ReactNode }) {
    return (
        <li>
            <Link className={cx("admin-nav-link", current && "current")} href={href} aria-current={current ? "page" : undefined}>
                {label}{badge}
            </Link>
        </li>
    );
}

/** How many people are waiting to be let in, beside Beta */
function PendingRequests() {
    const school = useSchool();
    const { data, reload } = useLoad(useCallback(
        () => adminGet<{ requests: { status: string }[] }>(`/v1/schools/${school.id}/beta`, "the beta"), [school.id]));
    useEvery20s(reload);

    const pending = data?.requests.filter(request => request.status === "pending").length ?? 0;
    return pending ? <span className="admin-nav-badge" title={`${pending} waiting`}>{pending}</span> : null;
}
