import {
	toolInput,
	type OpenCodeThreadState,
	type SessionMessageAssistant,
	type SessionMessageAssistantTool,
} from "@kilo-desktop/react-opencode";

import { isPlanFilePath, normalizePlanPath, pathsMatch } from "./plan-paths";

type Tool = SessionMessageAssistantTool;

export type PlanStatus = "writing" | "ready" | "error";

export type PlanProjection = {
	status: PlanStatus;
	path: string;
	markdown: string;
	error?: string;
	anchorCallId: string;
	hiddenCallIds: ReadonlySet<string>;
};

/** What the plan projection reads of a thread: its transcript and whether it runs. */
export type PlanThreadSource = Pick<OpenCodeThreadState, "messages" | "running" | "runState">;

export type PlanThreadProjection = {
	byMessageId: ReadonlyMap<string, PlanProjection>;
	byAnchorCallId: ReadonlyMap<string, PlanProjection>;
	newest: PlanProjection | undefined;
};

const stringField = (value: Record<string, unknown> | undefined, key: string): string => {
	const candidate = value?.[key];
	return typeof candidate === "string" ? candidate : "";
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const toolMetadata = (tool: Tool): Record<string, unknown> | undefined =>
	"metadata" in tool.state ? asRecord(tool.state.metadata) : undefined;

/** The file a write or edit touches (`input.path`), or the plan a `plan_exit` hands off (`metadata.plan`). */
const getToolPath = (tool: Tool): string =>
	normalizePlanPath(
		tool.name === "plan_exit"
			? stringField(toolMetadata(tool), "plan")
			: stringField(toolInput(tool), "path"),
	);

const getWriteContent = (tool: Tool): string => stringField(toolInput(tool), "content");

const getEditOldString = (tool: Tool): string => stringField(toolInput(tool), "oldString");

const getEditNewString = (tool: Tool): string | undefined => {
	const candidate = toolInput(tool).newString;
	return typeof candidate === "string" ? candidate : undefined;
};

const replaceFirst = (source: string, search: string, replacement: string): string => {
	if (!search) return source;
	const index = source.indexOf(search);
	if (index < 0) return source;
	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
};

export function resolvePlanMarkdownFromWrites(writes: readonly Tool[], priorMarkdown = ""): string {
	let markdown = priorMarkdown;
	for (const tool of writes) {
		if (tool.name === "write") {
			const content = getWriteContent(tool);
			if (content) markdown = content;
			continue;
		}
		const oldString = getEditOldString(tool);
		if (!markdown || !oldString) continue;
		const newString = getEditNewString(tool);
		if (newString === undefined) continue;
		markdown = replaceFirst(markdown, oldString, newString);
	}
	return markdown;
}

const getToolError = (tool: Tool): string =>
	tool.state.status === "error" && tool.state.error.message
		? tool.state.error.message
		: "Kilo could not complete the plan.";

type GetPlanProjectionOptions = {
	priorMarkdown?: string;
	/** Plan-agent markdown writes belong to the plan even when project instructions choose another path. */
	treatWritesAsPlan?: boolean;
	/** The owning assistant run has stopped producing tool updates. */
	settled?: boolean;
};

const isMarkdownPath = (path: string): boolean => /\.md$/i.test(path);

const hasPlanExit = (tools: readonly Tool[]): boolean =>
	tools.some((tool) => tool.name === "plan_exit");

/** The plan a run of tool calls (one assistant turn's, in order) writes and hands off. */
export function getPlanProjectionFromTools(
	tools: readonly Tool[],
	options?: GetPlanProjectionOptions,
): PlanProjection | undefined {
	const treatWritesAsPlan = options?.treatWritesAsPlan === true;
	const exits = tools.filter((tool) => tool.name === "plan_exit");
	// Like Kilo's own clients, the file named by plan_exit is the plan once it is known.
	const handoffPath = exits.map(getToolPath).findLast(Boolean) ?? "";
	const writes = tools.filter((tool) => {
		if (tool.name !== "write" && tool.name !== "edit") return false;
		// A rejected or failed write never changed the file on disk.
		if (tool.state.status === "error") return false;
		const path = getToolPath(tool);
		if (handoffPath) return pathsMatch(path, handoffPath);
		if (isPlanFilePath(path)) return true;
		// Pathless covers a write whose arguments are still streaming.
		return treatWritesAsPlan && (!path || isMarkdownPath(path));
	});
	if (writes.length === 0 && exits.length === 0) return undefined;

	const latestWrite = writes.at(-1);
	const writePath = latestWrite ? getToolPath(latestWrite) : "";
	const latestExit = exits.findLast((tool) => {
		const exitPath = getToolPath(tool);
		return !writePath || !exitPath || pathsMatch(writePath, exitPath);
	});
	const anchor = latestWrite ?? latestExit;
	if (!anchor) return undefined;

	const path = writePath || (latestExit ? getToolPath(latestExit) : "");
	const markdown = resolvePlanMarkdownFromWrites(writes, options?.priorMarkdown ?? "");
	const failedTool = [latestWrite, latestExit].find(
		(tool): tool is Tool => tool?.state.status === "error",
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

	const hiddenCallIds = new Set([...writes, ...exits].map((tool) => tool.id));
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
	if (part.toolName === "todowrite" || part.toolName === "plan_exit") return true;
	if (part.toolName !== "write" && part.toolName !== "edit") return false;
	return isPlanFilePath(stringField(asRecord(part.args), "path"));
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
 * Every v2 model step is its own assistant message; `tool-calls` and
 * `unknown` finishes mean the loop may continue. Mirrors Kilo's clients.
 */
const endsAssistantRun = (step: SessionMessageAssistant): boolean =>
	Boolean(step.error) ||
	(step.finish !== undefined && step.finish !== "tool-calls" && step.finish !== "unknown");

const isPlanningAgent = (agent: string | undefined): boolean => {
	const normalized = agent?.toLowerCase();
	return normalized === "plan" || normalized === "architect";
};

const isRunning = (source: PlanThreadSource): boolean =>
	source.running ||
	source.runState.type === "streaming" ||
	source.runState.type === "cancelling" ||
	source.runState.type === "reverting";

/**
 * Projects a thread's plans once per immutable thread state. A plan belongs to
 * one assistant turn (its consecutive steps, up to the next prompt or the
 * `idle` message that ends it); edits chain onto the plan file's last version.
 */
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
				tools: Tool[];
				planningAgent: boolean;
				settled: boolean;
		  }
		| undefined;

	const projectAssistantRun = () => {
		if (!assistantRun) return;
		const { messageIds, tools, planningAgent, settled } = assistantRun;
		const options = { treatWritesAsPlan: planningAgent || hasPlanExit(tools), settled };
		const initial = getPlanProjectionFromTools(tools, options);
		if (initial) {
			const priorMarkdown = findPriorMarkdown(documents, initial.path);
			const projection = priorMarkdown
				? (getPlanProjectionFromTools(tools, { ...options, priorMarkdown }) ?? initial)
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

	for (const message of source.messages) {
		if (message.type === "user" || message.type === "idle") {
			if (assistantRun) assistantRun.settled = true;
			projectAssistantRun();
			continue;
		}
		// Kilo's own context (synthetic notes, selections) sits inside a turn.
		if (message.type !== "assistant") continue;
		const tools = message.content.filter((item): item is Tool => item.type === "tool");
		if (assistantRun) {
			assistantRun.messageIds.push(message.id);
			assistantRun.tools.push(...tools);
			assistantRun.planningAgent ||= isPlanningAgent(message.agent);
			assistantRun.settled ||= endsAssistantRun(message);
		} else {
			assistantRun = {
				messageIds: [message.id],
				tools,
				planningAgent: isPlanningAgent(message.agent),
				settled: endsAssistantRun(message),
			};
		}
	}
	if (assistantRun && !isRunning(source)) assistantRun.settled = true;
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
