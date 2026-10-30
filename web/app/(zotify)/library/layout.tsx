import type { Metadata } from "next";
import LibraryFrame from "@/components/library/LibraryFrame";

export const metadata: Metadata = { title: "Library" };

export default function Layout({ children }: { children: React.ReactNode }) {
    return <LibraryFrame>{children}</LibraryFrame>;
}
