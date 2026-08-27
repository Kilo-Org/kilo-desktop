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
} from "react";
import { useAuiState, useScrollLock } from "@assistant-ui/react";
import { useOpenCodeQuestions } from "@assistant-ui/react-opencode";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";

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
	summarizeActivity,
	type ActivityIconItem,
	type ActivityKind,
	type ActivityPart,
	type ActivitySegment,
} from "./tool-categories.js";

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
		<AvatarGroup className={className}>
			{overflow ? (
				<AvatarGroupCount className="size-6.5 text-xs">
					+{items.length - MAX_VISIBLE_ICONS}
				</AvatarGroupCount>
			) : null}
			{visible.map((item, index) => (
				<Avatar key={index} title={item.label} className="size-6.5">
					<AvatarFallback
						className={cn(
							"relative border-2",
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

const contentAnimation =
	"h-(--collapsible-panel-height) overflow-hidden transition-[height] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

const useDelayedActivityOpen = (
	active: boolean,
	enabled: boolean,
	onCollapse: () => void,
): boolean => {
	const [heldOpen, setHeldOpen] = useState(active);
	const onCollapseRef = useRef(onCollapse);
	onCollapseRef.current = onCollapse;

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
			onCollapseRef.current();
			setHeldOpen(false);
		}, AUTO_COLLAPSE_DELAY);

		return () => clearTimeout(timeout);
	}, [active, enabled, heldOpen]);

	return enabled && (active || heldOpen);
};

const ActivityStreamContext = createContext(false);
const ActivitySettlingKindContext = createContext<ActivityKind | null>(null);

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

	const collapsibleRef = useRef<HTMLDivElement>(null);
	const lockScroll = useScrollLock(collapsibleRef, GROUP_ANIMATION_DURATION);
	const activeSegment = [...summary.segments]
		.reverse()
		.find(
			(segment) =>
				segment.running || segment.requiresAction || (hasPendingAsk && segment.kind === "asking"),
		);
	// Only the activity group that owns the in-flight questionnaire should look
	// "live". The message can remain running between tools while it considers
	// its next step, but that gap should settle the tool group that just finished.
	const streaming = activeSegment !== undefined;
	const automaticOpen = useDelayedActivityOpen(
		streaming,
		summary.segments.length > 1 && userOpen === null,
		lockScroll,
	);
	const open = userOpen ?? automaticOpen;
	const lastActiveKindRef = useRef<ActivityKind | null>(null);

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
	if (activeSegment) lastActiveKindRef.current = activeSegment.kind;
	const compactKind = !streaming && userOpen !== true ? lastActiveKindRef.current : null;
	const settlingKind = automaticOpen ? compactKind : null;
	const settlingSegment = settlingKind
		? summary.segments.find((segment) => segment.kind === settlingKind)
		: undefined;
	const settlingIndex = settlingSegment ? summary.segments.indexOf(settlingSegment) : -1;

	if (streaming && !streamExpanded) {
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
					<ChevronDownIcon className="size-3.5 shrink-0" />
				</button>
				<ActivityStreamContext.Provider value={true}>
					<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
				</ActivityStreamContext.Provider>
			</div>
		);
	}

	return (
		<div data-slot="activity-group" className={cn(textBefore && "mt-3", textAfter && "mb-3")}>
			<Collapsible
				ref={collapsibleRef}
				open={open}
				style={
					{
						"--animation-duration": `${GROUP_ANIMATION_DURATION}ms`,
					} as CSSProperties
				}
				onOpenChange={(next) => {
					lockScroll();
					setUserOpen(next);
					if (!next) setStreamExpanded(false);
				}}
			>
				<CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 py-1 text-sm transition-colors">
					{settlingSegment ? (
						<>
							<ActivityIconStack
								items={summary.iconItems.map((item, index) => ({
									...item,
									colored: index === settlingIndex,
									loading: false,
								}))}
								className="-space-x-1"
							/>
							<span className="font-medium">
								<ActivityLabel
									label={getKindMeta(settlingSegment.kind).doneLabel(
										getSegmentStats(parts, settlingSegment),
									)}
								/>
							</span>
							<ChevronDownIcon className="size-3.5 shrink-0" />
						</>
					) : open ? (
						<>
							<span className="font-medium">Show less</span>
							<ChevronUpIcon className="size-3.5 shrink-0" />
						</>
					) : (
						<>
							<ActivityIconStack items={summary.iconItems} className="-space-x-1" />
							<span className="font-medium">
								<ActivityLabel label={summary.label} />
							</span>
							<ChevronDownIcon className="size-3.5 shrink-0" />
						</>
					)}
				</CollapsibleTrigger>
				<CollapsibleContent className={cn(contentAnimation, "duration-(--animation-duration)")}>
					<ActivitySettlingKindContext.Provider value={compactKind}>
						<ActivityStreamContext.Provider value={compactKind !== null}>
							<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
						</ActivityStreamContext.Provider>
					</ActivitySettlingKindContext.Provider>
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

	const collapsibleRef = useRef<HTMLDivElement>(null);
	const lockScroll = useScrollLock(collapsibleRef, SUBGROUP_ANIMATION_DURATION);
	const statusActive = segment.running || segment.requiresAction || hasPendingAsk;
	const automaticOpen = useDelayedActivityOpen(statusActive, toggled === null, lockScroll);
	const settlingKind = useContext(ActivitySettlingKindContext);
	const open =
		segment.requiresAction ||
		hasPendingAsk ||
		(toggled ?? (settlingKind === kind || automaticOpen));

	const streamCollapsed = useContext(ActivityStreamContext);

	const meta = getKindMeta(kind);
	const stats = useMemo(() => getSegmentStats(parts, segment), [parts, segment]);
	const subgroupContext = useMemo<ActivitySubgroupContextValue>(
		() => ({ kind, size: segment.indices.length }),
		[kind, segment.indices.length],
	);

	const active = segment.running || segment.requiresAction || hasPendingAsk;

	if (streamCollapsed && !active && settlingKind !== kind) return null;

	// A single label-only activity is fully described by its header. Multiple
	// items need a disclosure for their child list; asking is the exception
	// because its questionnaire renders outside the activity group.
	// While the stream row is collapsed, the parent ActivityGroup owns the icon.
	const labelOnly =
		(LABEL_ONLY_ACTIVITY_KINDS.has(kind) &&
			(kind === "asking" || kind === "suggesting" || stats.count === 1)) ||
		(kind === "subagent" && stats.count === 1 && segment.running);
	if (labelOnly) {
		if (streamCollapsed) return null;
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
					<div className="border-border/60 mt-0.5 mb-1 ml-3.5 flex flex-col border-l pl-3">
						{children}
					</div>
				) : null}
			</ActivitySubgroupContext.Provider>
		);
	}

	if (streamCollapsed) {
		return (
			<ActivitySubgroupContext.Provider value={subgroupContext}>
				<div
					className={cn(
						"border-border/60 mt-0.5 mb-1 ml-3.5 flex flex-col border-l pl-3",
						kind === "thinking" && "text-muted-foreground text-sm",
					)}
				>
					{children}
				</div>
			</ActivitySubgroupContext.Provider>
		);
	}

	const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);

	return (
		<ActivitySubgroupContext.Provider value={subgroupContext}>
			<Collapsible
				ref={collapsibleRef}
				open={open}
				style={
					{
						"--animation-duration": `${SUBGROUP_ANIMATION_DURATION}ms`,
					} as CSSProperties
				}
				onOpenChange={(next) => {
					lockScroll();
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
								loading: segment.running,
							},
						]}
					/>
					<span className="font-medium">
						<ActivityLabel label={label} shimmer={segment.running} />
					</span>
					<ChevronRightIcon
						className={cn(
							"size-3.5 shrink-0 transition-transform duration-(--animation-duration)",
							open && "rotate-90",
						)}
					/>
				</CollapsibleTrigger>
				<CollapsibleContent className={cn(contentAnimation, "duration-(--animation-duration)")}>
					<div
						className={cn(
							"border-border/60 mt-0.5 mb-1 ml-3.5 flex flex-col border-l pl-3",
							kind === "thinking" && "text-muted-foreground text-sm",
						)}
					>
						{children}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</ActivitySubgroupContext.Provider>
	);
};

export const ActivitySubgroup = memo(ActivitySubgroupImpl);
ActivitySubgroup.displayName = "ActivitySubgroup";
