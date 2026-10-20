import { useAuiState } from "@assistant-ui/react";
import { CircleAlertIcon, ListTodoIcon } from "lucide-react";
import { memo, type FC } from "react";

import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button } from "@kilo-desktop/ui/components/button";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { OPTIMISTIC_AGENT_CATALOG } from "../agent-selection/agent-catalog.js";
import {
	resolveRightPanelSessionKey,
	useRightPanelStore,
} from "../right-panel/right-panel-store.js";
import { ApprovePlanButton } from "./ApprovePlanButton.js";
import { buildCollapsedProposedPlanPreviewMarkdown, proposedPlanTitle } from "./plan-markdown.js";
import { isCurrentPlanVersion, type PlanProjection } from "./plan-projection.js";
import { PlanMarkdown } from "./PlanMarkdown.js";
import { useApprovePlan } from "./use-approve-plan.js";
import { usePlanContent } from "./use-plan-content.js";
import { usePlanThreadProjection } from "./use-plan-thread-projection.js";

const PLAN_AGENT_ACCENT =
	OPTIMISTIC_AGENT_CATALOG.agents.find((entry) => entry.name === "plan")?.color ?? "#f97316";

const planIconStyle = {
	["--agent-accent" as string]: PLAN_AGENT_ACCENT,
	backgroundColor: "color-mix(in oklab, var(--agent-accent) 16%, transparent)",
	color: "var(--agent-accent)",
} as const;

type PlanCardProps = {
	projection: PlanProjection;
};

export const PlanCard: FC<PlanCardProps> = memo(({ projection }) => {
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const localThreadId = useAuiState((s) => s.threadListItem.id);
	const planThread = usePlanThreadProjection();
	const sessionId = resolveRightPanelSessionKey(remoteId, localThreadId);
	const openPlan = useRightPanelStore((state) => state.openPlan);
	const {
		approve,
		submitting,
		approved,
		error: actionError,
	} = useApprovePlan({
		fallbackApprovalScope: `${sessionId}:${projection.anchorCallId}`,
	});
	const {
		markdown,
		isLoading: isContentLoading,
		isError: isContentError,
	} = usePlanContent(projection);

	const title = proposedPlanTitle(markdown) ?? "Implementation plan";
	const preview = markdown
		? buildCollapsedProposedPlanPreviewMarkdown(markdown, { maxLines: 6 })
		: "";
	const isReady = projection.status === "ready";
	const isWriting = projection.status === "writing";
	const isError = projection.status === "error";
	const showPreview = Boolean(preview);
	const showLoading = isContentLoading && !preview;
	const showError = isError || Boolean(actionError) || isContentError;
	const showBody = showPreview || showLoading || showError;
	const writingHeaderOnly = isWriting && !showBody;
	const canApprove = isReady && isCurrentPlanVersion(planThread, projection.anchorCallId);

	const handleViewPlan = () => {
		// An unfinished newest plan has not been seen yet, so it must not become the baseline.
		const newest = planThread.newest;
		openPlan(sessionId, {
			anchorCallId: projection.anchorCallId,
			newestAnchorCallId:
				newest?.status === "ready" ? newest.anchorCallId : projection.anchorCallId,
		});
	};

	return (
		<section
			data-slot="kilo-plan-card"
			data-qa-id="kilo-plan-card"
			data-plan-status={projection.status}
			className="bg-card text-card-foreground dark:bg-background my-3 w-full overflow-hidden rounded-xl border shadow-sm"
		>
			<header
				className={cn("flex items-center gap-3 px-4", writingHeaderOnly ? "py-3" : "pt-3 pb-1.5")}
			>
				<span
					className="flex size-6 shrink-0 items-center justify-center rounded-md"
					style={planIconStyle}
				>
					<ListTodoIcon className="size-3.5" />
				</span>
				{isWriting ? (
					<h3
						className="shimmer text-foreground/40 min-w-0 flex-1 text-sm font-medium motion-reduce:animate-none"
						data-qa-id="kilo-plan-writing"
						role="status"
						aria-label="Writing plan"
					>
						Writing Plan
					</h3>
				) : (
					<h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
				)}
			</header>

			{showBody ? (
				<div className="relative px-4 py-1.5">
					{showLoading ? (
						<div
							className="flex flex-col gap-2 py-2"
							data-qa-id="kilo-plan-loading"
							role="status"
							aria-busy="true"
							aria-label="Loading plan"
						>
							<Skeleton className="h-3.5 w-3/4" aria-hidden="true" />
							<Skeleton className="h-3.5 w-1/2" aria-hidden="true" />
						</div>
					) : null}
					{showPreview ? (
						<div
							className={cn(
								"relative max-h-40 overflow-hidden",
								// A mask rather than a colour overlay, so the fade works on any surface.
								isReady &&
									"[mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent)]",
							)}
							data-qa-id="kilo-plan-preview"
						>
							<PlanMarkdown text={preview} />
						</div>
					) : null}

					{showError ? (
						<Alert variant="destructive" className="mt-2">
							<CircleAlertIcon aria-hidden="true" />
							<AlertTitle>
								{actionError ||
									projection.error ||
									(isContentError ? "Could not load the plan file." : null) ||
									"Kilo could not complete the plan."}
							</AlertTitle>
						</Alert>
					) : null}
				</div>
			) : null}

			{isReady ? (
				<footer className="flex items-center justify-end gap-2 px-4 pt-1.5 pb-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-qa-id="kilo-plan-view"
						onClick={handleViewPlan}
					>
						View Plan
					</Button>
					<ApprovePlanButton
						enabled={canApprove}
						approve={approve}
						submitting={submitting}
						approved={approved}
					/>
				</footer>
			) : null}
		</section>
	);
});

PlanCard.displayName = "PlanCard";
