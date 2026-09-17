import {
	createContext,
	memo,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FC,
	type PropsWithChildren,
	type ReactNode,
} from "react";
import { useAuiState } from "@assistant-ui/react";
import { useOpenCodeQuestions } from "@assistant-ui/react-opencode";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "@anaconda-agentic-desktop/ui/components/avatar";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import {
	getKindMeta,
	getActivityKind,
	getSegmentStats,
	indicesHavePendingAsk,
	lastAskingPartIndex,
	soloRowHidesItself,
	summarizeActivity,
	type ActivityIconItem,
	type ActivityKind,
	type ActivityPart,
	type ActivitySegment,
} from "./tool-categories.js";
import { ReasoningText } from "../assistant-ui/reasoning.js";
import { getGroupDiffStats } from "./tool-diff-stats.js";
import { DiffCounts } from "./tool-ui-shared.js";

/**
 * Thinking segments reuse the reasoning scroll box — capped height with
 * bottom-pinning while streaming and scroll-aware edge fades — inside the
 * subgroup's bordered rail.
 */
const ThinkingStreamText: FC<PropsWithChildren<{ streaming: boolean }>> = ({
	streaming,
	children,
}) => (
	<ReasoningText
		pinning={streaming}
		className="scroll-fade border-border/60 text-muted-foreground mt-0.5 mb-1 ml-[12.5px] border-l ps-3 text-sm"
	>
		{children}
	</ReasoningText>
);

const pendingAskCallIds = (
	questions: readonly { tool?: { callID?: string } | undefined }[],
): Set<string> => {
	const ids = new Set<string>();
	for (const question of questions) {
		const callId = question.tool?.callID;
		if (typeof callId === "string") ids.add(callId);
	}
	return ids;
};

/** Whether these indices own the in-flight questionnaire (not a prior ask). */
const ownsPendingAsk = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
	pendingQuestions: readonly { tool?: { callID?: string } | undefined }[],
	messageRequiresAction: boolean,
): boolean => {
	if (pendingQuestions.length === 0) return false;
	const callIds = pendingAskCallIds(pendingQuestions);
	if (callIds.size > 0) return indicesHavePendingAsk(parts, indices, callIds);
	// Questions without callIDs: only the message's last ask while awaiting input.
	if (!messageRequiresAction) return false;
	const lastAsk = lastAskingPartIndex(parts);
	return lastAsk >= 0 && indices.includes(lastAsk);
};

const AUTO_COLLAPSE_DELAY = 1600;
const GROUP_ANIMATION_DURATION = 200;
const SUBGROUP_ANIMATION_DURATION = 200;
const MAX_VISIBLE_ICONS = 5;

/** Header is the whole story — expanding would reveal nothing (or a duplicate label). */
const LABEL_ONLY_ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set([
	"asking",
	"suggesting",
	"skill",
	"reading",
	"planning",
]);

type GroupLike = {
	indices: readonly number[];
};

const ActivityIconStack: FC<{
	items: ActivityIconItem[];
	className?: string;
}> = ({ items, className }) => {
	const overflow = items.length > MAX_VISIBLE_ICONS;
	const visible = overflow ? items.slice(-MAX_VISIBLE_ICONS) : items;
	return (
		<AvatarGroup
			className={cn(
				"*:data-[slot=avatar]:ring-[var(--pane-surface,var(--color-background))]",
				className,
			)}
		>
			{overflow ? (
				<AvatarGroupCount className="size-6.5 text-xs ring-[var(--pane-surface,var(--color-background))]">
					+{items.length - MAX_VISIBLE_ICONS}
				</AvatarGroupCount>
			) : null}
			{visible.map((item, index) => (
				<Avatar key={index} aria-hidden className="size-6.5">
					<AvatarFallback
						className={cn(
							"relative border-2 transition-colors motion-reduce:transition-none",
							item.colored ? item.className : "border-transparent",
							item.loading && "border-0",
						)}
					>
						<item.icon className="size-3.5" />
						{item.loading ? (
							<svg
								aria-hidden
								viewBox="0 0 28 28"
								fill="none"
								className="pointer-events-none absolute inset-0 size-full animate-spin"
							>
								<circle
									cx="14"
									cy="14"
									r="13"
									stroke="currentColor"
									strokeOpacity={0.4}
									strokeWidth="2"
									strokeLinecap="round"
									strokeDasharray="20.4 61.3"
								/>
							</svg>
						) : null}
					</AvatarFallback>
				</Avatar>
			))}
		</AvatarGroup>
	);
};

const ActivityLabel: FC<{
	label: string;
	object?: string | undefined;
	shimmer?: boolean;
}> = ({ label, object, shimmer = false }) => {
	const split = object === undefined ? label.indexOf(" ") : -1;
	const verb = split === -1 ? label : label.slice(0, split);
	const rest = object !== undefined ? object : split === -1 ? null : label.slice(split + 1);
	return (
		<span className="relative inline-block">
			{verb}
			{rest ? (
				<>
					{" "}
					<span className="opacity-60">{rest}</span>
				</>
			) : null}
			{shimmer ? (
				<span
					aria-hidden
					className="shimmer shimmer-color-foreground pointer-events-none absolute top-0 left-0 motion-reduce:animate-none"
				>
					{verb}
				</span>
			) : null}
		</span>
	);
};

const ActivityDisclosureIcon: FC<{ open: boolean }> = ({ open }) => {
	const Icon = open ? ChevronDownIcon : ChevronRightIcon;
	return <Icon aria-hidden data-slot="activity-disclosure-icon" className="size-3.5 shrink-0" />;
};

/**
 * Cross-fades the group trigger's label when it changes (settling → "N tools
 * used", summary ↔ "Show less"). Rendered text is aria-hidden; the trigger's
 * aria-label carries the accessible name so it swaps atomically while the
 * outgoing label is still fading out.
 */
const ActivityTriggerLabel: FC<{ label: string; children: ReactNode }> = ({ label, children }) => {
	const reduceMotion = useReducedMotion();
	return (
		<span aria-hidden className="relative block font-medium">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					key={label}
					className="block"
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
};

const contentAnimation =
	"h-(--collapsible-panel-height) overflow-hidden transition-[height] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

const useDelayedActivityOpen = (active: boolean, enabled: boolean): boolean => {
	const [heldOpen, setHeldOpen] = useState(active);

	useEffect(() => {
		if (!enabled) {
			setHeldOpen(false);
			return;
		}
		if (active) {
			setHeldOpen(true);
			return;
		}
		if (!heldOpen) return;

		const timeout = setTimeout(() => {
			setHeldOpen(false);
		}, AUTO_COLLAPSE_DELAY);

		return () => clearTimeout(timeout);
	}, [active, enabled, heldOpen]);

	return enabled && (active || heldOpen);
};

const ActivityStreamContext = createContext(false);
const ActivitySettlingSegmentContext = createContext<number | null>(null);
const ActivityProgressIndexContext = createContext(-1);

export type ActivitySubgroupContextValue = {
	kind: ActivityKind;
	size: number;
};

const ActivitySubgroupContext = createContext<ActivitySubgroupContextValue | null>(null);

/** Size/kind of the enclosing activity subgroup, when a tool is nested under one. */
export const useActivitySubgroup = (): ActivitySubgroupContextValue | null =>
	useContext(ActivitySubgroupContext);

const ActivityGroupImpl: FC<PropsWithChildren<{ group: GroupLike }>> = ({ group, children }) => {
	const parts = useAuiState((s) => s.message.parts);
	const messageStatusType = useAuiState((s) => s.message.status?.type);
	const opencodeParts = useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return custom?.opencode?.parts;
	});
	const pendingQuestions = useOpenCodeQuestions();
	const summary = useMemo(() => summarizeActivity(parts, group.indices), [parts, group.indices]);
	const hasPendingAsk = useMemo(
		() =>
			ownsPendingAsk(
				parts,
				group.indices,
				pendingQuestions,
				messageStatusType === "requires-action",
			),
		[parts, group.indices, pendingQuestions, messageStatusType],
	);

	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const [streamExpanded, setStreamExpanded] = useState(false);

	const furthestActiveIndexRef = useRef(-1);
	const lastActiveSegmentStartRef = useRef<number | null>(null);
	const lastActiveSegmentShouldExpandRef = useRef(false);
	const activeCandidate = [...summary.segments]
		.reverse()
		.find(
			(segment) =>
				segment.running || segment.requiresAction || (hasPendingAsk && segment.kind === "asking"),
		);
	const activeCandidateIndex = activeCandidate?.indices.at(-1) ?? -1;
	const activeSegment =
		activeCandidateIndex >= furthestActiveIndexRef.current ? activeCandidate : undefined;
	if (activeSegment) {
		furthestActiveIndexRef.current = activeCandidateIndex;
		lastActiveSegmentStartRef.current = activeSegment.indices[0] ?? null;
		lastActiveSegmentShouldExpandRef.current =
			activeSegment.kind === "thinking" || activeSegment.indices.length > 1;
	}
	// Only the activity group that owns the in-flight questionnaire should look
	// "live". The message can remain running between tools while it considers
	// its next step, but that gap should settle the tool group that just finished.
	const streaming = activeSegment !== undefined;
	const activeSegmentShouldExpand =
		activeSegment?.kind === "thinking" || (activeSegment?.indices.length ?? 0) > 1;
	const automaticOpen = useDelayedActivityOpen(
		streaming,
		lastActiveSegmentShouldExpandRef.current && userOpen === null,
	);
	// Two holds with different gates: automaticOpen keeps an expanded segment's
	// content visible, while settlingHold only keeps the finished segment's
	// label on the trigger — so a single tool call, which never expanded,
	// doesn't jump straight to the "N tools used" summary either.
	const settlingHold = useDelayedActivityOpen(
		streaming,
		lastActiveSegmentStartRef.current !== null && userOpen === null,
	);
	const open = userOpen ?? automaticOpen;
	const startIndex = group.indices[0] ?? 0;
	const endIndex = group.indices.at(-1) ?? 0;
	const textBefore = useAuiState((s) => {
		for (let i = startIndex - 1; i >= 0; i--) {
			const type = s.message.parts[i]?.type;
			if (type === "data") continue;
			return type === "text";
		}
		return false;
	});
	const textAfter = useAuiState((s) => {
		for (let i = endIndex + 1; i < s.message.parts.length; i++) {
			const type = s.message.parts[i]?.type;
			if (type === "data") continue;
			return type === "text";
		}
		return false;
	});

	// One subgroup is already a collapsible (thinking, or a single tool kind).
	// Wrapping it in "N tools used" would force a second expand for the same row.
	if (summary.segments.length <= 1) {
		return (
			<div data-slot="activity-group" className={cn(textBefore && "mt-3", textAfter && "mb-3")}>
				{children}
			</div>
		);
	}

	const activeLoading = Boolean(
		activeSegment?.running ||
		activeSegment?.requiresAction ||
		(hasPendingAsk && activeSegment?.kind === "asking"),
	);
	const compactSegmentStart =
		!streaming && userOpen !== true ? lastActiveSegmentStartRef.current : null;
	const settlingSegmentStart = settlingHold ? compactSegmentStart : null;
	const settlingSegment =
		settlingSegmentStart !== null
			? summary.segments.find((segment) => segment.indices[0] === settlingSegmentStart)
			: undefined;
	const settlingIndex = settlingSegment ? summary.segments.indexOf(settlingSegment) : -1;
	const settlingDiffStats =
		settlingSegment?.kind === "editing" || settlingSegment?.kind === "writing"
			? getGroupDiffStats(parts, settlingSegment.indices, opencodeParts)
			: null;
	const triggerLabel = settlingSegment
		? getKindMeta(settlingSegment.kind).doneLabel(getSegmentStats(parts, settlingSegment))
		: open
			? "Show less"
			: summary.label;

	if (streaming && !streamExpanded) {
		const previewOpen = activeSegmentShouldExpand;
		const label = activeSegment
			? getKindMeta(activeSegment.kind).liveLabel(getSegmentStats(parts, activeSegment))
			: summary.label;
		const activeIndex = activeSegment ? summary.segments.indexOf(activeSegment) : -1;
		const stackItems = summary.iconItems.map((item, index) => ({
			...item,
			colored: index === activeIndex,
			loading: index === activeIndex && activeLoading,
		}));
		return (
			<div data-slot="activity-group" className={cn(textBefore && "mt-3", textAfter && "mb-3")}>
				<button
					type="button"
					aria-expanded={previewOpen}
					onClick={() => {
						setStreamExpanded(true);
						setUserOpen(true);
					}}
					className="text-muted-foreground hover:text-foreground flex items-center gap-2 py-1 text-sm transition-colors"
				>
					<ActivityIconStack items={stackItems} className="-space-x-1" />
					<span className="font-medium">
						<ActivityLabel label={label} shimmer={activeLoading} />
					</span>
					<ActivityDisclosureIcon open={previewOpen} />
				</button>
				{previewOpen ? (
					<ActivityProgressIndexContext.Provider value={furthestActiveIndexRef.current}>
						<ActivityStreamContext.Provider value={true}>
							<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
						</ActivityStreamContext.Provider>
					</ActivityProgressIndexContext.Provider>
				) : null}
			</div>
		);
	}

	return (
		<div data-slot="activity-group" className={cn(textBefore && "mt-3", textAfter && "mb-3")}>
			<Collapsible
				open={open}
				style={
					{
						"--animation-duration": `${GROUP_ANIMATION_DURATION}ms`,
					} as CSSProperties
				}
				onOpenChange={(next) => {
					setUserOpen(next);
					if (!next) setStreamExpanded(false);
				}}
			>
				<CollapsibleTrigger
					aria-label={triggerLabel}
					className="text-muted-foreground hover:text-foreground flex items-center gap-2 py-1 text-sm transition-colors"
				>
					{open && !settlingSegment ? null : (
						<ActivityIconStack
							items={
								settlingSegment
									? summary.iconItems.map((item, index) => ({
											...item,
											colored: index === settlingIndex,
											loading: false,
										}))
									: summary.iconItems
							}
							className="-space-x-1"
						/>
					)}
					<ActivityTriggerLabel label={triggerLabel}>
						{open && !settlingSegment ? "Show less" : <ActivityLabel label={triggerLabel} />}
					</ActivityTriggerLabel>
					{settlingDiffStats ? <DiffCounts {...settlingDiffStats} /> : null}
					<ActivityDisclosureIcon open={open} />
				</CollapsibleTrigger>
				<CollapsibleContent className={cn(contentAnimation, "duration-(--animation-duration)")}>
					<ActivityProgressIndexContext.Provider value={furthestActiveIndexRef.current}>
						<ActivitySettlingSegmentContext.Provider value={compactSegmentStart}>
							<ActivityStreamContext.Provider value={compactSegmentStart !== null}>
								<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
							</ActivityStreamContext.Provider>
						</ActivitySettlingSegmentContext.Provider>
					</ActivityProgressIndexContext.Provider>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
};

export const ActivityGroup = memo(ActivityGroupImpl);
ActivityGroup.displayName = "ActivityGroup";

const ActivitySubgroupImpl: FC<PropsWithChildren<{ group: GroupLike; kind: ActivityKind }>> = ({
	group,
	kind,
	children,
}) => {
	const parts = useAuiState((s) => s.message.parts);
	const messageRequiresAction = useAuiState((s) => s.message.status?.type === "requires-action");
	const opencodeParts = useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return custom?.opencode?.parts;
	});
	const pendingQuestions = useOpenCodeQuestions();
	const segment = useMemo<ActivitySegment>(() => {
		const indices = group.indices.filter((index) => {
			const part = parts[index];
			return part !== undefined && getActivityKind(part) === kind;
		});
		let running = false;
		let requiresAction = false;
		for (const index of indices) {
			const status = parts[index]?.status;
			if (status?.type === "running") running = true;
			if (status?.type === "requires-action") requiresAction = true;
		}
		return { kind, indices, running, requiresAction };
	}, [parts, group.indices, kind]);
	const hasPendingAsk = useMemo(
		() =>
			kind === "asking" &&
			ownsPendingAsk(parts, segment.indices, pendingQuestions, messageRequiresAction),
		[kind, parts, segment.indices, pendingQuestions, messageRequiresAction],
	);

	const [toggled, setToggled] = useState<boolean | null>(null);

	const progressIndex = useContext(ActivityProgressIndexContext);
	const segmentEndIndex = segment.indices.at(-1) ?? -1;
	const canBeActive = segmentEndIndex >= progressIndex;
	const statusActive = canBeActive && (segment.running || segment.requiresAction || hasPendingAsk);
	const automaticOpen = useDelayedActivityOpen(
		statusActive,
		(kind === "thinking" || segment.indices.length > 1) && toggled === null,
	);
	const settlingSegmentStart = useContext(ActivitySettlingSegmentContext);
	const isSettlingSegment = settlingSegmentStart === (segment.indices[0] ?? null);
	const open =
		(canBeActive && (segment.requiresAction || hasPendingAsk)) ||
		(toggled ?? (isSettlingSegment || automaticOpen));

	const streamCollapsed = useContext(ActivityStreamContext);

	const meta = getKindMeta(kind);
	const stats = useMemo(() => getSegmentStats(parts, segment), [parts, segment]);
	const diffStats = useMemo(
		() =>
			kind === "editing" || kind === "writing"
				? getGroupDiffStats(parts, segment.indices, opencodeParts)
				: null,
		[kind, parts, segment.indices, opencodeParts],
	);
	const subgroupContext = useMemo<ActivitySubgroupContextValue>(
		() => ({ kind, size: segment.indices.length }),
		[kind, segment.indices.length],
	);

	const active = statusActive;

	if (streamCollapsed && !active && !isSettlingSegment) return null;

	// A single label-only activity is fully described by its header. Multiple
	// items need a disclosure for their child list; asking is the exception
	// because its questionnaire renders outside the activity group.
	// While the stream row is collapsed, the parent ActivityGroup owns the icon.
	const labelOnly =
		(LABEL_ONLY_ACTIVITY_KINDS.has(kind) &&
			(kind === "asking" || kind === "suggesting" || stats.count === 1)) ||
		(kind !== "thinking" && segment.running) ||
		(stats.count === 1 && soloRowHidesItself(kind, parts[segment.indices[0]!]));
	if (labelOnly) {
		if (streamCollapsed) {
			if (segment.indices.length <= 1) return null;
			return (
				<ActivitySubgroupContext.Provider value={subgroupContext}>
					<div className="border-border/60 mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3">
						{children}
					</div>
				</ActivitySubgroupContext.Provider>
			);
		}
		const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);
		const showChildren = kind !== "asking" && kind !== "suggesting" && segment.indices.length > 1;
		return (
			<ActivitySubgroupContext.Provider value={subgroupContext}>
				<div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
					<ActivityIconStack
						items={[
							{
								icon: meta.icon,
								label: meta.label,
								className: meta.circleClassName,
								colored: active,
								loading: active,
							},
						]}
					/>
					<span className="font-medium">
						<ActivityLabel
							label={label}
							object={kind === "skill" ? (stats.skill ?? "") : undefined}
							shimmer={active}
						/>
					</span>
				</div>
				{showChildren ? (
					<div className="border-border/60 mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3">
						{children}
					</div>
				) : null}
			</ActivitySubgroupContext.Provider>
		);
	}

	if (streamCollapsed) {
		return (
			<ActivitySubgroupContext.Provider value={subgroupContext}>
				{kind === "thinking" ? (
					<ThinkingStreamText streaming={segment.running}>{children}</ThinkingStreamText>
				) : (
					<div className="border-border/60 mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3">
						{children}
					</div>
				)}
			</ActivitySubgroupContext.Provider>
		);
	}

	const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);

	return (
		<ActivitySubgroupContext.Provider value={subgroupContext}>
			<Collapsible
				open={open}
				style={
					{
						"--animation-duration": `${SUBGROUP_ANIMATION_DURATION}ms`,
					} as CSSProperties
				}
				onOpenChange={(next) => {
					setToggled(next);
				}}
			>
				<CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 py-1 text-sm transition-colors">
					<ActivityIconStack
						items={[
							{
								icon: meta.icon,
								label: meta.label,
								className: meta.circleClassName,
								colored: active || open,
								loading: canBeActive && segment.running,
							},
						]}
					/>
					<span className="font-medium">
						<ActivityLabel label={label} shimmer={segment.running} />
					</span>
					{diffStats ? <DiffCounts {...diffStats} /> : null}
					<ActivityDisclosureIcon open={open} />
				</CollapsibleTrigger>
				<CollapsibleContent className={cn(contentAnimation, "duration-(--animation-duration)")}>
					{kind === "thinking" ? (
						<ThinkingStreamText streaming={segment.running}>{children}</ThinkingStreamText>
					) : (
						<div className="border-border/60 mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3">
							{children}
						</div>
					)}
				</CollapsibleContent>
			</Collapsible>
		</ActivitySubgroupContext.Provider>
	);
};

export const ActivitySubgroup = memo(ActivitySubgroupImpl);
ActivitySubgroup.displayName = "ActivitySubgroup";
