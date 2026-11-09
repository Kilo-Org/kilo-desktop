import { CircleAlertIcon, ListTodoIcon } from "lucide-react";
import { useCallback, type FC } from "react";

import type { DomainState } from "@kilo-desktop/kernel";
import { useContextKey, useDomainState } from "@kilo-desktop/kernel/web";
import { flagKey } from "@kilo-desktop/plugin-flags/contracts";
import { WorkSessions, type PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { FIND_BAR_FEATURE_FLAG, FindScope } from "@kilo-desktop/ui/components/find-bar";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import {
	agentPaneChatId,
	PLAN_ANCHOR_CALL_ID_METADATA_KEY,
	PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY,
} from "../../contracts";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { ChatMirror, type ChatMirrorServices } from "../runtime/chat-mirror";
import { ApprovePlanButton } from "./ApprovePlanButton";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "./plan-markdown";
import {
	isCurrentPlanVersion,
	resolveDisplayedPlan,
	type PlanProjection,
	type PlanThreadProjection,
} from "./plan-projection";
import { PlanMarkdown } from "./PlanMarkdown";
import { useApprovePlan } from "./use-approve-plan";
import { usePlanContent } from "./use-plan-content";
import { usePlanThreadProjection } from "./use-plan-thread-projection";

export const PlanIcon: FC<{ className?: string }> = ({ className }) => (
	<ListTodoIcon className={className} />
);

/**
 * The plan pane: the plan revision opened from a chat's plan card (its
 * anchors are in the pane's metadata), over the pane's own runtime for that
 * chat — or the session's first chat for origin's panes, which name none.
 */
export function createPlanPane(services: ChatMirrorServices): FC<PaneProps> {
	return function PlanPane({ sessionId, pane }) {
		const session = useDomainState(
			WorkSessions,
			useCallback(
				(state: DomainState<typeof WorkSessions>) =>
					state.sessions.find((candidate) => candidate.id === sessionId),
				[sessionId],
			),
		);
		const chatId = agentPaneChatId(pane, session);
		return (
			<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="kilo-plan-pane">
				<ChatMirror services={services} sessionId={sessionId} chatId={chatId}>
					<PlanPaneContent
						anchorCallId={pane.metadata[PLAN_ANCHOR_CALL_ID_METADATA_KEY] ?? null}
						newestAnchorCallIdAtOpen={
							pane.metadata[PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY] ?? null
						}
					/>
				</ChatMirror>
			</div>
		);
	};
}

export function PlanPaneContent({
	anchorCallId,
	newestAnchorCallIdAtOpen,
}: {
	anchorCallId: string | null;
	newestAnchorCallIdAtOpen: string | null;
}) {
	const planThread = usePlanThreadProjection();
	const projection = resolveDisplayedPlan(planThread, anchorCallId, newestAnchorCallIdAtOpen);

	if (!projection) {
		return (
			<div
				className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center"
				data-qa-id="chat-pane-plan-empty"
			>
				<p className="text-foreground text-sm font-medium">No plan yet</p>
				<p className="text-xs">A plan will appear here after the plan agent finishes writing.</p>
			</div>
		);
	}

	// Keyed per revision so scroll and find-bar matches reset with the content they describe.
	return (
		<PlanRevision key={projection.anchorCallId} projection={projection} planThread={planThread} />
	);
}

function PlanRevision({
	projection,
	planThread,
}: {
	projection: PlanProjection;
	planThread: PlanThreadProjection;
}) {
	const findEnabled = useContextKey(flagKey(FIND_BAR_FEATURE_FLAG));
	const chatId = useOptionalOpenCodeRuntimeExtras()?.session?.id;
	const { approve, submitting, approved, error } = useApprovePlan({
		fallbackApprovalScope: `${chatId}:${projection.anchorCallId}`,
	});
	const { markdown, isLoading, isError } = usePlanContent(projection);

	const title = proposedPlanTitle(markdown) ?? "Plan";
	const body = markdown ? stripDisplayedPlanMarkdown(markdown) : "";
	const canApprove =
		projection.status === "ready" && isCurrentPlanVersion(planThread, projection.anchorCallId);

	return (
		<FindScope
			enabled={findEnabled}
			className="flex min-h-0 flex-1 flex-col"
			data-qa-id="chat-pane-plan"
			searchRootSelector='[data-qa-id="chat-pane-plan-body"]'
			qaPrefix="plan-find"
			placeholder="Find in plan"
			barClassName="top-14"
		>
			<div className="flex h-11 shrink-0 items-center gap-3 px-4">
				<p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
				<ApprovePlanButton
					enabled={canApprove}
					approve={approve}
					submitting={submitting}
					approved={approved}
					className="h-7 gap-1 px-2.5 text-xs"
					approveQaId="chat-pane-plan-approve"
					approvedQaId="chat-pane-plan-approved"
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-qa-id="chat-pane-plan-body">
				{isLoading && !markdown ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Spinner aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Loading plan…</EmptyTitle>
						</EmptyHeader>
					</Empty>
				) : null}
				{isError || error ? (
					<Alert variant="destructive" className="mb-3">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>{error ?? "Could not load the plan file"}</AlertTitle>
					</Alert>
				) : null}
				{body ? <PlanMarkdown text={body} /> : null}
			</div>
		</FindScope>
	);
}
