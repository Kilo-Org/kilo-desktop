import type { ReactNode } from "react";

import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

interface ProgressOverlayProps {
	readonly message: ReactNode;
	/** Lands on the status card, not the backdrop. */
	readonly "data-qa-id"?: string;
}

/**
 * A blurred backdrop with one status card over its parent, for work that
 * cannot be cancelled. The parent must be `relative`, and the caller marks
 * the covered content `inert` and `aria-busy` while it shows.
 */
export function ProgressOverlay({ message, "data-qa-id": qaId }: ProgressOverlayProps) {
	return (
		<div className="bg-background/60 animate-in fade-in-0 absolute inset-0 z-20 flex items-center justify-center p-6 backdrop-blur-[2px] duration-200 motion-reduce:animate-none">
			<Alert
				role="status"
				aria-live="polite"
				data-qa-id={qaId}
				className="zoom-in-95 animate-in fade-in-0 flex w-full max-w-xs items-center gap-2.5 px-4 py-3 shadow-lg duration-200 motion-reduce:animate-none"
			>
				<Spinner aria-hidden className="text-muted-foreground translate-y-0!" />
				<AlertTitle className="truncate">{message}</AlertTitle>
			</Alert>
		</div>
	);
}
