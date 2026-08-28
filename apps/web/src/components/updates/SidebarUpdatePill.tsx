import { useRef } from "react";
import { flushSync } from "react-dom";
import { RotateCwIcon } from "lucide-react";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { useDesktopUpdates } from "@/platform/updates/UpdateProvider";

import { ReleaseNotesList } from "./ReleaseNotesList";
import { getInstallConfirmationMessage, updateReadyLabel } from "./updateActions";

type TooltipActions = {
	close(): void;
	unmount(): void;
};

function waitForPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

export function SidebarUpdatePill() {
	const updates = useDesktopUpdates();
	const state = updates?.state;
	const tooltipActionsRef = useRef<TooltipActions | null>(null);
	if (!updates || !state || state.status !== "downloaded") return null;

	const label = updateReadyLabel(state);
	const install = async () => {
		flushSync(() => tooltipActionsRef.current?.unmount());
		await waitForPaint();
		if (!globalThis.confirm(getInstallConfirmationMessage(state, navigator.platform))) return;
		try {
			const result = await updates.install();
			if (!result.accepted || result.state.message) {
				toast.error("Could not install update", {
					description: result.state.message ?? "The update is no longer ready to install.",
				});
			}
		} catch (error) {
			toast.error("Could not install update", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<Tooltip actionsRef={tooltipActionsRef}>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={`Restart to update: ${label}`}
						data-qa-id="update-ready-pill"
						className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg bg-[var(--update-surface)] px-2.5 text-xs font-medium text-[var(--update)] transition-colors hover:bg-[var(--update-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--update)]/40 focus-visible:outline-none"
						onClick={() => void install()}
					>
						<RotateCwIcon className="size-3.5" />
						<span>Restart to update</span>
					</button>
				}
			/>
			<TooltipContent
				align="start"
				side="top"
				arrowClassName="hidden"
				className="border-border bg-popover text-popover-foreground pointer-events-auto block max-h-[min(28rem,calc(100vh-5rem))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto border p-4 text-left shadow-lg"
			>
				<div className="text-sm font-medium">{label}</div>
				{state.releaseNotes.some((release) => release.items.length > 0) ? (
					<div className="border-border mt-3 border-t pt-3">
						<ReleaseNotesList notes={state.releaseNotes} />
					</div>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}
