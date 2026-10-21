"use client";

import { Suspense } from "react";
import SignIn from "@/components/SignIn";

/** Signing in on Zotify Meals, with the same account as Zotify. Anyone signed in can save favorites, beta or not */
export default function MealsLoginPage() {
    return (
        <Suspense>
            <SignIn destination={(_approved, next) => next} subtitle="Sign in to save your favorite dishes and see when they're on next." />
        </Suspense>
    );
}
