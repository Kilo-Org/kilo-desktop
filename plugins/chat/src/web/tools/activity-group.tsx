import {
	createContext,
	memo,
	useContext,
	useEffect,
	useState,
	type CSSProperties,
	type FC,
	type PropsWithChildren,
	type ReactNode,
} from "react";
import { useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "@kilo-desktop/ui/components/avatar";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	getKindMeta,
	getActivityKind,
	getPartToolCallId,
	getSegmentStats,
	indicesHavePendingAsk,
	lastAskingPartIndex,
	soloRowHidesItself,
	summarizeActivity,
	type ActivityIconItem,
	type ActivityKind,
	type ActivityPart,
	type ActivitySegment,
} from "./tool-categories";
import { usePendingInteractions } from "../interactions/PendingInteractionsContext";
import { ReasoningText } from "../thread/reasoning";
import { getGroupDiffStats } from "./tool-diff-stats";
import { DiffCounts } from "./tool-ui-shared";

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
		className="scroll-fade border-border-subtle text-muted-foreground mt-0.5 mb-1 ml-[12.5px] border-l ps-3 text-sm"
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

const ownsPendingPermission = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
	permissions: readonly {
		tool?: { messageID?: string; callID?: string } | undefined;
	}[],
	stepIds: ReadonlySet<string | undefined>,
): boolean => {
	for (const permission of permissions) {
		const tool = permission.tool;
		if (!tool?.callID || (tool.messageID && !stepIds.has(tool.messageID))) continue;
		for (const index of indices) {
			const part = parts[index];
			if (part && getPartToolCallId(part) === tool.callID) return true;
		}
	}
	return false;
};

/**
 * The server message ids behind a transcript message. Consecutive assistant
 * steps are projected as one message under the first step's id, while a
 * permission names the step whose tool asked.
 */
const messageStepIds = (
	messageId: string | undefined,
	opencodeParts: unknown,
): ReadonlySet<string | undefined> => {
	const ids = new Set<string | undefined>([messageId]);
	if (Array.isArray(opencodeParts)) {
		for (const part of opencodeParts as readonly { messageID?: unknown }[]) {
			if (typeof part?.messageID === "string") ids.add(part.messageID);
		}
	}
	return ids;
};

const AUTO_COLLAPSE_DELAY = 1600;
const GROUP_ANIMATION_DURATION = 200;
export const SUBGROUP_ANIMATION_DURATION = 200;
const MAX_VISIBLE_ICONS = 5;

/** Header is the whole story — expanding would reveal nothing (or a duplicate label). */
const LABEL_ONLY_ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set([
	"asking",
	"skill",
	"reading",
	"planning",
]);

type GroupLike = {
	indices: readonly number[];
};

export const ActivityIconStack: FC<{
	items: ActivityIconItem[];
	className?: string;
}> = ({ items, className }) => {
	const overflow = items.length > MAX_VISIBLE_ICONS;
	const visible = overflow ? items.slice(-MAX_VISIBLE_ICONS) : items;
	return (
		<AvatarGroup className={cn("*:data-[slot=avatar]:ring-pane", className)}>
			{overflow ? (
				<AvatarGroupCount className="ring-pane size-6.5 text-xs">
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

export const ActivityLabel: FC<{
	label: string;
	object?: string | undefined;
	shimmer?: boolean;
}> = ({ label, object, shimmer = false }) => {
	const split = object === undefined ? label.indexOf(" ") : -1;
	const verb = split === -1 ? label : label.slice(0, split);
	const rest = object !== undefined ? object : split === -1 ? null : label.slice(split + 1);
	return (
		<span>
			{/* inline-block so the overlay shares the verb's line box; a plain inline
			    anchor offsets the absolute overlay by the half-leading. */}
			<span className="relative inline-block">
				{verb}
				{shimmer ? (
					<span
						aria-hidden
						className="shimmer shimmer-color-foreground pointer-events-none absolute inset-0 motion-reduce:animate-none"
					>
						{verb}
					</span>
				) : null}
			</span>
			{rest ? (
				<>
					{" "}
					<span className="opacity-60">{rest}</span>
				</>
			) : null}
		</span>
	);
};

export const ActivityDisclosureIcon: FC<{ open: boolean }> = ({ open }) => {
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
		<span aria-hidden className="relative block min-w-0 font-medium">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					key={label}
					className="block truncate"
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

export const ACTIVITY_CONTENT_ANIMATION =
	"h-(--collapsible-panel-height) overflow-hidden transition-[height] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

export const useDelayedActivityOpen = (active: boolean, enabled: boolean): boolean => {
	const [heldOpen, setHeldOpen] = useState(active);
	if (!enabled && heldOpen) setHeldOpen(false);
	if (enabled && active && !heldOpen) setHeldOpen(true);

	useEffect(() => {
		if (!enabled || active || !heldOpen) return;

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

type ManualDisclosureContextValue = {
	openById: ReadonlyMap<string, boolean>;
	setOpen: (id: string, open: boolean) => void;
};

const ManualDisclosureContext = createContext<ManualDisclosureContextValue | null>(null);
const ActivityGroupManualOpenContext = createContext<(() => void) | null>(null);
const ActivitySubgroupManualOpenContext = createContext<(() => void) | null>(null);

/**
 * What each message's disclosures were left as, kept for the thread: a
 * windowed transcript unmounts messages scrolled far away, and one scrolled
 * back keeps what the reader opened or closed.
 */
const ManualDisclosureMemoryContext = createContext<Map<
	string,
	ReadonlyMap<string, boolean>
> | null>(null);

export const ManualDisclosureMemoryProvider: FC<PropsWithChildren> = ({ children }) => {
	const [memory] = useState(() => new Map<string, ReadonlyMap<string, boolean>>());
	return (
		<ManualDisclosureMemoryContext.Provider value={memory}>
			{children}
		</ManualDisclosureMemoryContext.Provider>
	);
};

/** Disclosure state for one message; `scope` (its id) keeps it in the thread's memory. */
export const ManualDisclosureProvider: FC<PropsWithChildren<{ scope?: string }>> = ({
	scope,
	children,
}) => {
	const memory = useContext(ManualDisclosureMemoryContext);
	const [openById, setOpenById] = useState<ReadonlyMap<string, boolean>>(
		() => (scope !== undefined ? memory?.get(scope) : undefined) ?? new Map(),
	);
	const setOpen = (id: string, open: boolean) => {
		setOpenById((current) => {
			if (current.get(id) === open) return current;
			const next = new Map(current);
			next.set(id, open);
			if (scope !== undefined) memory?.set(scope, next);
			return next;
		});
	};
	const value = { openById, setOpen };
	return (
		<ManualDisclosureContext.Provider value={value}>{children}</ManualDisclosureContext.Provider>
	);
};

export const useManualDisclosure = (
	id: string,
): readonly [boolean | undefined, (open: boolean) => void] => {
	const context = useContext(ManualDisclosureContext);
	const setOpen = (open: boolean) => context?.setOpen(id, open);
	return [context?.openById.get(id), setOpen];
};

export const useHasOpenManualDisclosure = (): boolean => {
	const context = useContext(ManualDisclosureContext);
	return context ? [...context.openById.values()].some(Boolean) : false;
};

export const useKeepActivityGroupOpen = (): (() => void) | null =>
	useContext(ActivityGroupManualOpenContext);

export const useKeepActivitySubgroupOpen = (): (() => void) | null =>
	useContext(ActivitySubgroupManualOpenContext);

/** Size/kind of the enclosing activity subgroup, when a tool is nested under one. */
export const useActivitySubgroup = (): ActivitySubgroupContextValue | null =>
	useContext(ActivitySubgroupContext);

/** Separates a top-level group from adjacent message text; adjacent groups sit flush. */
export const useActivityGroupSpacing = (group: GroupLike): string | undefined => {
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
	return cn(textBefore && "mt-3", textAfter && "mb-3") || undefined;
};

/**
 * The furthest segment that has been live in a group. Progress only moves
 * forward: an earlier segment never becomes the live row again.
 */
interface LastActiveSegment {
	readonly furthestIndex: number;
	readonly start: number | null;
	readonly shouldExpand: boolean;
}

const NO_ACTIVE_SEGMENT: LastActiveSegment = {
	furthestIndex: -1,
	start: null,
	shouldExpand: false,
};

const useOpenCodeParts = () =>
	useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return custom?.opencode?.parts;
	});

/** The group's activity summary, and whether it owns a pending question or permission. */
function useActivityGroupSummary(group: GroupLike) {
	const parts = useAuiState((s) => s.message.parts);
	const messageId = useAuiState((s) => s.message.id);
	const messageRequiresAction = useAuiState((s) => s.message.status?.type === "requires-action");
	const opencodeParts = useOpenCodeParts();
	const { questions, permissions } = usePendingInteractions();
	return {
		parts,
		opencodeParts,
		summary: summarizeActivity(parts, group.indices),
		hasPendingAsk: ownsPendingAsk(parts, group.indices, questions, messageRequiresAction),
		hasPendingPermission: ownsPendingPermission(
			parts,
			group.indices,
			permissions,
			messageStepIds(messageId, opencodeParts),
		),
	};
}

const ActivityGroupImpl: FC<PropsWithChildren<{ group: GroupLike }>> = ({ group, children }) => {
	const { parts, opencodeParts, summary, hasPendingAsk, hasPendingPermission } =
		useActivityGroupSummary(group);

	const disclosureId = `activity:${group.indices[0] ?? 0}`;
	const [persistedUserOpen, setPersistedUserOpen] = useManualDisclosure(disclosureId);
	const [localUserOpen, setLocalUserOpen] = useState<boolean | null>(null);
	const userOpen = persistedUserOpen ?? localUserOpen;
	const setUserOpen = (open: boolean) => {
		setLocalUserOpen(open);
		setPersistedUserOpen(open);
	};
	const keepActivityGroupOpen = () => setUserOpen(true);
	const [lastActive, setLastActive] = useState(NO_ACTIVE_SEGMENT);
	const activeCandidate = [...summary.segments]
		.reverse()
		.find(
			(segment) =>
				segment.running || segment.requiresAction || (hasPendingAsk && segment.kind === "asking"),
		);
	const activeCandidateIndex = activeCandidate?.indices.at(-1) ?? -1;
	const activeSegment =
		activeCandidateIndex >= lastActive.furthestIndex ? activeCandidate : undefined;
	if (activeSegment) {
		const start = activeSegment.indices[0] ?? null;
		const shouldExpand =
			activeSegment.kind === "thinking" || activeSegment.indices.length > 1 || hasPendingPermission;
		if (
			lastActive.furthestIndex !== activeCandidateIndex ||
			lastActive.start !== start ||
			lastActive.shouldExpand !== shouldExpand
		) {
			setLastActive({ furthestIndex: activeCandidateIndex, start, shouldExpand });
		}
	}
	// Only the activity group that owns the in-flight questionnaire should look
	// "live". The message can remain running between tools while it considers
	// its next step, but that gap should settle the tool group that just finished.
	const streaming = activeSegment !== undefined;
	const activeSegmentShouldExpand =
		activeSegment?.kind === "thinking" ||
		(activeSegment?.indices.length ?? 0) > 1 ||
		hasPendingPermission;
	const automaticOpen = useDelayedActivityOpen(
		streaming,
		lastActive.shouldExpand && userOpen === null,
	);
	// Two holds with different gates: automaticOpen keeps an expanded segment's
	// content visible, while settlingHold only keeps the finished segment's
	// label on the trigger — so a single tool call, which never expanded,
	// doesn't jump straight to the "N tools used" summary either.
	const settlingHold = useDelayedActivityOpen(
		streaming,
		lastActive.start !== null && userOpen === null,
	);
	const open = userOpen ?? automaticOpen;
	const spacing = useActivityGroupSpacing(group);

	// One subgroup is already a collapsible (thinking, or a single tool kind).
	// Wrapping it in "N tools used" would force a second expand for the same row.
	const headless = summary.segments.length <= 1;
	const preview = !headless && streaming && userOpen !== true;

	const activeLoading = Boolean(
		activeSegment?.running ||
		activeSegment?.requiresAction ||
		(hasPendingAsk && activeSegment?.kind === "asking"),
	);
	const compactSegmentStart =
		!headless && !streaming && userOpen !== true ? lastActive.start : null;
	const settlingSegmentStart = settlingHold ? compactSegmentStart : null;
	const settlingSegment =
		settlingSegmentStart !== null
			? summary.segments.find((segment) => segment.indices[0] === settlingSegmentStart)
			: undefined;
	const triggerLabel = settlingSegment
		? getKindMeta(settlingSegment.kind).doneLabel(getSegmentStats(parts, settlingSegment))
		: open
			? "Show less"
			: summary.label;

	// One element tree for every mode (headless, streaming preview, settled):
	// a tool finishing flips the mode, and a different tree would remount the
	// tool rows under it, replaying their entrance and dropping their state.
	return (
		<ActivityGroupManualOpenContext.Provider value={preview ? null : keepActivityGroupOpen}>
			<div data-slot="activity-group" className={spacing}>
				<Collapsible
					open={headless || (preview ? activeSegmentShouldExpand : open)}
					style={
						{
							"--animation-duration": `${GROUP_ANIMATION_DURATION}ms`,
						} as CSSProperties
					}
					onOpenChange={(next) => {
						// The streaming preview's header pins the group open.
						setUserOpen(preview || next);
					}}
				>
					{headless ? null : preview ? (
						<CollapsibleTrigger className={GROUP_TRIGGER_CLASS_NAME}>
							<StreamingGroupHeader
								summary={summary}
								parts={parts}
								activeSegment={activeSegment}
								activeLoading={activeLoading}
								open={activeSegmentShouldExpand}
							/>
						</CollapsibleTrigger>
					) : (
						<CollapsibleTrigger aria-label={triggerLabel} className={GROUP_TRIGGER_CLASS_NAME}>
							<SettledGroupHeader
								summary={summary}
								parts={parts}
								opencodeParts={opencodeParts}
								open={open}
								label={triggerLabel}
								settlingSegment={settlingSegment}
							/>
						</CollapsibleTrigger>
					)}
					<CollapsibleContent
						className={
							headless
								? undefined
								: cn(ACTIVITY_CONTENT_ANIMATION, "duration-(--animation-duration)")
						}
					>
						<ActivityProgressIndexContext.Provider value={headless ? -1 : lastActive.furthestIndex}>
							<ActivitySettlingSegmentContext.Provider value={compactSegmentStart}>
								<ActivityStreamContext.Provider value={preview || compactSegmentStart !== null}>
									<div className={headless ? undefined : "mt-1 flex flex-col gap-0.5 pb-1"}>
										{children}
									</div>
								</ActivityStreamContext.Provider>
							</ActivitySettlingSegmentContext.Provider>
						</ActivityProgressIndexContext.Provider>
					</CollapsibleContent>
				</Collapsible>
			</div>
		</ActivityGroupManualOpenContext.Provider>
	);
};

const GROUP_TRIGGER_CLASS_NAME =
	"text-muted-foreground hover:text-foreground flex max-w-full items-center gap-2 py-1 text-sm transition-colors";

type ActivitySummary = ReturnType<typeof summarizeActivity>;

const StreamingGroupHeader: FC<{
	summary: ActivitySummary;
	parts: readonly ActivityPart[];
	activeSegment: ActivitySegment | undefined;
	activeLoading: boolean;
	open: boolean;
}> = ({ summary, parts, activeSegment, activeLoading, open }) => {
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
		<>
			<ActivityIconStack items={stackItems} className="-space-x-1" />
			<span className="min-w-0 truncate font-medium">
				<ActivityLabel label={label} shimmer={activeLoading} />
			</span>
			<ActivityDisclosureIcon open={open} />
		</>
	);
};

const SettledGroupHeader: FC<{
	summary: ActivitySummary;
	parts: readonly ActivityPart[];
	opencodeParts: unknown;
	open: boolean;
	label: string;
	settlingSegment: ActivitySegment | undefined;
}> = ({ summary, parts, opencodeParts, open, label, settlingSegment }) => {
	const settlingIndex = settlingSegment ? summary.segments.indexOf(settlingSegment) : -1;
	const settlingDiffStats =
		settlingSegment?.kind === "editing" || settlingSegment?.kind === "writing"
			? getGroupDiffStats(parts, settlingSegment.indices, opencodeParts)
			: null;
	return (
		<>
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
			<ActivityTriggerLabel label={label}>
				{open && !settlingSegment ? "Show less" : <ActivityLabel label={label} />}
			</ActivityTriggerLabel>
			{settlingDiffStats ? <DiffCounts {...settlingDiffStats} /> : null}
			<ActivityDisclosureIcon open={open} />
		</>
	);
};
export const ActivityGroup = memo(ActivityGroupImpl);
ActivityGroup.displayName = "ActivityGroup";

/** The group's parts of one kind, their stats, and whether they own a pending question or permission. */
function useActivitySegment(group: GroupLike, kind: ActivityKind) {
	const parts = useAuiState((s) => s.message.parts);
	const messageId = useAuiState((s) => s.message.id);
	const messageRequiresAction = useAuiState((s) => s.message.status?.type === "requires-action");
	const opencodeParts = useOpenCodeParts();
	const { questions, permissions } = usePendingInteractions();
	const segment = activitySegment(
		parts,
		group.indices,
		kind,
		questions.length + permissions.length > 0,
	);
	return {
		parts,
		segment,
		hasPendingAsk:
			kind === "asking" && ownsPendingAsk(parts, segment.indices, questions, messageRequiresAction),
		hasPendingPermission: ownsPendingPermission(
			parts,
			segment.indices,
			permissions,
			messageStepIds(messageId, opencodeParts),
		),
		stats: getSegmentStats(parts, segment),
		diffStats:
			kind === "editing" || kind === "writing"
				? getGroupDiffStats(parts, segment.indices, opencodeParts)
				: null,
	};
}

function activitySegment(
	parts: readonly ActivityPart[],
	groupIndices: readonly number[],
	kind: ActivityKind,
	promptShowing: boolean,
): ActivitySegment {
	const indices = groupIndices.filter((index) => {
		const part = parts[index];
		return part !== undefined && getActivityKind(part) === kind;
	});
	let running = false;
	let requiresAction = false;
	for (const index of indices) {
		const status = parts[index]?.status;
		if (status?.type === "running") running = true;
		// "requires-action" with no prompt showing is a request auto-approve is
		// answering: the tool is still running, and treating it as waiting would
		// swap its row for an open disclosure until the answer lands.
		if (status?.type === "requires-action") {
			if (promptShowing) requiresAction = true;
			else running = true;
		}
	}
	return { kind, indices, running, requiresAction };
}

const ActivitySubgroupImpl: FC<PropsWithChildren<{ group: GroupLike; kind: ActivityKind }>> = ({
	group,
	kind,
	children,
}) => {
	const { parts, segment, hasPendingAsk, hasPendingPermission, stats, diffStats } =
		useActivitySegment(group, kind);

	const disclosureId = `subgroup:${kind}:${group.indices[0] ?? 0}`;
	const [persistedToggled, setPersistedToggled] = useManualDisclosure(disclosureId);
	const keepActivityGroupOpen = useKeepActivityGroupOpen();
	const [localToggled, setLocalToggled] = useState<boolean | null>(null);
	const toggled = persistedToggled ?? localToggled;
	const setToggled = (open: boolean) => {
		setLocalToggled(open);
		setPersistedToggled(open);
		if (open) keepActivityGroupOpen?.();
	};
	const keepActivitySubgroupOpen = () => setToggled(true);

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
		(canBeActive && (segment.requiresAction || hasPendingAsk || hasPendingPermission)) ||
		(toggled ?? (isSettlingSegment || automaticOpen));

	const streamCollapsed = useContext(ActivityStreamContext);

	const meta = getKindMeta(kind);
	const subgroupContext: ActivitySubgroupContextValue = { kind, size: segment.indices.length };

	const active = statusActive;
	const soloPart = segment.indices.length === 1 ? parts[segment.indices[0]!] : undefined;
	const runningTerminalHasCommand =
		kind === "terminal" &&
		segment.running &&
		soloPart?.type === "tool-call" &&
		typeof soloPart.args?.command === "string" &&
		soloPart.args.command.trim().length > 0;

	if (streamCollapsed && !active && !isSettlingSegment) return null;

	// A single label-only activity is fully described by its header. Multiple
	// items need a disclosure for their child list; asking is the exception
	// because its questionnaire renders outside the activity group.
	// While the stream row is collapsed, the parent ActivityGroup owns the icon.
	const labelOnly =
		(LABEL_ONLY_ACTIVITY_KINDS.has(kind) && (kind === "asking" || stats.count === 1)) ||
		(kind !== "thinking" && segment.running && !runningTerminalHasCommand) ||
		(stats.count === 1 &&
			!runningTerminalHasCommand &&
			soloRowHidesItself(kind, parts[segment.indices[0]!]));
	if (labelOnly && streamCollapsed && segment.indices.length <= 1) return null;

	const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);
	const disclosure = !labelOnly && !streamCollapsed;
	const contentOpen = streamCollapsed
		? true
		: labelOnly
			? kind !== "asking" && segment.indices.length > 1
			: open;

	// One element tree whether the subgroup is a bare row, a streamed list or a
	// disclosure: a tool finishing turns its label-only row into a disclosure,
	// and a different tree would remount the rows under it.
	return (
		<ActivitySubgroupContext.Provider value={subgroupContext}>
			<ActivitySubgroupManualOpenContext.Provider value={keepActivitySubgroupOpen}>
				<Collapsible
					open={contentOpen}
					style={
						{
							"--animation-duration": `${SUBGROUP_ANIMATION_DURATION}ms`,
						} as CSSProperties
					}
					onOpenChange={(next) => {
						setToggled(next);
					}}
				>
					{streamCollapsed ? null : disclosure ? (
						<CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex max-w-full items-center gap-2 py-1 text-sm transition-colors">
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
							<span className="min-w-0 truncate font-medium">
								<ActivityLabel label={label} shimmer={segment.running} />
							</span>
							{diffStats ? <DiffCounts {...diffStats} /> : null}
							<ActivityDisclosureIcon open={open} />
						</CollapsibleTrigger>
					) : (
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
							<span className="min-w-0 truncate font-medium">
								<ActivityLabel
									label={label}
									object={kind === "skill" ? (stats.skill ?? "") : undefined}
									shimmer={active}
								/>
							</span>
						</div>
					)}
					<CollapsibleContent
						className={
							disclosure
								? cn(ACTIVITY_CONTENT_ANIMATION, "duration-(--animation-duration)")
								: undefined
						}
					>
						{kind === "thinking" && !labelOnly ? (
							<ThinkingStreamText streaming={segment.running}>{children}</ThinkingStreamText>
						) : (
							<div className="border-border-subtle mt-0.5 mb-1 ml-[12.5px] flex flex-col border-l pl-3">
								{children}
							</div>
						)}
					</CollapsibleContent>
				</Collapsible>
			</ActivitySubgroupManualOpenContext.Provider>
		</ActivitySubgroupContext.Provider>
	);
};

export const ActivitySubgroup = memo(ActivitySubgroupImpl);
ActivitySubgroup.displayName = "ActivitySubgroup";
