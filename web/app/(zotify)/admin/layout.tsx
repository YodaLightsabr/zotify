import type { Metadata } from "next";
import AdminShell from "./AdminShell";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · Zotify" } };

export default function Layout({ children }: { children: React.ReactNode }) {
    return <AdminShell>{children}</AdminShell>;
}
