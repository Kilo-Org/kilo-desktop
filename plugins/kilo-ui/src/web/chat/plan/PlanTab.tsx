import { type FC } from "react";
import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { useFeatureFlag } from "@kilo-desktop/sdk-react";
import { FIND_BAR_FEATURE_FLAG, FindScope } from "@kilo-desktop/ui/components/find-bar";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { ApprovePlanButton } from "./ApprovePlanButton.js";
import {
	isCurrentPlanVersion,
	resolveDisplayedPlan,
	type PlanProjection,
} from "./plan-projection.js";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "./plan-markdown.js";
import { PlanMarkdown } from "./PlanMarkdown.js";
import { useApprovePlan } from "./use-approve-plan.js";
import { usePlanContent } from "./use-plan-content.js";
import { usePlanThreadProjection } from "./use-plan-thread-projection.js";
import {
	selectSessionRightPanelState,
	useRightPanelStore,
} from "../../session/right-panel/right-panel-store.js";
import type { ChatRightPanelContributionProps } from "../../session/right-panel/right-panel-tab-registry.js";

export const PlanTab: FC<Pick<ChatRightPanelContributionProps, "sessionId">> = ({ sessionId }) => {
	const planThread = usePlanThreadProjection();
	const planAnchorCallId = useRightPanelStore(
		(state) => selectSessionRightPanelState(state.bySessionId, sessionId).planAnchorCallId,
	);
	const newestAnchorCallIdAtOpen = useRightPanelStore(
		(state) =>
			selectSessionRightPanelState(state.bySessionId, sessionId).planNewestAnchorCallIdAtOpen ??
			null,
	);

	const projection = resolveDisplayedPlan(planThread, planAnchorCallId, newestAnchorCallIdAtOpen);

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

	// Keyed per snapshot so scroll and find-bar matches reset with the content they describe.
	return (
		<PlanTabContent
			key={projection.anchorCallId}
			projection={projection}
			planThread={planThread}
			sessionId={sessionId}
		/>
	);
};

const PlanTabContent: FC<{
	projection: PlanProjection;
	planThread: ReturnType<typeof usePlanThreadProjection>;
	sessionId: string;
}> = ({ projection, planThread, sessionId }) => {
	const findEnabled = useFeatureFlag(FIND_BAR_FEATURE_FLAG, false);
	const { approve, submitting, approved } = useApprovePlan({
		fallbackApprovalScope: `${sessionId}:${projection.anchorCallId}`,
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
				{isError ? (
					<Alert variant="destructive">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>Could not load the plan file</AlertTitle>
					</Alert>
				) : null}
				{body ? <PlanMarkdown text={body} /> : null}
			</div>
		</FindScope>
	);
};
