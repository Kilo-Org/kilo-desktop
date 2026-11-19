import { CircleAlertIcon, ListTodoIcon } from "lucide-react";
import { useState, type FC } from "react";
import { createPortal } from "react-dom";

import type { PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { FindScope } from "@kilo-desktop/ui/components/find-bar";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { blockIndexAt, readingBlocks } from "@kilo-desktop/ui/lib/reading/blocks";

import {
	paneChatId,
	PLAN_ANCHOR_CALL_ID_METADATA_KEY,
	PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY,
} from "../../contracts";
import { useOptionalOpenCodeSession } from "../runtime/use-optional-opencode-runtime-extras";
import { ChatMirror, type ChatMirrorServices } from "../runtime/chat-mirror";
import type { ChatFocusTarget } from "../reading/chat-focus";
import {
	ChatReadingProvider,
	useChatReading,
	useFocusContainer,
	useFocusSession,
	type ChatReading,
} from "../reading/chat-reading";
import {
	PaneFocusRail,
	PaneReadingControl,
	useReadingSurfaceStyle,
	useReadingThemeScope,
} from "../reading/reading-ui";
import { useFocusSource } from "../reading/use-focus-source";
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
 * anchors are in the pane's metadata), over the pane's own runtime for the
 * chat it shows (its `object`).
 */
export function createPlanPane(
	services: ChatMirrorServices & { readonly reading?: ChatReading },
): FC<PaneProps> {
	return (props) => <PlanPane {...props} services={services} />;
}

function PlanPane({
	workSessionId,
	pane,
	services,
}: PaneProps & { services: ChatMirrorServices & { readonly reading?: ChatReading } }) {
	const chatId = paneChatId(pane);
	return (
		<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="kilo-plan-pane">
			<ChatReadingProvider
				reading={services.reading}
				workSessionId={workSessionId}
				paneId={pane.id}
			>
				<ChatMirror services={services} workSessionId={workSessionId} chatId={chatId}>
					<PlanPaneContent
						anchorCallId={pane.metadata[PLAN_ANCHOR_CALL_ID_METADATA_KEY] ?? null}
						newestAnchorCallIdAtOpen={
							pane.metadata[PLAN_NEWEST_ANCHOR_CALL_ID_METADATA_KEY] ?? null
						}
					/>
				</ChatMirror>
			</ChatReadingProvider>
		</div>
	);
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
	const chatId = useOptionalOpenCodeSession()?.id;
	const { approve, submitting, approved, error } = useApprovePlan({
		fallbackApprovalScope: `${chatId}:${projection.anchorCallId}`,
	});
	const { markdown, isLoading, isError } = usePlanContent(projection);

	const title = proposedPlanTitle(markdown) ?? "Plan";
	const body = markdown ? stripDisplayedPlanMarkdown(markdown) : "";
	const canApprove =
		projection.status === "ready" && isCurrentPlanVersion(planThread, projection.anchorCallId);
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const surfaceStyle = useReadingSurfaceStyle("ui");
	const readingTheme = useReadingThemeScope();
	const context = useChatReading();
	const surface = () => scroller?.querySelector('[data-reading-surface="plan"]') ?? null;
	const targetNearMiddle = (): ChatFocusTarget | null => {
		const root = surface();
		if (!root || !scroller) return null;
		const box = scroller.getBoundingClientRect();
		const index = blockIndexAt(readingBlocks(root), box.top + box.height / 2);
		return { kind: "plan", block: Math.max(0, index) };
	};
	useFocusSource({
		kind: "plan",
		available: Boolean(body),
		targetNearMiddle,
		reveal: (target) => {
			const root = surface();
			const block = root ? readingBlocks(root)[target.block] : undefined;
			block?.elements[0]?.scrollIntoView({ block: "center" });
		},
	});
	const enter = (source: "rail" | "reading-control", target = targetNearMiddle()) => {
		if (!context || !target) return;
		const root = surface();
		void context.reading.enter(context, target, source, {
			blockCount: root ? readingBlocks(root).length : 0,
			streaming: false,
		});
	};

	return (
		<FindScope
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
			<div className="relative flex min-h-0 flex-1 flex-col" {...readingTheme}>
				<div
					ref={setScroller}
					className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4"
					data-qa-id="chat-pane-plan-body"
				>
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
					{body ? (
						<div data-reading-surface="plan" style={surfaceStyle}>
							<PlanMarkdown text={body} />
						</div>
					) : null}
					{body ? (
						<PaneFocusRail
							host={scroller}
							onFocusFrom={(target) => enter("rail", { kind: "plan", block: target.index })}
						/>
					) : null}
				</div>
				{body ? (
					<div className="absolute right-4 bottom-4 z-10">
						<PaneReadingControl
							surface="plan"
							base="ui"
							enterFocus={() => enter("reading-control")}
						/>
					</div>
				) : null}
			</div>
			{body ? <PlanFocusPortal body={body} /> : null}
		</FindScope>
	);
}

/** The plan body, portalled into the Focus take-over while this pane is being read. */
function PlanFocusPortal({ body }: { body: string }) {
	const context = useChatReading();
	const session = useFocusSession(context?.reading);
	const container = useFocusContainer(context?.reading);
	if (
		!context ||
		!container ||
		session?.paneId !== context.paneId ||
		session.target.kind !== "plan"
	)
		return null;
	return createPortal(
		<div data-reading-surface="plan" data-qa-id="chat-focus-plan">
			<PlanMarkdown text={body} />
		</div>,
		container,
	);
}
