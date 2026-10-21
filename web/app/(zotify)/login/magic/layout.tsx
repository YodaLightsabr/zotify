import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Signing in · Zotify" } };

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
