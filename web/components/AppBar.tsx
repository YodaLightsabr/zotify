"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { goToLogin } from "@/lib/api";
import { DOCS_URL, KEYS_URL, MAIN_URL, MEALS_URL, SPACES_URL } from "@/lib/config";
import { cx } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { useUser, type CurrentUser } from "@/lib/user";
import { LogoMark } from "./Logo";
import "./app-bar.css";

// The bar across the top of every Zotify app, like Google's: the app's name and its own tabs on the left, and the app switcher
// and account menu always in the same place on the right, in every app and on phones. It sticks to the top of the page, and
// publishes its height as --app-bar-height so other sticky things can sit under it

export type AppId = "zotify" | "meals" | "spaces" | "keys" | "docs";

const glyph = (paths: React.ReactNode) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

const APPS: { id: AppId, name: string, description: string, url: string, color: string, icon: React.ReactNode }[] = [
    { id: "zotify", name: "Zotify", description: "Queue music", url: MAIN_URL, color: "#fecc08", icon: null },
    {
        id: "meals", name: "Meals", description: "Dining hall menus", url: MEALS_URL, color: "#2f8f5b",
        icon: glyph(<><path d="M7 3v8a2 2 0 0 0 2 2v8" /><path d="M11 3v6a2 2 0 0 1-2 2" /><path d="M7 3v6" /><path d="M17 21V3c-2 1-3 3.5-3 7v3h3" /></>)
    },
    {
        id: "spaces", name: "Spaces", description: "Free study rooms", url: SPACES_URL, color: "#255799",
        icon: glyph(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>)
    },
    {
        id: "keys", name: "Keys", description: "Duo, filled in", url: KEYS_URL, color: "#c2410c",
        icon: glyph(<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M14 9l2 2" /></>)
    },
    {
        id: "docs", name: "API", description: "Build on Zotify", url: DOCS_URL, color: "#6b4fbb",
        icon: glyph(<><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></>)
    }
];

/** An app's icon: Zotify's own mark, or a glyph on its color */
function AppIcon({ app }: { app: (typeof APPS)[number] }) {
    if (!app.icon) return <LogoMark className="app-icon" />;
    return <span className="app-icon" style={{ background: app.color }}>{app.icon}</span>;
}

interface Props {
    app: AppId;
    // The app's own tabs and menus, between its name and the account menu. On phones they get a row of their own
    nav?: React.ReactNode;
    // Phones only: leave the app's tabs out of the bar, for apps that have their own navigation there (Zotify's tab bar)
    hideNavOnPhones?: boolean;
    // Clicking the app's name; preventDefault to stay put
    onBrandClick?: (event: React.MouseEvent) => void;
}

export default function AppBar({ app, nav, hideNavOnPhones, onBrandClick }: Props) {
    const bar = useRef<HTMLElement>(null);
    const [open, setOpen] = useState<"apps" | "account" | null>(null);
    const current = APPS.find(entry => entry.id === app)!;

    // Other sticky things (Zotify Meals' controls, the docs' sidebar) sit under the bar, whatever its height
    useLayoutEffect(() => {
        const element = bar.current;
        if (!element) return;
        const publish = () => document.documentElement.style.setProperty("--app-bar-height", `${element.offsetHeight}px`);
        publish();
        const observer = new ResizeObserver(publish);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // Clicking elsewhere or pressing Escape closes whichever menu is open
    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === "Escape" : !bar.current?.querySelector(".app-bar-global")?.contains(event.target as Node)) setOpen(null);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    const toggle = (menu: "apps" | "account") => setOpen(open === menu ? null : menu);

    return (
        <header ref={bar} className={cx("app-bar", `app-${app}`, hideNavOnPhones && "hide-nav-on-phones")}>
            <Link className="logo app-bar-brand" href="/" onClick={onBrandClick}>
                <LogoMark /> Zotify{app !== "zotify" && <span>{current.name}</span>}
            </Link>
            <nav className="app-bar-nav" aria-label={current.id === "zotify" ? "Zotify" : `Zotify ${current.name}`}>{nav}</nav>
            <div className="app-bar-global">
                <AppSwitcher current={app} open={open === "apps"} onToggle={() => toggle("apps")} onClose={() => setOpen(null)} />
                <AccountMenu app={app} open={open === "account"} onToggle={() => toggle("account")} onClose={() => setOpen(null)} />
            </div>
        </header>
    );
}

/** A link in an app's tabs, marked when it's the current page */
export function AppBarLink({ href, current, children }: { href: string, current?: boolean, children: React.ReactNode }) {
    return <Link className={cx("app-bar-link", current && "current")} href={href} aria-current={current ? "page" : undefined}>{children}</Link>;
}

interface MenuProps {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
}

function AppSwitcher({ current, open, onToggle, onClose }: MenuProps & { current: AppId }) {
    const id = useId();

    return (
        <div className="app-bar-menu">
            <button type="button" className="app-bar-icon-button" aria-label="Zotify apps" title="Zotify apps" aria-expanded={open} aria-controls={id} onClick={onToggle}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    {[5, 12, 19].flatMap(y => [5, 12, 19].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" />))}
                </svg>
            </button>
            {open && (
                <div id={id} className="app-bar-popover apps" role="menu" aria-label="Zotify apps">
                    <div className="apps-grid">
                        {APPS.map(app => (
                            // The current app goes to its own home, on whichever site it is (like a school's own Zotify)
                            <a key={app.id} role="menuitem" className={cx("apps-tile", app.id === current && "current")}
                                href={app.id === current ? "/" : app.url} onClick={onClose}>
                                <AppIcon app={app} />
                                <strong>{app.name}</strong>
                                <span className="apps-tile-description">{app.description}</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Where someone stands at a school, in a few words */
function standing(entry: CurrentUser["schools"][number]) {
    if (entry.admin) return "Admin";
    if (entry.approved) return "Member";
    if (entry.request?.status === "pending") return "Waiting for an invitation";
    return null;
}

function AccountMenu({ app, open, onToggle, onClose }: MenuProps & { app: AppId }) {
    const { user, signOut } = useUser();
    const school = useSchool();
    const pathname = usePathname();
    const id = useId();
    // Zotify's own pages are relative on its own sites (a school's subdomain), and on the main site from anywhere else
    const zotify = app === "zotify" ? "" : MAIN_URL;

    // Nothing while loading, so "Sign in" doesn't flash for someone who's signed in
    if (user === undefined) return <span className="app-bar-avatar placeholder" aria-hidden="true" />;

    if (user === null) {
        // Not on the sign-in page itself
        if (pathname.endsWith("/login")) return null;
        return (
            <a className="app-bar-sign-in" href="/login" onClick={event => { event.preventDefault(); goToLogin(); }}>Sign in</a>
        );
    }

    const schools = user.schools.map(entry => ({ ...entry, standing: standing(entry) })).filter(entry => entry.standing);
    const admin = user.siteAdmin || user.schools.some(entry => entry.admin);

    return (
        <div className="app-bar-menu">
            <button type="button" className="app-bar-avatar" aria-label={`Account: ${user.email}`} title={user.email} aria-expanded={open} aria-controls={id} onClick={onToggle}>
                {user.email[0].toUpperCase()}
            </button>
            {open && (
                <div id={id} className="app-bar-popover account" role="dialog" aria-label="Account">
                    <div className="account-who">
                        <span className="app-bar-avatar big" aria-hidden="true">{user.email[0].toUpperCase()}</span>
                        <div>
                            <div className="account-email">{user.email}</div>
                            <div className="account-roles">
                                {user.siteAdmin && <span>Site admin</span>}
                                {user.developer && <span>Developer</span>}
                            </div>
                        </div>
                    </div>

                    {/* Only Zotify's music is invite-only; everything else is open to anyone signed in */}
                    <div className="account-section-label">Music beta</div>
                    <ul className="account-schools" aria-label="Music beta">
                        {schools.length ? schools.map(entry => (
                            <li key={entry.id}><span>{entry.name}</span><span className={cx("account-standing", entry.approved && "ok")}>{entry.standing}</span></li>
                        )) : (
                            <li><span>{school.name}</span><span className="account-standing">Not in the beta yet</span></li>
                        )}
                    </ul>

                    <div className="account-links" onClick={onClose}>
                        <a href={`${zotify}/account`}>Account and connected apps</a>
                        {user.approved && <a href={`${zotify}/library`}>Library</a>}
                        {!user.approved && !schools.length && <a href={`${zotify}/beta`}>Join the beta</a>}
                        {user.developer && <a href={`${zotify}/developers`}>Tokens and OAuth apps</a>}
                        {admin && <a href={`${zotify}/admin`}>Admin</a>}
                    </div>

                    <button type="button" className="account-sign-out" onClick={() => { onClose(); signOut(); }}>Sign out</button>
                </div>
            )}
        </div>
    );
}
