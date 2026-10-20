"use client";

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
    const set = (next: number) => onChange(Math.max(min, Math.min(max, next)));

    const arrow = (title: string, next: number, up: boolean, double: boolean) => (
        <button type="button" className={cx("vote-arrow", up ? "up" : "down")} title={title} aria-label={title}
            disabled={disabled || next === value || (up ? value >= max : value <= min)} onClick={() => set(next)}>
            <Chevrons up={up} double={double} />
        </button>
    );

    function onKeyDown(event: React.KeyboardEvent) {
        const next = { ArrowUp: value + 1, ArrowDown: value - 1, PageUp: max, PageDown: min, Home: max, End: min }[event.key];
        if (next === undefined || disabled) return;
        event.preventDefault();
        set(next);
    }

    return (
        <div className="vote-counter">
            {arrow(`All ${max} upvotes`, max, true, true)}
            {arrow(value < 0 ? "One fewer downvote" : "One more upvote", value + 1, true, false)}
            <div className={cx("vote-value", value > 0 && "positive", value < 0 && "negative")}
                role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={label}
                aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} aria-disabled={disabled}
                aria-valuetext={value > 0 ? `${value} upvotes` : value < 0 ? `${-value} downvotes` : "No votes"}
                onKeyDown={onKeyDown}>
                {value > 0 ? `+${value}` : value}
            </div>
            {arrow(value > 0 ? "One fewer upvote" : "One more downvote", value - 1, false, false)}
            {arrow(min < 0 ? `All ${-min} downvotes` : "No upvotes", min, false, true)}
        </div>
    );
}
