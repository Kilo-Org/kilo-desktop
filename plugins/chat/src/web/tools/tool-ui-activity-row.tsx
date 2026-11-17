import { useState, type ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	useActivitySubgroup,
	useKeepActivitySubgroupOpen,
	useManualDisclosure,
	type ActivitySubgroupContextValue,
} from "./activity-group";
import { ToolStatusIcon, isCancelledToolStatus, type ToolCallStatusLike } from "./tool-ui-shared";

export const useSoloInSubgroup = (kind: ActivitySubgroupContextValue["kind"]): boolean => {
	const subgroup = useActivitySubgroup();
	return subgroup?.kind === kind && subgroup.size === 1;
};

export const VerbObjectLabel = ({
	liveVerb,
	doneVerb,
	object,
	status,
	shimmerVerb = false,
}: {
	liveVerb: string;
	doneVerb: string;
	object?: string | undefined;
	status?: ToolCallStatusLike;
	shimmerVerb?: boolean;
}) => {
	const isRunning = status?.type === "running";
	const isCancelled = isCancelledToolStatus(status);
	const verb = isRunning ? liveVerb : doneVerb;

	return (
		<span
			className={cn(
				"flex items-center gap-1.5 truncate font-medium",
				isCancelled && "line-through opacity-50",
			)}
		>
			{shimmerVerb && isRunning ? (
				<span className="relative shrink-0">
					<span className="invisible">{verb}</span>
					<span className="shimmer shimmer-color-foreground absolute inset-0">{verb}</span>
				</span>
			) : (
				verb
			)}
			{object ? <span className="opacity-60">{object}</span> : null}
		</span>
	);
};

/** Label-only tool row. Solo in its subgroup → render nothing (header is enough). */
export const SoloAwareLabelRow = ({
	kind,
	liveVerb,
	doneVerb,
	object,
	status,
	trailing,
}: {
	kind: ActivitySubgroupContextValue["kind"];
	liveVerb: string;
	doneVerb: string;
	object?: string | undefined;
	status?: ToolCallStatusLike;
	trailing?: ReactNode;
}) => {
	const solo = useSoloInSubgroup(kind);
	if (solo) return null;

	return (
		<div className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm">
			<ToolStatusIcon status={status} />
			<VerbObjectLabel liveVerb={liveVerb} doneVerb={doneVerb} object={object} status={status} />
			{trailing}
		</div>
	);
};
SoloAwareLabelRow.displayName = "SoloAwareLabelRow";

/** Standard compact tool row with an optional primary action and trailing controls. */
export const ToolActivityRow = ({
	liveVerb,
	doneVerb,
	object,
	status,
	onClick,
	ariaLabel,
	trailing,
	shimmerVerb = false,
	connector = false,
}: {
	liveVerb: string;
	doneVerb: string;
	object?: string | undefined;
	status?: ToolCallStatusLike;
	onClick?: (() => void) | undefined;
	ariaLabel?: string | undefined;
	trailing?: ReactNode;
	shimmerVerb?: boolean;
	connector?: boolean;
}) => {
	const label = (
		<VerbObjectLabel
			liveVerb={liveVerb}
			doneVerb={doneVerb}
			object={object}
			status={status}
			shimmerVerb={shimmerVerb}
		/>
	);
	const content = (
		<>
			<ToolStatusIcon status={status} />
			{label}
			{connector ? (
				<span className="border-muted-foreground/20 mt-0.5 min-w-4 flex-1 self-center border-b-[0.5px]" />
			) : null}
		</>
	);
	return (
		<div className="text-muted-foreground flex min-w-0 items-center gap-2 py-0.5 text-sm">
			{onClick ? (
				<button
					type="button"
					className="hover:text-foreground flex min-w-0 flex-1 items-center gap-2 text-left transition-colors"
					onClick={onClick}
					aria-label={ariaLabel}
				>
					{content}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
			)}
			{trailing}
		</div>
	);
};
ToolActivityRow.displayName = "ToolActivityRow";

/**
 * Expandable tool row. Solo in its subgroup → detail only (no nested trigger).
 * Multi → verb/object trigger that expands detail.
 */
export const SoloAwareExpandableRow = ({
	kind,
	liveVerb,
	doneVerb,
	object,
	status,
	hasDetail,
	detail,
	completeIcon,
	trailing,
	disclosureId,
	forceRow = false,
	hideSoloWithoutDetail = false,
}: {
	kind: ActivitySubgroupContextValue["kind"];
	liveVerb: string;
	doneVerb: string;
	object?: string | undefined;
	status?: ToolCallStatusLike;
	hasDetail: boolean;
	detail: ReactNode;
	completeIcon?: ReactNode;
	trailing?: ReactNode;
	disclosureId: string;
	/** Render the trigger even when one tool expands into multiple logical rows. */
	forceRow?: boolean;
	/** Hide a redundant solo label when the subgroup header already describes it. */
	hideSoloWithoutDetail?: boolean;
}) => {
	const [persistedOpen, setPersistedOpen] = useManualDisclosure(`tool:${disclosureId}`);
	const keepActivitySubgroupOpen = useKeepActivitySubgroupOpen();
	const [localOpen, setLocalOpen] = useState(false);
	const open = persistedOpen ?? localOpen;
	const setOpen = (next: boolean) => {
		setLocalOpen(next);
		setPersistedOpen(next);
		if (next) {
			keepActivitySubgroupOpen?.();
		}
	};
	const solo = useSoloInSubgroup(kind) && !forceRow;

	const label = (
		<VerbObjectLabel liveVerb={liveVerb} doneVerb={doneVerb} object={object} status={status} />
	);

	if (solo) {
		if (!hasDetail) {
			if (hideSoloWithoutDetail) return null;
			return (
				<div className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm">
					<ToolStatusIcon status={status} completeIcon={completeIcon} />
					{label}
					{trailing}
				</div>
			);
		}
		return <div className={cn("py-0.5", status?.type === "running" && "opacity-90")}>{detail}</div>;
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger
				type="button"
				className="group text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-0.5 text-sm transition-colors"
			>
				<ToolStatusIcon
					status={status}
					completeIcon={completeIcon ?? <CheckIcon className="size-3 shrink-0" />}
				/>
				{label}
				{trailing}
				{hasDetail ? (
					<>
						<span className="border-muted-foreground/20 group-hover:border-muted-foreground/50 mt-0.5 min-w-4 flex-1 self-center border-b-[0.5px] transition-colors" />
						<ChevronRightIcon
							className={cn(
								"stroke-muted-foreground/60 group-hover:stroke-foreground/60 mt-0.5 size-3.75 shrink-0 transition-[transform,stroke] duration-100",
								open && "rotate-90",
							)}
						/>
					</>
				) : null}
			</CollapsibleTrigger>

			{hasDetail ? (
				<CollapsibleContent className="data-closed:animate-collapsible-up data-open:animate-collapsible-down overflow-hidden data-closed:duration-100 data-closed:ease-out data-open:duration-100 data-open:ease-in">
					<div className="mt-1 ml-5">{detail}</div>
				</CollapsibleContent>
			) : null}
		</Collapsible>
	);
};
SoloAwareExpandableRow.displayName = "SoloAwareExpandableRow";

export const hostnameFromUrl = (url: string): string => {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
};
