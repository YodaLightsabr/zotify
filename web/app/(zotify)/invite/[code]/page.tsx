"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import CardPage from "@/components/CardPage";
import { Spinner } from "@/components/Spinner";
import { postJson } from "@/lib/api";
import { useUser } from "@/lib/user";

/** An invite link. Signed-out people sign in first and come back here, then the code lets them in */
export default function InvitePage() {
    const router = useRouter();
    const code = useParams<{ code: string }>().code.toUpperCase();
    const { user, refresh } = useUser();
    const sent = useRef(false);

    useEffect(() => {
        if (user === undefined || sent.current) return;
        if (user === null) return router.replace(`/login?${new URLSearchParams({ next: `/invite/${code}` })}`);

        sent.current = true;

        (async () => {
            try {
                const { response, data } = await postJson("/api/beta/redeem", { code });
                if (!response.ok) throw new Error(data?.error ?? "That invite link didn't work. Please try again.");

                await refresh();
                router.replace("/?welcome=1");
            } catch (error) {
                router.replace(`/beta?${new URLSearchParams({ error: (error as Error).message })}`);
            }
        })();
    }, [user, code, refresh, router]);

    return (
        <CardPage>
            <h1>Letting you in</h1>
            <p className="subtitle"><Spinner small /></p>
        </CardPage>
    );
}
