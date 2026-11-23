import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type FC, type FocusEvent, type PointerEvent } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { cn } from "@kilo-desktop/ui/lib/utils";

export interface SavedToastProps {
	readonly message: string;
	/** Opens the Saved page; left out where it can't be shown (a pop-out window). */
	readonly onView?: () => void;
	readonly onUndo?: () => void;
	readonly onClose: () => void;
	/**
	 * Shows a close (X) button inside the toast, at its right: for a toast in
	 * the window's toast stack, which stays until it times out or is closed.
	 */
	readonly dismissible?: boolean;
	readonly className?: string;
	/** How long it stays; paused while the pointer moves over it or a key has focused it. */
	readonly durationMs?: number;
	readonly qaId?: string;
}

/**
 * The confirmation after saving or removing: a check, the message, View and
 * Undo (and a close button where it sits in the window's toast stack). Shown
 * at the bottom centre of the pane or the Focus reader, or as the Saved page's
 * toast; it closes five seconds after it appears, and after either action.
 * The countdown holds while someone is reaching for it: the pointer moving
 * over it, or keyboard focus on it. A toast that merely appears under a
 * resting pointer (Chromium reports that as the pointer entering) doesn't
 * hold, and on leaving the countdown resumes where it stopped rather than
 * starting over.
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
	dismissible = false,
	className,
	qaId = "saved-toast",
}) => {
	const [paused, setPaused] = useState(false);
	const latest = useLatestRef(onClose);
	const remaining = useRef(durationMs);
	useEffect(() => {
		if (paused) return;
		const started = performance.now();
		const timer = setTimeout(() => latest.current(), remaining.current);
		return () => {
			clearTimeout(timer);
			remaining.current = Math.max(0, remaining.current - (performance.now() - started));
		};
	}, [paused, latest]);
	const holdWhileMoving = (event: PointerEvent) => {
		if (event.movementX !== 0 || event.movementY !== 0) setPaused(true);
	};
	const holdForKeyboard = (event: FocusEvent) => {
		if (event.target instanceof Element && event.target.matches(":focus-visible")) setPaused(true);
	};
	const action =
		"text-foreground hover:bg-state-hover rounded-md px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
	return (
		<div
			role="status"
			data-qa-id={qaId}
			className={cn(
				"bg-popover text-popover-foreground border-border-subtle pointer-events-auto flex h-9 items-center gap-2 rounded-lg border pr-1 pl-3 text-xs shadow-lg",
				className,
			)}
			onPointerMove={holdWhileMoving}
			onPointerLeave={() => setPaused(false)}
			onFocus={holdForKeyboard}
			onBlur={() => setPaused(false)}
		>
			<CheckIcon aria-hidden="true" className="size-3.5" />
			<span>{message}</span>
			{/* No gap between the actions: their own padding spaces View and Undo as far
			    apart as the message is from View. */}
			<span className="flex items-center">
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
				{dismissible ? (
					<button
						type="button"
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-2"
						data-qa-id={`${qaId}-close`}
						onClick={onClose}
					>
						<XIcon aria-hidden="true" className="size-3.5" />
					</button>
				) : null}
			</span>
		</div>
	);
};
