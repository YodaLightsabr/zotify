import { cx } from "@/lib/format";

export const Spinner = ({ small = false, label }: { small?: boolean, label?: string }) =>
    <span className={cx("spinner", small && "small")} role={label ? "img" : undefined} aria-label={label} />;

/** A button's label while it's working, e.g. "Queuing…" with a spinner */
export const Busy = ({ label }: { label: string }) => <><Spinner small />{label}</>;
