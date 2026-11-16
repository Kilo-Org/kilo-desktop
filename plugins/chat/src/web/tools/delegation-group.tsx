import {
	createContext,
	memo,
	useContext,
	useEffect,
	useMemo,
	useState,
	type CSSProperties,
	type FC,
	type PropsWithChildren,
} from "react";
import { useAuiState } from "@assistant-ui/react";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useDelegationRevealNonce } from "../subagents/delegation-reveal-store";
import { useSubagentActivity } from "../subagents/SubagentActivityContext";
import {
	delegationStatus,
	isActiveSubagentStatus,
	type SubagentDisplayStatus,
} from "../subagents/subagent-state";
import {
	ACTIVITY_CONTENT_ANIMATION,
	ActivityDisclosureIcon,
	ActivityIconStack,
	ActivityLabel,
	SUBGROUP_ANIMATION_DURATION,
	useActivityGroupSpacing,
	useDelayedActivityOpen,
	useManualDisclosure,
} from "./activity-group";
import { getKindMeta, getSegmentStats, isDelegationTool } from "./tool-categories";
export const MAX_UNEXPANDED_DELEGATION_ROWS = 5;

type DelegationRowState = { toolCallId: string; status: SubagentDisplayStatus };

const NO_HIDDEN_ROWS: ReadonlySet<string> = new Set();

/**
 * Rows beyond the cap, keeping every running, waiting, or failed row visible
 * and filling the rest in delegation order. Hiding a single row would trade it
 * for a "+1 more" line of the same height, so small overflows show everything.
 */
export function hiddenDelegationRows(
	rows: readonly DelegationRowState[],
	max = MAX_UNEXPANDED_DELEGATION_ROWS,
): ReadonlySet<string> {
	if (rows.length <= max + 1) return NO_HIDDEN_ROWS;
	const pinned = rows.filter(
		(row) => isActiveSubagentStatus(row.status) || row.status === "failed",
	);
	const visible = new Set(pinned.map((row) => row.toolCallId));
	for (const row of rows) {
		if (visible.size >= max) break;
		visible.add(row.toolCallId);
	}
	const hidden = new Set(
		rows.filter((row) => !visible.has(row.toolCallId)).map((row) => row.toolCallId),
	);
	return hidden.size > 1 ? hidden : NO_HIDDEN_ROWS;
}

const HiddenDelegationRowsContext = createContext<ReadonlySet<string>>(NO_HIDDEN_ROWS);

/** Whether the enclosing delegation group has folded this row into "+N more". */
export const useIsDelegationRowHidden = (toolCallId: string): boolean =>
	useContext(HiddenDelegationRowsContext).has(toolCallId);

/**
 * A run of subagent delegations, sealed off from activity groups but styled
 * as a subagent activity subgroup. It is open exactly while one of its
 * subagents is working or waiting, and settles closed once they all finish;
 * a manual toggle overrides both.
 */
const DelegationGroupImpl: FC<PropsWithChildren<{ group: { indices: readonly number[] } }>> = ({
	group,
	children,
}) => {
	const parts = useAuiState((s) => s.message.parts);
	const { activityByToolCallId } = useSubagentActivity();
	const { rows, indices } = useMemo(() => {
		const delegationRows: DelegationRowState[] = [];
		const delegationIndices: number[] = [];
		for (const index of group.indices) {
			const part = parts[index];
			if (part?.type !== "tool-call" || !isDelegationTool(part.toolName)) continue;
			delegationIndices.push(index);
			delegationRows.push({
				toolCallId: part.toolCallId,
				status: delegationStatus(activityByToolCallId.get(part.toolCallId)?.status, part.status),
			});
		}
		return { rows: delegationRows, indices: delegationIndices };
	}, [activityByToolCallId, group.indices, parts]);
	const stats = useMemo(
		() =>
			getSegmentStats(parts, { kind: "subagent", indices, running: false, requiresAction: false }),
		[parts, indices],
	);
	const active = rows.some((row) => isActiveSubagentStatus(row.status));
	const [toggled, setToggled] = useManualDisclosure(`delegation:${group.indices[0] ?? 0}`);
	const automaticOpen = useDelayedActivityOpen(active, toggled === undefined);
	const rowIds = useMemo(() => rows.map((row) => row.toolCallId), [rows]);
	const revealNonce = useDelegationRevealNonce(rowIds);
	const [showAll, setShowAll] = useState(false);
	useEffect(() => {
		if (revealNonce === null) return;
		setShowAll(true);
		// Latch open: a settled group would otherwise fold again once the request clears.
		if (toggled !== true) setToggled(true);
	}, [revealNonce, setToggled, toggled]);
	const open = revealNonce !== null || (toggled ?? automaticOpen);
	const spacing = useActivityGroupSpacing(group);
	const hiddenRows = useMemo(
		() => (showAll ? NO_HIDDEN_ROWS : hiddenDelegationRows(rows)),
		[rows, showAll],
	);

	const meta = getKindMeta("subagent");
	const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);
	return (
		<div data-slot="activity-group" className={spacing}>
			<Collapsible
				open={open}
				onOpenChange={setToggled}
				data-slot="delegation-group"
				style={{ "--animation-duration": `${SUBGROUP_ANIMATION_DURATION}ms` } as CSSProperties}
			>
				<CollapsibleTrigger
					className="text-muted-foreground hover:text-foreground flex max-w-full items-center gap-2 py-1 text-sm transition-colors"
					data-qa-id="kilo-delegation-group-toggle"
				>
					<ActivityIconStack
						items={[
							{
								icon: meta.icon,
								label: meta.label,
								className: meta.circleClassName,
								colored: active || open,
								loading: active,
							},
						]}
					/>
					<span className="min-w-0 truncate font-medium">
						<ActivityLabel label={label} shimmer={active} />
					</span>
					<ActivityDisclosureIcon open={open} />
				</CollapsibleTrigger>
				<CollapsibleContent
					className={cn(ACTIVITY_CONTENT_ANIMATION, "duration-(--animation-duration)")}
				>
					<div
						role="list"
						aria-label={label}
						className="border-border-subtle mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3"
					>
						<HiddenDelegationRowsContext.Provider value={hiddenRows}>
							{children}
						</HiddenDelegationRowsContext.Provider>
						{hiddenRows.size > 0 ? (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground self-start py-0.5 text-sm transition-colors"
								onClick={() => setShowAll(true)}
								data-qa-id="kilo-delegation-group-more"
							>
								+{hiddenRows.size} more
							</button>
						) : null}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
};

export const DelegationGroup = memo(DelegationGroupImpl);
DelegationGroup.displayName = "DelegationGroup";
