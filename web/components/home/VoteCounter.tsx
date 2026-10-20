"use client";

import { useRef } from "react";
import { cx } from "@/lib/format";

const Chevrons = ({ up, double }: { up: boolean, double: boolean }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={up ? undefined : { transform: "rotate(180deg)" }}>
        {double ? <><path d="m6 13 6-6 6 6" /><path d="m6 19 6-6 6 6" /></> : <path d="m6 15 6-6 6 6" />}
    </svg>
);

interface Props {
    value: number;
    // Below zero is downvotes, above is upvotes
    min: number;
    max: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    label: string;
}

/**
 * Picks how many votes to add, like a Reddit vote counter: the number in the middle, one up or down with the single arrows, and all
 * the way with the double ones. Positive numbers are upvotes and negative ones downvotes. Arrow keys, Page Up/Down and Home/End work too
 */
export default function VoteCounter({ value, min, max, onChange, disabled = false, label }: Props) {
    // The latest value, so quick taps each build on the one before rather than on what was last drawn
    const latest = useRef(value);
    latest.current = value;

    const set = (next: number) => {
        latest.current = Math.max(min, Math.min(max, next));
        onChange(latest.current);
    };
    const step = (by: number) => set(latest.current + by);

    // to is where the double arrows jump; the single ones step by one from the latest value
    const arrow = (title: string, to: number | null, up: boolean) => (
        <button type="button" className={cx("vote-arrow", up ? "up" : "down")} title={title} aria-label={title}
            disabled={disabled || (up ? value >= max : value <= min)} onClick={() => to === null ? step(up ? 1 : -1) : set(to)}>
            <Chevrons up={up} double={to !== null} />
        </button>
    );

    function onKeyDown(event: React.KeyboardEvent) {
        const next = { ArrowUp: latest.current + 1, ArrowDown: latest.current - 1, PageUp: max, PageDown: min, Home: max, End: min }[event.key];
        if (next === undefined || disabled) return;
        event.preventDefault();
        set(next);
    }

    return (
        // Double-clicking (or clicking the arrows quickly) would otherwise select the text beside the counter
        <div className="vote-counter" onMouseDown={event => { if (event.detail > 1) event.preventDefault(); }}>
            {arrow(`All ${max} upvotes`, max, true)}
            {arrow(value < 0 ? "One fewer downvote" : "One more upvote", null, true)}
            <div className={cx("vote-value", value > 0 && "positive", value < 0 && "negative")}
                role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={label}
                aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} aria-disabled={disabled}
                aria-valuetext={value > 0 ? `${value} upvotes` : value < 0 ? `${-value} downvotes` : "No votes"}
                onKeyDown={onKeyDown}>
                {value > 0 ? `+${value}` : value}
            </div>
            {arrow(value > 0 ? "One fewer upvote" : "One more downvote", null, false)}
            {arrow(min < 0 ? `All ${-min} downvotes` : "No upvotes", min, false)}
        </div>
    );
}
