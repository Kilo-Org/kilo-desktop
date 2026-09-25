import { useAuiState } from "@assistant-ui/react";
import { type FC } from "react";
import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { ApprovePlanButton } from "../plan/ApprovePlanButton.js";
import {
	findNewestPlanProjection,
	findPlanProjectionByAnchorCallId,
	isCurrentPlanVersion,
	type PlanProjection,
} from "../plan/plan-projection.js";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "../plan/plan-markdown.js";
import { PlanMarkdown } from "../plan/PlanMarkdown.js";
import { useApprovePlan } from "../plan/use-approve-plan.js";
import { usePlanContent } from "../plan/use-plan-content.js";
import { usePlanThreadProjection } from "../plan/use-plan-thread-projection.js";
import {
	resolveRightPanelSessionKey,
	selectSessionRightPanelState,
	useRightPanelStore,
} from "./right-panel-store.js";

export const PlanTab: FC = () => {
	const planThread = usePlanThreadProjection();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const localThreadId = useAuiState((s) => s.threadListItem.id);
	const sessionId = resolveRightPanelSessionKey(remoteId, localThreadId);
	const planAnchorCallId = useRightPanelStore(
		(state) => selectSessionRightPanelState(state.bySessionId, sessionId).planAnchorCallId,
	);

	const projection = (() => {
		if (planAnchorCallId) {
			return (
				findPlanProjectionByAnchorCallId(planThread, planAnchorCallId) ??
				findNewestPlanProjection(planThread)
			);
		}
		return findNewestPlanProjection(planThread);
	})();

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

	return <PlanTabContent projection={projection} planThread={planThread} sessionId={sessionId} />;
};

const PlanTabContent: FC<{
	projection: PlanProjection;
	planThread: ReturnType<typeof usePlanThreadProjection>;
	sessionId: string;
}> = ({ projection, planThread, sessionId }) => {
	const { approve, submitting, approved } = useApprovePlan({
		fallbackApprovalScope: `${sessionId}:${projection.anchorCallId}`,
	});
	const { markdown, isLoading, isError } = usePlanContent(projection);

	const title = proposedPlanTitle(markdown) ?? "Plan";
	const body = markdown ? stripDisplayedPlanMarkdown(markdown) : "";
	const canApprove =
		projection.status === "ready" && isCurrentPlanVersion(planThread, projection.anchorCallId);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="chat-pane-plan">
			<div className="border-border-subtle flex h-11 shrink-0 items-center gap-3 border-b px-4">
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
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
				{isError ? (
					<Alert variant="destructive">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>Could not load the plan file</AlertTitle>
					</Alert>
				) : null}
				{body ? <PlanMarkdown text={body} /> : null}
			</div>
		</div>
	);
};
