"use client";

import { useRef, useState } from "react";
import { adminGet, Loading, useLoad } from "./shared";

// The cache, as a collapsible tree

const loadCache = async () => {
    const value = await adminGet<unknown>("/v1/admin/cache", "the cache");
    return { value, size: new Blob([JSON.stringify(value)]).size };
};

export default function Cache() {
    const { data, error, reload } = useLoad(loadCache);
    const tree = useRef<HTMLDivElement>(null);

    return (
        <section className="panel" aria-labelledby="cache-title">
            <div className="panel-header">
                <h2 id="cache-title">Raw data</h2>
                <div>
                    <span className="muted">{data && `${(data.size / 1024).toFixed(1)} KB  `}</span>
                    <button className="small" type="button" onClick={() => {
                        tree.current?.querySelectorAll<HTMLDetailsElement>("details details[open]").forEach(details => details.open = false);
                    }}>Collapse all</button>
                    <button className="small" type="button" onClick={reload}>Refresh</button>
                </div>
            </div>
            {/* Keyed by size so a refresh redraws the tree */}
            <div className="tree" ref={tree}>{!data ? <Loading error={error} /> : <Branch key={data.size} name="cache" value={data.value as object} open />}</div>
        </section>
    );
}

// Numbers that look like millisecond timestamps get a readable note
function TimestampNote({ value }: { value: unknown }) {
    if (typeof value !== "number" || value < 1.5e12 || value > 2.5e12) return null;

    const minutes = Math.round((value - Date.now()) / 60000);
    const abs = Math.abs(minutes);
    const span = abs < 60 ? `${abs} min` : abs < 2880 ? `${Math.round(abs / 60)} hr` : `${Math.round(abs / 1440)} days`;
    return <span className="note" title={new Date(value).toLocaleString()}>{minutes >= 0 ? `in ${span}` : `${span} ago`}</span>;
}

const Node = ({ name, value }: { name: string, value: unknown }) => value !== null && typeof value === "object"
    ? <Branch name={name} value={value} />
    : <div className="leaf"><span className="key">{name}</span>: <span className={value === null ? "null" : typeof value}>{JSON.stringify(value)}</span><TimestampNote value={value} /></div>;

// Branches are only drawn once opened, so even a large cache renders instantly
function Branch({ name, value, open = false }: { name: string, value: object, open?: boolean }) {
    const [drawn, setDrawn] = useState(open);
    const entries = Array.isArray(value) ? value.map((item, i) => [String(i), item] as const) : Object.entries(value);

    return (
        <details open={open} onToggle={event => { if (event.currentTarget.open) setDrawn(true); }}>
            <summary><span className="key">{name}</span> <span className="count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
            <div className="children">{drawn && entries.map(([key, child]) => <Node key={key} name={key} value={child} />)}</div>
        </details>
    );
}
