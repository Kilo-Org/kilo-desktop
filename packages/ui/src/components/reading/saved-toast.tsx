import { CheckIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

export interface SavedToastProps {
	readonly message: string;
	/** Opens the Saved page; left out where it can't be shown (a pop-out window). */
	readonly onView?: () => void;
	readonly onUndo?: () => void;
	readonly onClose: () => void;
	/** How long it stays, paused while hovered or focused. */
	readonly durationMs?: number;
	readonly qaId?: string;
}

/**
 * The pane's confirmation after saving: a check, the message, View and Undo.
 * Shown at the bottom centre of the pane; it closes after five seconds,
 * waiting while the pointer or focus is on it, and after either action.
 */
// A new message is a new toast: keying on it restarts the countdown.
export const SavedToast: FC<SavedToastProps> = (props) => (
	<SavedToastBody key={props.message} {...props} />
);

const SavedToastBody: FC<SavedToastProps> = ({
	message,
	onView,
	onUndo,
	onClose,
	durationMs = 5_000,
	qaId = "saved-toast",
}) => {
	const [paused, setPaused] = useState(false);
	const latest = useLatestRef(onClose);
	useEffect(() => {
		if (paused) return;
		const timer = setTimeout(() => latest.current(), durationMs);
		return () => clearTimeout(timer);
	}, [durationMs, paused, latest]);
	const action =
		"text-foreground hover:bg-state-hover rounded-md px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
	return (
		<div
			role="status"
			data-qa-id={qaId}
			className="bg-popover text-popover-foreground border-border-subtle pointer-events-auto flex h-9 items-center gap-2 rounded-lg border pr-1 pl-3 text-xs shadow-lg"
			onPointerEnter={() => setPaused(true)}
			onPointerLeave={() => setPaused(false)}
			onFocus={() => setPaused(true)}
			onBlur={() => setPaused(false)}
		>
			<CheckIcon aria-hidden="true" className="size-3.5" />
			<span>{message}</span>
			{onView ? (
				<button
					type="button"
					className={action}
					data-qa-id={`${qaId}-view`}
					onClick={() => {
						onView();
						onClose();
					}}
				>
					View
				</button>
			) : null}
			{onUndo ? (
				<button
					type="button"
					className={action}
					data-qa-id={`${qaId}-undo`}
					onClick={() => {
						onUndo();
						onClose();
					}}
				>
					Undo
				</button>
			) : null}
		</div>
	);
};
