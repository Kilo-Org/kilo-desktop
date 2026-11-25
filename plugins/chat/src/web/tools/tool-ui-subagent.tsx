import { useEffect, useRef } from "react";
import { getOpenCodeTaskSessionId } from "@kilo-desktop/react-opencode";
import { SquareIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useOpenCodeExtrasSlice } from "../runtime/use-optional-opencode-runtime-extras";
import {
	useDelegationRevealNonce,
	useDelegationRevealStore,
} from "../subagents/delegation-reveal-store";
import { useSubagentActivity } from "../subagents/SubagentActivityContext";
import {
	delegationStatus,
	isActiveSubagentStatus,
	subagentTypeLabel,
	type SubagentDisplayStatus,
} from "../subagents/subagent-state";
import { useOpenSubagentPane } from "../subagents/use-open-subagent-pane";
import { useIsDelegationRowHidden } from "./delegation-group";
import { useOpenCodeTool } from "./opencode-tool";
import { ToolActivityRow } from "./tool-ui-activity-row";
import { str, truncate, type ToolCallStatusLike } from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const subagentTitleFromArgs = (args: unknown): string | undefined => {
	const description = str(asRecord(args)?.description).replace(/\s+/g, " ").trim();
	return description ? truncate(description, 72) : undefined;
};

// Enclosing folds animate open over ~200ms; scroll again once they settle.
const REVEAL_SETTLE_MS = 250;

/** Scrolls the row into view when a reveal request targets it. */
const useRevealRow = (toolCallId: string, hidden: boolean) => {
	const ref = useRef<HTMLDivElement>(null);
	const nonce = useDelegationRevealNonce([toolCallId]);
	const settle = useDelegationRevealStore((state) => state.settle);
	useEffect(() => {
		if (nonce === null || hidden) return;
		const scroll = () => ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
		const frame = requestAnimationFrame(scroll);
		const settleTimer = setTimeout(() => {
			scroll();
			settle(nonce);
		}, REVEAL_SETTLE_MS);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(settleTimer);
		};
	}, [hidden, nonce, settle]);
	return ref;
};

const ROW_STATUS: Record<SubagentDisplayStatus, NonNullable<ToolCallStatusLike>> = {
	working: { type: "running" },
	waiting: { type: "running" },
	done: { type: "complete" },
	failed: { type: "incomplete", reason: "error" },
	cancelled: { type: "incomplete", reason: "cancelled" },
};

/** A `subagent` call as a one-line delegation row inside its {@link DelegationGroup}. */
export const SubagentActivity: ToolCallComponent = ({ args, status, toolCallId }) => {
	const hidden = useIsDelegationRowHidden(toolCallId);
	const tool = useOpenCodeTool(toolCallId);
	const { activityByToolCallId, stoppingIds, stopSubagent } = useSubagentActivity();
	const activity = activityByToolCallId.get(toolCallId);
	const childSessionId =
		activity?.childSessionId ?? (tool ? getOpenCodeTaskSessionId(tool) : undefined);
	const childDirectory = useOpenCodeExtrasSlice((extras) =>
		childSessionId
			? extras.state?.childSessionsById?.[childSessionId]?.session?.location.directory
			: undefined,
	);
	const openPane = useOpenSubagentPane();
	const ref = useRevealRow(toolCallId, hidden);
	if (hidden) return null;

	const displayStatus = delegationStatus(activity?.status, status);
	const active = isActiveSubagentStatus(displayStatus);
	const title = activity?.title ?? subagentTitleFromArgs(args) ?? "Delegated task";
	const typeLabel = activity?.typeLabel ?? subagentTypeLabel(str(asRecord(args)?.agent).trim());
	const directory = activity?.directory ?? childDirectory;
	const stopping = childSessionId ? stoppingIds.has(childSessionId) : false;
	const canStop = active && childSessionId !== undefined;

	return (
		<div
			ref={ref}
			role="listitem"
			data-qa-id={`kilo-delegation-${toolCallId}`}
			data-status={displayStatus}
		>
			<ToolActivityRow
				liveVerb={typeLabel}
				doneVerb={typeLabel}
				object={title}
				status={ROW_STATUS[displayStatus]}
				onClick={childSessionId && openPane ? () => openPane(childSessionId, title) : undefined}
				ariaLabel={childSessionId && openPane ? `Open subagent: ${title}` : undefined}
				shimmerVerb={active}
				connector={canStop}
				trailing={
					<>
						{displayStatus === "waiting" ? (
							<span className="text-muted-foreground text-2xs shrink-0">Needs input</span>
						) : null}
						{canStop ? (
							<button
								type="button"
								className={cn(
									"text-muted-foreground hover:bg-muted hover:text-foreground grid size-5 shrink-0 place-items-center rounded-sm",
									stopping && "cursor-wait",
								)}
								disabled={stopping}
								onClick={() => void stopSubagent({ childSessionId, directory })}
								aria-label={`Stop subagent: ${title}`}
							>
								{stopping ? (
									<Spinner className="size-3" />
								) : (
									<SquareIcon className="size-2.5 fill-current" />
								)}
							</button>
						) : null}
					</>
				}
			/>
		</div>
	);
};
SubagentActivity.displayName = "SubagentActivity";
