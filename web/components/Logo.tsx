import Link from "next/link";

export const Logo = ({ onClick }: { onClick?: (event: React.MouseEvent) => void }) =>
    <Link className="logo" href="/" onClick={onClick}><div className="logo-mark">♪</div> Zotify</Link>;
