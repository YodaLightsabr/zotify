"use client";

import { useSchool } from "@/lib/school";
import { adminGet, Loading, Rows, useEvery20s, useLoad, when } from "./shared";

// Test accounts: whether a login code is waiting in the server console

interface TestAccount { email: string, activeCode: { createdAt: number, expiresAt: number, attempts: number } | null }

const loadTestAccounts = () => adminGet<TestAccount[]>("/v1/admin/test-accounts", "test accounts");

function minutesFromNow(timestamp: number) {
    const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60000));
    return minutes < 1 ? "under a minute" : `${minutes} min`;
}

export default function TestAccounts() {
    const school = useSchool();
    const { data, error, reload } = useLoad(loadTestAccounts);
    useEvery20s(reload);

    return (
        <section className="panel" aria-labelledby="test-title">
            <div className="panel-header">
                <h2 id="test-title">Test accounts</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>
            <p className="muted test-note">Their login codes are printed in the server console instead of emailed.</p>
            {!data ? <Loading error={error} /> : <Rows>
                {data.map(({ email, activeCode }) => (
                    <div className="row" key={email}>
                        <span className="who">{school.shortEmail(email)}</span>
                        {activeCode
                            ? <span className="code-status active" title={`Requested ${when(activeCode.createdAt)}. Check the server console for the code.`}>
                                Active code · expires in {minutesFromNow(activeCode.expiresAt)}
                                {activeCode.attempts ? ` · ${activeCode.attempts} ${activeCode.attempts === 1 ? "wrong try" : "wrong tries"}` : ""}
                            </span>
                            : <span className="code-status muted">No active code</span>}
                    </div>
                ))}
            </Rows>}
        </section>
    );
}
