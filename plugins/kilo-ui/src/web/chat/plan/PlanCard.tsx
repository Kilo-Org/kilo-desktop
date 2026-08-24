import { useAuiState } from "@assistant-ui/react";
import { AlertCircleIcon, ListTodoIcon } from "lucide-react";
import { memo, type FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

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
		openPlan(sessionId, { anchorCallId: projection.anchorCallId });
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
						className="shimmer text-foreground/40 min-w-0 flex-1 text-sm font-semibold motion-reduce:animate-none"
						data-qa-id="kilo-plan-writing"
						role="status"
						aria-label="Writing plan"
					>
						Writing Plan
					</h3>
				) : (
					<h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
				)}
			</header>

			{showBody ? (
				<div className="relative px-4 py-1.5">
					{showLoading ? (
						<p
							className="text-muted-foreground py-2 text-sm"
							data-qa-id="kilo-plan-loading"
							role="status"
						>
							Loading plan…
						</p>
					) : null}
					{showPreview ? (
						<div className="relative max-h-40 overflow-hidden" data-qa-id="kilo-plan-preview">
							<PlanMarkdown text={preview} />
							{isReady ? (
								<div className="from-card dark:from-background pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t to-transparent" />
							) : null}
						</div>
					) : null}

					{showError ? (
						<div
							role="alert"
							className="bg-destructive text-destructive-foreground mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
						>
							<AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
							<span>
								{actionError ||
									projection.error ||
									(isContentError ? "Could not load the plan file." : null) ||
									"Kilo could not complete the plan."}
							</span>
						</div>
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
