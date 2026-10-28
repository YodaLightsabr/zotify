"use client";

import AppBar from "@/components/AppBar";

/** Zotify Keys' bar along the top: the shared AppBar. Keys is one page, so it has no tabs */
export default function KeysHeader() {
    return <AppBar app="keys" />;
}
