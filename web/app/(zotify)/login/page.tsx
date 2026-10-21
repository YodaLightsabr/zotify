"use client";

import { Suspense } from "react";
import SignIn from "@/components/SignIn";

export default function LoginPage() {
    return (
        <Suspense>
            {/* Approved people go back where they came from. Everyone else sees the private beta screen,
                except on an invite link, which lets them in itself once they're signed in */}
            <SignIn destination={(approved, next) => approved || next.startsWith("/invite/") ? next : `/beta?${new URLSearchParams({ next })}`} />
        </Suspense>
    );
}
