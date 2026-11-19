import { useEffect, useEffectEvent, useState, type ComponentProps, type MouseEvent } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import {
	useCopyToClipboard,
	type CopyToClipboardState,
	type WriteText,
} from "@kilo-desktop/ui/hooks/use-copy-to-clipboard";

interface CopyButtonProps extends Omit<
	ComponentProps<typeof Button>,
	"value" | "children" | "onClick" | "onError"
> {
	readonly value: string;
	/** The host clipboard writer, e.g. the kernel clipboard domain's `writeText`. */
	readonly writeText: WriteText;
	readonly label?: string;
	readonly copiedLabel?: string;
	readonly copiedDuration?: number;
	readonly onError?: (error: unknown) => void;
	readonly tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
}

/**
 * An icon button that copies `value` and confirms with a check mark and a
 * "Copied" tooltip. Relies on an ancestor `TooltipProvider` (the shell's).
 */
export function CopyButton({
	value,
	writeText,
	label = "Copy",
	copiedLabel = "Copied",
	copiedDuration = 2000,
	onError,
	tooltipSide = "bottom",
	size = "icon-sm",
	variant = "ghost",
	...props
}: CopyButtonProps) {
	const [state, copyToClipboard] = useCopyToClipboard(writeText);
	// The copy whose confirmation has timed out. Every copy is a new state, so
	// a repeat copy shows the confirmation again and restarts its timer;
	// unmounting (a virtualized row scrolled away) clears the timer.
	const [expired, setExpired] = useState<CopyToClipboardState | null>(null);
	const isCopied = state.value !== undefined && !state.error && expired !== state;
	const reportError = useEffectEvent((error: Error) => onError?.(error));
	const confirmFor = useEffectEvent(() => copiedDuration);
	useEffect(() => {
		if (state.value === undefined) return;
		if (state.error) {
			reportError(state.error);
			return;
		}
		const timer = setTimeout(() => setExpired(state), confirmFor());
		return () => clearTimeout(timer);
	}, [state]);
	const currentLabel = isCopied ? copiedLabel : label;
	const onClick = (event: MouseEvent) => {
		event.stopPropagation();
		copyToClipboard(value);
	};
	return (
		<Tooltip>
			<TooltipTrigger
				// The tooltip carries the confirmation, so a click must not close it.
				closeOnClick={false}
				render={
					<Button
						size={size}
						variant={variant}
						{...props}
						aria-label={currentLabel}
						onClick={onClick}
						onMouseDown={(event) => event.preventDefault()}
					/>
				}
			>
				{isCopied ? (
					<CheckIcon aria-hidden="true" className="animate-in fade-in zoom-in-50 duration-200" />
				) : (
					<CopyIcon aria-hidden="true" className="animate-in fade-in zoom-in-75 duration-150" />
				)}
			</TooltipTrigger>
			<TooltipContent side={tooltipSide}>{currentLabel}</TooltipContent>
		</Tooltip>
	);
}
