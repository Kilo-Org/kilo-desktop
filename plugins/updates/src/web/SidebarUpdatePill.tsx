import { useRef } from "react";
import { flushSync } from "react-dom";
import { RotateCwIcon } from "lucide-react";
import { toast } from "@kilo-desktop/ui/components/sonner";
import type { TooltipRoot } from "@base-ui/react/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { useUpdates } from "./useUpdates";

import { hasVisibleReleaseNotes, ReleaseNotesList } from "./ReleaseNotesList";
import { getInstallConfirmationMessage, updateReadyLabel } from "./updateActions";

function waitForPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

export function SidebarUpdatePill() {
	const updates = useUpdates();
	const state = updates?.state;
	const tooltipActionsRef = useRef<TooltipRoot.Actions | null>(null);
	if (!updates || !state || state.status !== "downloaded") return null;

	const label = updateReadyLabel(state);
	const install = async () => {
		flushSync(() => tooltipActionsRef.current?.close());
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
						className="bg-primary-soft text-primary-soft-foreground focus-visible:ring-ring/50 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--primary-soft),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:outline-none"
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
				className="border-border bg-popover text-popover-foreground pointer-events-auto flex max-h-[min(28rem,calc(100dvh-5rem))] w-96 max-w-[calc(100vw-2rem)] flex-col border p-4 text-left shadow-lg"
			>
				<div className="text-sm font-medium">{label}</div>
				{state.releaseNotes.some(hasVisibleReleaseNotes) ? (
					<div className="border-border scroll-fade-y mt-3 min-h-0 overflow-y-auto border-t pt-3">
						<ReleaseNotesList
							notes={state.releaseNotes}
							targetVersion={state.downloadedVersion ?? state.availableVersion}
						/>
					</div>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}
