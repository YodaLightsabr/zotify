import type { Metadata } from "next";

export const metadata: Metadata = { title: "Connecting Spotify" };

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
