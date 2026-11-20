import { useRef, type ReactNode, type RefObject } from "react";
// The tooltip must close synchronously before the blocking confirm() dialog opens.
// react-doctor-disable-next-line react-doctor/no-flush-sync
import { flushSync } from "react-dom";
import { CircleArrowUpIcon, RotateCwIcon } from "lucide-react";
import { toast } from "@kilo-desktop/ui/components/sonner";
import type { TooltipRoot } from "@base-ui/react/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import type { UpdaterState } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";

import { Navigation } from "../../contracts";
import { useOpenDownload } from "./useOpenDownload";
import { useUpdates, type Updates } from "./useUpdates";

import { hasVisibleReleaseNotes, ReleaseNotesList } from "./ReleaseNotesList";
import {
	getInstallConfirmationMessage,
	updateAvailableLabel,
	updateReadyLabel,
} from "./updateActions";

const ABOUT_SETTINGS_SECTION = "kilo.shell/about";

function waitForPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

/**
 * The sidebar's update notice: restart into a downloaded update or, where the
 * app can't install updates itself (Linux), say one is available and open About.
 */
export function SidebarUpdatePill() {
	const updates = useUpdates();
	const state = updates?.state;
	if (!updates || !state) return null;
	if (state.status === "downloaded") return <RestartToUpdatePill updates={updates} state={state} />;
	if (state.status === "available" && state.downloadUrl) {
		return <UpdateAvailablePill state={state} downloadUrl={state.downloadUrl} />;
	}
	return null;
}

function RestartToUpdatePill({ updates, state }: { updates: Updates; state: UpdaterState }) {
	const tooltipActionsRef = useRef<TooltipRoot.Actions | null>(null);
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
		<UpdateNoticePill
			tooltipActionsRef={tooltipActionsRef}
			state={state}
			label={label}
			action="Restart to update"
			icon={<RotateCwIcon className="size-3.5" />}
			qaId="update-ready-pill"
			targetVersion={state.downloadedVersion ?? state.availableVersion}
			onClick={() => void install()}
		/>
	);
}

/**
 * Points to About, which owns the download, rather than downloading from the
 * sidebar; where there is no settings page to open, opens the download itself.
 */
function UpdateAvailablePill({ state, downloadUrl }: { state: UpdaterState; downloadUrl: string }) {
	const tooltipActionsRef = useRef<TooltipRoot.Actions | null>(null);
	const navigation = useDomainObject(Navigation);
	const openDownload = useOpenDownload();
	return (
		<UpdateNoticePill
			tooltipActionsRef={tooltipActionsRef}
			state={state}
			label={updateAvailableLabel(state)}
			action="Update available"
			icon={<CircleArrowUpIcon className="size-3.5" />}
			qaId="update-available-pill"
			targetVersion={state.availableVersion}
			onClick={() => {
				tooltipActionsRef.current?.close();
				if (!navigation) {
					void openDownload(downloadUrl);
					return;
				}
				void navigation.methods
					.openSettings({ section: ABOUT_SETTINGS_SECTION })
					.catch(() => openDownload(downloadUrl));
			}}
		/>
	);
}

function UpdateNoticePill(props: {
	tooltipActionsRef: RefObject<TooltipRoot.Actions | null>;
	state: UpdaterState;
	label: string;
	action: string;
	icon: ReactNode;
	qaId: string;
	targetVersion: string | null;
	onClick: () => void;
}) {
	const { state, label } = props;
	return (
		<Tooltip actionsRef={props.tooltipActionsRef}>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={`${props.action}: ${label}`}
						data-qa-id={props.qaId}
						className="bg-primary-soft text-primary-soft-foreground focus-visible:ring-ring/50 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--primary-soft),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:outline-none"
						onClick={props.onClick}
					>
						{props.icon}
						<span>{props.action}</span>
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
						<ReleaseNotesList notes={state.releaseNotes} targetVersion={props.targetVersion} />
					</div>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}
