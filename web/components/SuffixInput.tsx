import { cx } from "@/lib/format";
import "./suffix-input.css";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
    // Shown after what's typed, like "@uci.edu" or ".zotify.app"; null hides it
    suffix: string | null;
    // Smaller, for forms on the admin dashboard
    compact?: boolean;
    ref?: React.Ref<HTMLInputElement>;
}

/**
 * A text field with fixed text after what's typed, like "panteater" + "@uci.edu" on sign-in, or "uf" + ".zotify.app"
 * for a school's address. The suffix isn't part of the value
 */
export default function SuffixInput({ suffix, compact = false, className, ...input }: Props) {
    return (
        <div className={cx("suffix-input", compact && "compact", className)}>
            <input type="text" {...input} />
            {suffix && <span className="suffix" aria-hidden="true">{suffix}</span>}
        </div>
    );
}
