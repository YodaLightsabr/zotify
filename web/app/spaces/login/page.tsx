"use client";

import { Suspense } from "react";
import SignIn from "@/components/SignIn";

/** Signing in on Zotify Spaces, from the app bar, with the same account as Zotify */
export default function SpacesLoginPage() {
    return (
        <Suspense>
            <SignIn destination={(_approved, next) => next} subtitle="Sign in with your Zotify account." />
        </Suspense>
    );
}
