/**
 * A link that leaves the app. It renders a real `<a href>` (never a `<button>`
 * with an onClick) so the native context menu offers Open Link in Default
 * Browser and Copy Link; activating it calls `onOpen` instead of navigating.
 * Style it as a button with `className={buttonVariants(...)}`.
 */
import type { ComponentProps, MouseEvent } from "react";

type ExternalLinkProps = Omit<ComponentProps<"a">, "href"> & {
	readonly href: string;
	readonly onOpen: (url: string) => void;
};

function ExternalLink({ href, onOpen, onClick, ...props }: ExternalLinkProps) {
	const open = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented) return;
		event.preventDefault();
		onOpen(href);
	};
	return <a {...props} href={href} onClick={open} />;
}

export { ExternalLink };
