import {
	createContext,
	memo,
	useContext,
	useMemo,
	useRef,
	useState,
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

const ANIMATION_DURATION = 200;
const MAX_VISIBLE_ICONS = 5;

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
				<AvatarGroupCount className="size-7 text-xs">
					+{items.length - MAX_VISIBLE_ICONS}
				</AvatarGroupCount>
			) : null}
			{visible.map((item, index) => (
				<Avatar key={index} title={item.label} className="size-7">
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

const ActivityLabel: FC<{ label: string; shimmer?: boolean }> = ({ label, shimmer = false }) => {
	const split = label.indexOf(" ");
	const verb = split === -1 ? label : label.slice(0, split);
	const object = split === -1 ? null : label.slice(split + 1);
	return (
		<span className="relative inline-block">
			{verb}
			{object !== null ? (
				<>
					{" "}
					<span className="opacity-60">{object}</span>
				</>
			) : null}
			{shimmer ? (
				<span
					aria-hidden
					className="shimmer pointer-events-none absolute top-0 left-0 motion-reduce:animate-none"
				>
					{verb}
				</span>
			) : null}
		</span>
	);
};

const contentAnimation =
	"data-closed:animate-collapsible-up data-open:animate-collapsible-down overflow-hidden data-closed:ease-out data-open:ease-in";

const ActivityStreamContext = createContext(false);

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

	const [open, setOpen] = useState(false);
	const [streamExpanded, setStreamExpanded] = useState(false);

	const collapsibleRef = useRef<HTMLDivElement>(null);
	const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

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

	if (summary.toolCount === 0) {
		return (
			<div data-slot="activity-group" className={cn(textBefore && "mt-4", textAfter && "mb-4")}>
				{children}
			</div>
		);
	}

	// Only the activity group that owns the in-flight questionnaire should look
	// "live". Message-level requires-action alone would spin every prior Asking.
	const streaming = messageStatusType === "running" || summary.requiresAction || hasPendingAsk;
	const activeSegment = [...summary.segments]
		.reverse()
		.find(
			(segment) =>
				segment.running || segment.requiresAction || (hasPendingAsk && segment.kind === "asking"),
		);
	const activeLoading = Boolean(
		activeSegment?.running ||
		activeSegment?.requiresAction ||
		(hasPendingAsk && activeSegment?.kind === "asking"),
	);

	const askOnly =
		summary.segments.length > 0 && summary.segments.every((segment) => segment.kind === "asking");

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
		const headerClassName =
			"text-muted-foreground flex items-center gap-2 py-1 text-sm transition-colors";
		const header = (
			<>
				<ActivityIconStack items={stackItems} className="-space-x-1" />
				<span className="font-medium">
					<ActivityLabel label={label} shimmer={activeLoading} />
				</span>
			</>
		);
		// Ask-only groups answer in the composer Questionnaire — no nested tool
		// chrome to expand, so don't pretend this row is collapsible.
		if (askOnly) {
			return (
				<div data-slot="activity-group" className={cn(textBefore && "mt-4", textAfter && "mb-4")}>
					<div className={headerClassName}>{header}</div>
				</div>
			);
		}
		return (
			<div data-slot="activity-group" className={cn(textBefore && "mt-4", textAfter && "mb-4")}>
				<button
					type="button"
					onClick={() => {
						setStreamExpanded(true);
						setOpen(true);
					}}
					className={cn(headerClassName, "hover:text-foreground")}
				>
					{header}
					<ChevronDownIcon className="size-3.5 shrink-0" />
				</button>
				<ActivityStreamContext.Provider value={true}>
					<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
				</ActivityStreamContext.Provider>
			</div>
		);
	}

	if (askOnly) {
		return (
			<div data-slot="activity-group" className={cn(textBefore && "mt-4", textAfter && "mb-4")}>
				{children}
			</div>
		);
	}

	return (
		<div data-slot="activity-group" className={cn(textBefore && "mt-4", textAfter && "mb-4")}>
			<Collapsible
				ref={collapsibleRef}
				open={open}
				onOpenChange={(next) => {
					lockScroll();
					setOpen(next);
					if (!next) setStreamExpanded(false);
				}}
			>
				<CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 py-1 text-sm transition-colors">
					{open ? (
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
				<CollapsibleContent className={contentAnimation}>
					<div className="mt-1 flex flex-col gap-0.5 pb-1">{children}</div>
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
		const indices = [...group.indices];
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
			ownsPendingAsk(parts, group.indices, pendingQuestions, messageRequiresAction),
		[kind, parts, group.indices, pendingQuestions, messageRequiresAction],
	);

	const [toggled, setToggled] = useState<boolean | null>(null);
	const open = segment.requiresAction || hasPendingAsk || (toggled ?? segment.running);

	const collapsibleRef = useRef<HTMLDivElement>(null);
	const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

	const streamCollapsed = useContext(ActivityStreamContext);

	const meta = getKindMeta(kind);
	const stats = useMemo(() => getSegmentStats(parts, segment), [parts, segment]);
	const subgroupContext = useMemo<ActivitySubgroupContextValue>(
		() => ({ kind, size: group.indices.length }),
		[kind, group.indices.length],
	);

	const active = segment.running || segment.requiresAction || hasPendingAsk;

	if (streamCollapsed && !active) return null;

	if (kind === "tools" && group.indices.length === 1) {
		return (
			<ActivitySubgroupContext.Provider value={subgroupContext}>
				{children}
			</ActivitySubgroupContext.Provider>
		);
	}

	// Question tools are answered in the composer Questionnaire — the subgroup
	// label is the only message-stream chrome (Asking / Asked …). While the
	// stream row is collapsed, the parent ActivityGroup owns the ask icon.
	if (kind === "asking") {
		if (streamCollapsed) return null;
		const label = active ? meta.liveLabel(stats) : meta.doneLabel(stats);
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
						<ActivityLabel label={label} shimmer={active} />
					</span>
				</div>
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
						className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
					/>
				</CollapsibleTrigger>
				<CollapsibleContent className={contentAnimation}>
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
