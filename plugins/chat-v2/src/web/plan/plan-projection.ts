import type {
	KiloAssistantContent,
	KiloToolCall,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode-v2";

import { isPlanFilePath, normalizePlanPath, pathsMatch } from "./plan-paths";

export type PlanStatus = "writing" | "ready" | "error";

export type PlanProjection = {
	status: PlanStatus;
	path: string;
	markdown: string;
	error?: string;
	anchorCallId: string;
	hiddenCallIds: ReadonlySet<string>;
};

export type PlanThreadSource = {
	runState?: { type: string } | undefined;
	sessionStatus?: { type: string } | null | undefined;
	messageOrder: readonly string[];
	messagesById: Readonly<Record<string, SessionMessageInfo | undefined>>;
};

export type PlanThreadProjection = {
	byMessageId: ReadonlyMap<string, PlanProjection>;
	byAnchorCallId: ReadonlyMap<string, PlanProjection>;
	newest: PlanProjection | undefined;
};

const stringOf = (value: Record<string, unknown> | undefined, key: string): string | undefined => {
	const candidate = value?.[key];
	return typeof candidate === "string" ? candidate : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

type ToolPart = KiloToolCall;
type Part = KiloAssistantContent;

/** A tool call's input once it is called (`{}` while its arguments still stream). */
const inputOf = (part: ToolPart): Record<string, unknown> =>
	part.state.status === "streaming" ? {} : part.state.input;

/**
 * The file a plan tool call names: `write`'s and `edit`'s `path`, and
 * `plan_exit`'s optional `path`, else the plan it found (its result's
 * `metadata.plan`).
 */
const getToolPath = (part: ToolPart): string => {
	const path = stringOf(inputOf(part), "path");
	if (path) return normalizePlanPath(path);
	const metadata = part.state.status === "streaming" ? undefined : part.state.metadata;
	return normalizePlanPath(stringOf(metadata, "plan") ?? "");
};

/** `write` takes `{ path, content }`. */
const getDirectPlanMarkdown = (part: ToolPart): string =>
	part.name === "write" ? (stringOf(inputOf(part), "content") ?? "") : "";

/** `edit` takes `{ path, oldString, newString }`. */
const getEditOldString = (part: ToolPart): string => stringOf(inputOf(part), "oldString") ?? "";

const getEditNewString = (part: ToolPart): string | undefined =>
	stringOf(inputOf(part), "newString");

const replaceFirst = (source: string, search: string, replacement: string): string => {
	if (!search) return source;
	const index = source.indexOf(search);
	if (index < 0) return source;
	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
};

export function resolvePlanMarkdownFromWrites(
	writes: readonly ToolPart[],
	priorMarkdown = "",
): string {
	let markdown = priorMarkdown;
	for (const part of writes) {
		const direct = getDirectPlanMarkdown(part);
		if (direct) {
			markdown = direct;
			continue;
		}
		if (part.name !== "edit") continue;
		const oldString = getEditOldString(part);
		if (!markdown || !oldString) continue;
		const newString = getEditNewString(part);
		if (newString === undefined) continue;
		markdown = replaceFirst(markdown, oldString, newString);
	}
	return markdown;
}

const getToolError = (part: ToolPart): string =>
	part.state.status === "error" && part.state.error.message
		? part.state.error.message
		: "Kilo could not complete the plan.";

const isToolPart = (part: Part): part is ToolPart => part.type === "tool";

type GetPlanProjectionOptions = {
	priorMarkdown?: string;
	/** Plan-agent markdown writes belong to the plan even when project instructions choose another path. */
	treatWritesAsPlan?: boolean;
	/** The owning assistant run has stopped producing tool updates. */
	settled?: boolean;
};

const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);

const hasPlanExitPart = (parts: readonly Part[]): boolean =>
	parts.some((part) => isToolPart(part) && part.name === "plan_exit");

export function getPlanProjectionFromParts(
	parts: readonly Part[],
	options?: GetPlanProjectionOptions,
): PlanProjection | undefined {
	const treatWritesAsPlan = options?.treatWritesAsPlan === true;
	const tools = parts.filter(isToolPart);
	const exits = tools.filter((part) => part.name === "plan_exit");
	// Like Kilo's own clients, the file named by plan_exit is the plan once it is known.
	const handoffPath = exits.map(getToolPath).findLast(Boolean) ?? "";
	const writes = tools.filter((part) => {
		if (part.name !== "write" && part.name !== "edit") return false;
		// A rejected or failed write never changed the file on disk.
		if (part.state.status === "error") return false;
		const path = getToolPath(part);
		if (handoffPath) return pathsMatch(path, handoffPath);
		if (isPlanFilePath(path)) return true;
		// Pathless covers a write whose arguments are still streaming.
		return treatWritesAsPlan && (!path || isMarkdownPath(path));
	});
	if (writes.length === 0 && exits.length === 0) return undefined;

	const latestWrite = writes.at(-1);
	const writePath = latestWrite ? getToolPath(latestWrite) : "";
	const latestExit = exits.findLast((part) => {
		const exitPath = getToolPath(part);
		return !writePath || !exitPath || pathsMatch(writePath, exitPath);
	});
	const anchor = latestWrite ?? latestExit;
	if (!anchor) return undefined;

	const path = writePath || (latestExit ? getToolPath(latestExit) : "");
	const markdown = resolvePlanMarkdownFromWrites(writes, options?.priorMarkdown ?? "");
	const failedTool = [latestWrite, latestExit].find(
		(part): part is ToolPart => part?.state.status === "error",
	);
	const missingCompletedPayload = latestExit?.state.status === "completed" && !path && !markdown;

	let status: PlanStatus = "writing";
	let error: string | undefined;
	if (failedTool) {
		status = "error";
		error = getToolError(failedTool);
	} else if (missingCompletedPayload) {
		status = "error";
		error = "Kilo completed the plan handoff without a plan path or markdown.";
	} else if (
		latestExit?.state.status === "completed" ||
		(options?.settled === true && latestWrite?.state.status === "completed")
	) {
		status = "ready";
	}

	const hiddenCallIds = new Set([...writes, ...exits].map((part) => part.id));
	return {
		status,
		path,
		markdown,
		anchorCallId: anchor.id,
		hiddenCallIds,
		...(error ? { error } : {}),
	};
}

export type ActivityGroupExclusionPart = {
	toolName?: string | undefined;
	toolCallId?: string | undefined;
	args?: unknown;
};

export function shouldExcludeToolCallFromActivityGroup(
	part: ActivityGroupExclusionPart,
	options?: { hiddenPlanCallIds?: ReadonlySet<string> | undefined },
): boolean {
	if (part.toolCallId && options?.hiddenPlanCallIds?.has(part.toolCallId)) return true;
	const toolName = part.toolName?.toLowerCase();
	if (toolName === "todowrite") return true;
	if (part.toolName === "plan_exit") return true;
	if (part.toolName !== "write" && part.toolName !== "edit") return false;
	const args = asRecord(part.args);
	if (!args) return false;
	return isPlanFilePath(stringOf(args, "path") ?? "");
}

const findPriorMarkdown = (
	documents: readonly { path: string; markdown: string }[],
	path: string,
): string => {
	if (!path) return "";
	for (let index = documents.length - 1; index >= 0; index -= 1) {
		const document = documents[index];
		if (document && pathsMatch(document.path, path)) return document.markdown;
	}
	return "";
};

const planThreadProjectionCache = new WeakMap<PlanThreadSource, PlanThreadProjection>();

/**
 * Every Kilo step is its own message and gets `time.completed`; `tool-calls`
 * and `unknown` finishes mean the loop may continue. Mirrors Kilo's clients.
 */
const endsAssistantRun = (info: { finish?: unknown; error?: unknown }): boolean =>
	Boolean(info.error) ||
	(typeof info.finish === "string" &&
		info.finish.length > 0 &&
		info.finish !== "tool-calls" &&
		info.finish !== "unknown");

const isPlanningAgent = (agent: string | undefined): boolean => agent?.toLowerCase() === "plan";

/** Project Kilo's messages once per immutable thread-state object. */
export function projectPlanThread(source: PlanThreadSource): PlanThreadProjection {
	const cached = planThreadProjectionCache.get(source);
	if (cached) return cached;

	const byMessageId = new Map<string, PlanProjection>();
	const byAnchorCallId = new Map<string, PlanProjection>();
	const documents: Array<{ path: string; markdown: string }> = [];
	let newest: PlanProjection | undefined;
	let assistantRun:
		| {
				messageIds: string[];
				parts: Part[];
				planningAgent: boolean;
				settled: boolean;
		  }
		| undefined;

	const projectAssistantRun = () => {
		if (!assistantRun) return;
		const { messageIds, parts, planningAgent, settled } = assistantRun;
		const hasPlanExit = hasPlanExitPart(parts);
		const options = {
			treatWritesAsPlan: planningAgent || hasPlanExit,
			settled,
		};
		const initial = getPlanProjectionFromParts(parts, options);
		if (initial) {
			const priorMarkdown = findPriorMarkdown(documents, initial.path);
			const projection = priorMarkdown
				? (getPlanProjectionFromParts(parts, { ...options, priorMarkdown }) ?? initial)
				: initial;
			for (const messageId of messageIds) {
				byMessageId.set(messageId, projection);
			}
			byAnchorCallId.set(projection.anchorCallId, projection);
			newest = projection;
			if (projection.path && projection.markdown) {
				documents.push({ path: projection.path, markdown: projection.markdown });
			}
		}
		assistantRun = undefined;
	};

	for (const messageId of source.messageOrder) {
		const message = source.messagesById[messageId];
		if (!message) continue;
		if (message.type !== "assistant") {
			// A prompt, compaction or the turn's end closes the run; Kilo's context notes don't.
			if (message.type === "user" || message.type === "compaction" || message.type === "idle") {
				if (assistantRun) assistantRun.settled = true;
				projectAssistantRun();
			}
			continue;
		}
		if (assistantRun) {
			assistantRun.messageIds.push(messageId);
			assistantRun.parts.push(...message.content);
			assistantRun.planningAgent ||= isPlanningAgent(message.agent);
			assistantRun.settled ||= endsAssistantRun(message);
		} else {
			assistantRun = {
				messageIds: [messageId],
				parts: [...message.content],
				planningAgent: isPlanningAgent(message.agent),
				settled: endsAssistantRun(message),
			};
		}
	}
	if (
		assistantRun &&
		(source.runState !== undefined || source.sessionStatus !== undefined) &&
		source.runState?.type !== "streaming" &&
		source.runState?.type !== "cancelling" &&
		source.runState?.type !== "reverting" &&
		source.sessionStatus?.type !== "busy" &&
		source.sessionStatus?.type !== "retry"
	) {
		assistantRun.settled = true;
	}
	projectAssistantRun();

	const result = { byMessageId, byAnchorCallId, newest };
	planThreadProjectionCache.set(source, result);
	return result;
}

export const getPlanProjectionForMessage = (
	thread: PlanThreadProjection,
	messageId: string,
): PlanProjection | undefined => thread.byMessageId.get(messageId);

export const findNewestPlanProjection = (
	thread: PlanThreadProjection,
): PlanProjection | undefined => thread.newest;

export const findPlanProjectionByAnchorCallId = (
	thread: PlanThreadProjection,
	anchorCallId: string,
): PlanProjection | undefined => thread.byAnchorCallId.get(anchorCallId);

/**
 * The plan the tab should show: the snapshot the user opened, until a newer plan
 * than the one that was newest at open time finishes. Writing revisions never
 * replace what the user is reading; a missing snapshot falls back to newest.
 */
export function resolveDisplayedPlan(
	thread: PlanThreadProjection,
	anchorCallId: string | null,
	newestAnchorCallIdAtOpen: string | null,
): PlanProjection | undefined {
	const pinned = anchorCallId ? thread.byAnchorCallId.get(anchorCallId) : undefined;
	if (!pinned) return thread.newest;
	const baseline = newestAnchorCallIdAtOpen ?? anchorCallId;
	const newest = thread.newest;
	const newerRevisionIsReady = newest?.status === "ready" && newest.anchorCallId !== baseline;
	return newerRevisionIsReady ? newest : pinned;
}

export const isCurrentPlanVersion = (thread: PlanThreadProjection, anchorCallId: string): boolean =>
	!thread.newest || thread.newest.anchorCallId === anchorCallId;
