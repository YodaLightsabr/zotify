"use client";

import { useState } from "react";

/** A block of code with a copy button */
export default function Code({ children, label }: { children: string, label?: string }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="docs-code">
            {label && <div className="docs-code-label">{label}</div>}
            <button type="button" className="docs-copy" onClick={async () => {
                await navigator.clipboard.writeText(children.trim());
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}>{copied ? "Copied" : "Copy"}</button>
            <pre><code>{children.trim()}</code></pre>
        </div>
    );
}
