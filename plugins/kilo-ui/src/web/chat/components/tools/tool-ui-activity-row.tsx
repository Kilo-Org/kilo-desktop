import { memo, useState, type ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useActivitySubgroup, type ActivitySubgroupContextValue } from "./activity-group.js";
import {
	ToolStatusIcon,
	isCancelledToolStatus,
	type ToolCallStatusLike,
} from "./tool-ui-shared.js";

export const useSoloInSubgroup = (kind: ActivitySubgroupContextValue["kind"]): boolean => {
	const subgroup = useActivitySubgroup();
	return subgroup?.kind === kind && subgroup.size === 1;
};

export const VerbObjectLabel = ({
	liveVerb,
	doneVerb,
	object,
	status,
}: {
	liveVerb: string;
	doneVerb: string;
	object?: string | undefined;
	status?: ToolCallStatusLike;
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
			{verb}
			{object ? <span className="opacity-60">{object}</span> : null}
		</span>
	);
};

/** Label-only tool row. Solo in its subgroup → render nothing (header is enough). */
export const SoloAwareLabelRow = memo(
	({
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
	},
);
SoloAwareLabelRow.displayName = "SoloAwareLabelRow";

/**
 * Expandable tool row. Solo in its subgroup → detail only (no nested trigger).
 * Multi → verb/object trigger that expands detail.
 */
export const SoloAwareExpandableRow = memo(
	({
		kind,
		liveVerb,
		doneVerb,
		object,
		status,
		hasDetail,
		detail,
		completeIcon,
		trailing,
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
		/** Hide a redundant solo label when the subgroup header already describes it. */
		hideSoloWithoutDetail?: boolean;
	}) => {
		const [open, setOpen] = useState(false);
		const solo = useSoloInSubgroup(kind);

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
			return (
				<div className={cn("py-0.5", status?.type === "running" && "opacity-90")}>{detail}</div>
			);
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
	},
);
SoloAwareExpandableRow.displayName = "SoloAwareExpandableRow";

export const resultText = (result: unknown): string => {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if (typeof record.output === "string") return record.output;
		if (typeof record.stdout === "string") return record.stdout;
	}
	return "";
};

export const hostnameFromUrl = (url: string): string => {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
};
