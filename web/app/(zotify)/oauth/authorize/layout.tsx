import type { Metadata } from "next";

export const metadata: Metadata = { title: "Allow an app" };

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
