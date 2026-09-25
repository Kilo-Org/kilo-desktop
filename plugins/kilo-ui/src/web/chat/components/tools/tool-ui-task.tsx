import { memo } from "react";
import { useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SquareIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { chatRightPanelCapability } from "../../right-panel/chat-right-panel-capability.js";
import { SUBAGENT_TAB_DEFINITION } from "../../right-panel/right-panel-tab-registry.js";
import { resolveRightPanelSessionKey } from "../../right-panel/right-panel-store.js";
import { useOptionalOpenCodeRuntimeExtras } from "../../runtime/use-optional-opencode-runtime-extras.js";
import { useSubagentActivity } from "../../subagents/SubagentActivityContext.js";
import {
	SUBAGENT_CHILD_SESSION_METADATA_KEY,
	childSessionIdForToolCall,
	subagentPaneInstanceId,
} from "../../subagents/subagent-state.js";
import { ToolActivityRow } from "./tool-ui-activity-row.js";
import { str, truncate } from "./tool-ui-shared.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

export const getTaskDescription = (args: unknown): string | undefined => {
	const record = asRecord(args);
	const description = str(record?.description).replace(/\s+/g, " ").trim();
	if (description) return truncate(description, 72);
	const agent = str(record?.subagent_type).trim();
	return agent ? truncate(agent, 48) : undefined;
};

export const getTaskAgent = (args: unknown): string | undefined => {
	const agent = str(asRecord(args)?.subagent_type).trim();
	return agent || undefined;
};

export const getTaskPrompt = (args: unknown): string | undefined => {
	const prompt = str(asRecord(args)?.prompt).trim();
	return prompt || undefined;
};

export const TaskActivity: ToolCallMessagePartComponent = memo(({ args, status, toolCallId }) => {
	const title = getTaskDescription(args) ?? "Delegated task";
	const agentType = (getTaskAgent(args) ?? "Subagent")
		.replaceAll(/[-_]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
	const originalParts = useAuiState((state) => {
		const custom = state.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return custom?.opencode?.parts;
	});
	const childSessionId = childSessionIdForToolCall(originalParts, toolCallId);
	const extras = useOptionalOpenCodeRuntimeExtras();
	const threadSessionId = useAuiState((state) =>
		resolveRightPanelSessionKey(state.threadListItem.remoteId, state.threadListItem.id),
	);
	const { activities, stopSubagent, stoppingIds } = useSubagentActivity();
	const activity =
		activities.find((item) => item.toolCallId === toolCallId) ??
		(childSessionId
			? activities.find((item) => item.childSessionId === childSessionId)
			: undefined);
	const resolvedChildSessionId = activity?.childSessionId ?? childSessionId;
	const parentSessionId = extras?.session?.id ?? threadSessionId;
	const child = resolvedChildSessionId
		? extras?.state?.childSessionsById?.[resolvedChildSessionId]
		: undefined;
	const isActive =
		activity?.status === "working" ||
		activity?.status === "waiting" ||
		child?.sessionStatus?.type === "busy" ||
		child?.sessionStatus?.type === "retry";
	const stopping = resolvedChildSessionId ? stoppingIds.has(resolvedChildSessionId) : false;
	const effectiveStatus = isActive ? ({ type: "running" } as const) : status;
	const rowVerb = activity?.typeLabel ?? agentType;
	const stopTarget =
		activity ??
		(resolvedChildSessionId
			? {
					childSessionId: resolvedChildSessionId,
					toolCallId,
					title,
					typeLabel: rowVerb,
					status: "working" as const,
					directory: child?.session?.directory,
				}
			: undefined);
	const canStop = Boolean(stopTarget && isActive);
	const openPane = () => {
		if (!resolvedChildSessionId) return;
		chatRightPanelCapability.openContributedTab(parentSessionId, SUBAGENT_TAB_DEFINITION, {
			instanceId: subagentPaneInstanceId(resolvedChildSessionId),
			title,
			metadata: { [SUBAGENT_CHILD_SESSION_METADATA_KEY]: resolvedChildSessionId },
		});
	};

	return (
		<div data-qa-id={`subagent-summary-${toolCallId}`}>
			<ToolActivityRow
				liveVerb={rowVerb}
				doneVerb={rowVerb}
				object={title}
				status={effectiveStatus}
				onClick={resolvedChildSessionId ? openPane : undefined}
				ariaLabel={resolvedChildSessionId ? `Open subagent: ${title}` : undefined}
				shimmerVerb={isActive}
				connector={canStop}
				trailing={
					canStop && stopTarget ? (
						<button
							type="button"
							className={cn(
								"text-muted-foreground hover:bg-muted hover:text-foreground grid size-5 shrink-0 place-items-center rounded-sm",
								stopping && "cursor-wait",
							)}
							disabled={stopping}
							onClick={() => void stopSubagent(stopTarget)}
							aria-label={`Stop subagent: ${title}`}
						>
							{stopping ? (
								<Spinner className="size-3" />
							) : (
								<SquareIcon className="size-2.5 fill-current" />
							)}
						</button>
					) : null
				}
			/>
		</div>
	);
});
TaskActivity.displayName = "TaskActivity";
