"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import { useNavigation } from "@/lib/navigation";
import { useUser } from "@/lib/user";
import "./tab-bar.css";

const icon = (paths: React.ReactNode) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths}
    </svg>
);

const ICONS = {
    home: icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>),
    picks: icon(<><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>),
    admin: icon(<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />),
    account: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></>)
};

/**
 * Navigation along the bottom of the screen on phones, where the navbar only has room for the logo. Hidden on wider screens
 * by tab-bar.css. Rendered once by the root layout
 */
export default function TabBar() {
    const { user } = useUser();
    const { resetHome } = useNavigation();
    const pathname = usePathname();

    const tabs = [
        { href: "/", label: "Home", icon: ICONS.home },
        { href: "/my-picks", label: "My picks", icon: ICONS.picks },
        ...(user?.admin ? [{ href: "/admin", label: "Admin", icon: ICONS.admin }] : []),
        { href: "/account", label: "Account", icon: ICONS.account }
    ];

    return (
        <nav className="tab-bar" aria-label="Main">
            {tabs.map(tab => {
                const current = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

                return (
                    <Link key={tab.href} href={tab.href} className={cx("tab", current && "current")} aria-current={current ? "page" : undefined}
                        // Home while already home clears the search, like the logo
                        onClick={event => { if (tab.href === "/" && resetHome()) event.preventDefault(); }}>
                        {tab.icon}
                        <span>{tab.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
