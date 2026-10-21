"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import CardPage from "@/components/CardPage";
import { Spinner } from "@/components/Spinner";
import { postJson } from "@/lib/api";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";

export default function MagicLinkPage() {
    return <Suspense><MagicLink /></Suspense>;
}

/** A magic sign-in link from an invite or approval email */
function MagicLink() {
    const router = useRouter();
    const token = useSearchParams().get("token") ?? "";
    const { refresh } = useUser();
    const school = useSchool();
    // Each link only works once, so make sure it's only sent once
    const sent = useRef(false);

    useEffect(() => {
        if (sent.current) return;
        sent.current = true;

        (async () => {
            try {
                const { response, data } = await postJson("/v1/auth/magic-link", { token });
                if (!response.ok) throw new Error(data?.error ?? `That sign-in link didn't work. Sign in with your ${school.idLabel ?? "email address"} instead.`);

                await refresh();
                router.replace("/?welcome=1");
            } catch (error) {
                router.replace(`/login?${new URLSearchParams({ error: (error as Error).message })}`);
            }
        })();
    }, [token, refresh, router, school.idLabel]);

    return (
        <CardPage>
            <h1>Signing you in</h1>
            <p className="subtitle"><Spinner small /></p>
        </CardPage>
    );
}
