"use client";

import { Suspense } from "react";
import SignIn from "@/components/SignIn";

/** Signing in on the API docs, from the app bar, with the same account as Zotify */
export default function DocsLoginPage() {
    return (
        <Suspense>
            <SignIn destination={(_approved, next) => next} subtitle="Sign in with your Zotify account." />
        </Suspense>
    );
}
