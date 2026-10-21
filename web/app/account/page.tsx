"use client";

import Link from "next/link";
import { useState } from "react";
import { Busy, Spinner } from "@/components/Spinner";
import { goToLogin } from "@/lib/api";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import "./account.css";

/** Who's signed in and where they stand, and where to sign out. The Account tab on phones; the ID in the navbar elsewhere */
export default function AccountPage() {
    const { user, signOut } = useUser();
    const school = useSchool();
    const [signingOut, setSigningOut] = useState(false);

    const status = !user ? null
        : user.admin ? "Admin"
        : user.approved ? "Member"
        : user.request?.status === "pending" ? "Waiting for an invitation"
        : "Not in the beta yet";

    return (
        <div className="page-account">
            <main>
                <h1>Account</h1>

                {user === undefined && <Spinner small />}

                {user === null && <>
                    <div className="panel">
                        <div className="field-value"><span className="muted">You&apos;re not signed in. Sign in with your {school.idLabel ?? "email address"} to search and queue songs.</span></div>
                    </div>
                    <div className="actions">
                        <button type="button" className="button primary" onClick={() => goToLogin("/account")}>Sign in</button>
                    </div>
                </>}

                {user && <>
                    <div className="panel">
                        <div>
                            <div className="field-label">Signed in as</div>
                            <div className="field-value">{user.email}</div>
                        </div>
                        <div>
                            <div className="field-label">Status</div>
                            <div className="field-value">{status}</div>
                        </div>
                    </div>
                    <div className="actions">
                        {user.approved && <Link className="button" href="/my-picks">My picks</Link>}
                        {!user.approved && <Link className="button primary" href="/beta">Join the beta</Link>}
                        <button type="button" className="button sign-out" disabled={signingOut} onClick={async () => {
                            setSigningOut(true);
                            // Lands on the homepage
                            await signOut();
                        }}>
                            {signingOut ? <Busy label="Signing out…" /> : "Sign out"}
                        </button>
                    </div>
                </>}
            </main>
        </div>
    );
}
