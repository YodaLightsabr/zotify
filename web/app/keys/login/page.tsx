"use client";

import { Suspense } from "react";
import SignIn from "@/components/SignIn";

/** Signing in on Zotify Keys, with the same account as Zotify */
export default function KeysLoginPage() {
    return (
        <Suspense>
            <SignIn destination={(_approved, next) => next} subtitle="Sign in to set up your virtual YubiKey." />
        </Suspense>
    );
}
