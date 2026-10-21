import Link from "next/link";

/** The app icon (app/icon.svg, also the favicon), at navbar size unless className sizes it otherwise */
export const LogoMark = ({ className = "logo-mark" }: { className?: string }) => (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="128" fill="#FECC08" />
        <path fill="#002244" fillRule="evenodd" clipRule="evenodd" d="M240 368C240 376.832 247.168 384 256 384C264.832 384 272 376.832 272 368V144C272 135.168 264.832 128 256 128C247.168 128 240 135.168 240 144V368ZM192 352C183.168 352 176 344.832 176 336V176C176 167.168 183.168 160 192 160C200.832 160 208 167.168 208 176V336C208 344.832 200.832 352 192 352ZM320 320C311.168 320 304 312.832 304 304V208C304 199.168 311.168 192 320 192C328.832 192 336 199.168 336 208V304C336 312.832 328.832 320 320 320ZM128 304C119.168 304 112 296.832 112 288V224C112 215.168 119.168 208 128 208C136.832 208 144 215.168 144 224V288C144 296.832 136.832 304 128 304ZM368 272C368 280.832 375.168 288 384 288C392.832 288 400 280.832 400 272V240C400 231.168 392.832 224 384 224C375.168 224 368 231.168 368 240V272Z" />
    </svg>
);

export const Logo = ({ onClick }: { onClick?: (event: React.MouseEvent) => void }) =>
    <Link className="logo" href="/" onClick={onClick}><LogoMark /> Zotify</Link>;
