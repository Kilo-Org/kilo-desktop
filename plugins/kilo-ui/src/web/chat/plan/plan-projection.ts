import { isPlanFilePath, normalizePlanPath, pathsMatch } from "./plan-paths.js";

export type PlanStatus = "writing" | "ready" | "error";

export type PlanProjection = {
	status: PlanStatus;
	path: string;
	markdown: string;
	error?: string;
	anchorCallId: string;
	hiddenCallIds: ReadonlySet<string>;
};

type ToolPartLike = {
	type?: unknown;
	tool?: unknown;
	callID?: unknown;
	id?: unknown;
	state?: {
		status?: unknown;
		input?: unknown;
		error?: unknown;
		metadata?: unknown;
	};
};

export type PlanMessageLike = {
	role?: string | undefined;
	metadata?: { custom?: { opencode?: { parts?: unknown } } } | undefined;
};

type MessageLike = PlanMessageLike;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getString = (value: unknown, keys: readonly string[]): string => {
	if (!isRecord(value)) return "";
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	return "";
};

const getCallId = (part: ToolPartLike): string => {
	if (typeof part.callID === "string" && part.callID.length > 0) return part.callID;
	if (typeof part.id === "string" && part.id.length > 0) return part.id;
	return "";
};

const getToolPath = (part: ToolPartLike): string => {
	const input = part.state?.input;
	const directPath = getString(input, ["filePath", "filepath", "path", "file_path", "file"]);
	if (directPath) return normalizePlanPath(directPath);

	if (isRecord(input)) {
		const nested = getString(input.metadata, ["plan", "path"]);
		if (nested) return normalizePlanPath(nested);
	}

	return normalizePlanPath(getString(part.state?.metadata, ["plan", "path"]));
};

/** Full-document markdown fields (write tool). Edits use old/new strings instead. */
const getDirectPlanMarkdown = (part: ToolPartLike): string =>
	getString(part.state?.input, ["content", "contents", "text", "markdown"]);

const getEditOldString = (part: ToolPartLike): string =>
	getString(part.state?.input, ["oldString", "old_string", "oldText", "old_text"]);

const getEditNewString = (part: ToolPartLike): string => {
	const input = part.state?.input;
	if (!isRecord(input)) return "";
	for (const key of ["newString", "new_string", "newText", "new_text"] as const) {
		const candidate = input[key];
		if (typeof candidate === "string") return candidate;
	}
	return "";
};

const replaceFirst = (source: string, search: string, replacement: string): string => {
	if (!search) return source;
	const index = source.indexOf(search);
	if (index < 0) return source;
	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
};

/**
 * Reconstruct plan markdown from write + edit tool parts.
 * Follow-ups often `edit` the plan file (old/new strings) instead of rewriting full content.
 */
export function resolvePlanMarkdownFromWrites(
	writes: readonly ToolPartLike[],
	priorMarkdown = "",
): string {
	let markdown = priorMarkdown;
	for (const part of writes) {
		const direct = getDirectPlanMarkdown(part);
		if (direct) {
			markdown = direct;
			continue;
		}
		if (part.tool !== "edit") continue;
		const oldString = getEditOldString(part);
		const newString = getEditNewString(part);
		if (!markdown || !oldString) continue;
		markdown = replaceFirst(markdown, oldString, newString);
	}
	return markdown;
}

const getToolError = (part: ToolPartLike): string => {
	const error = part.state?.status === "error" ? part.state.error : undefined;
	if (typeof error === "string" && error.length > 0) return error;
	return getString(error, ["message", "name"]) || "Kilo could not complete the plan.";
};

const isPendingTool = (part: ToolPartLike): boolean =>
	part.state?.status !== "completed" && part.state?.status !== "error";

const isToolPart = (part: unknown): part is ToolPartLike =>
	isRecord(part) && part.type === "tool" && typeof part.tool === "string";

type GetPlanProjectionOptions = {
	priorMarkdown?: string;
	/**
	 * When true, pending write/edit tools with no path yet are treated as plan
	 * writes (shows "Writing Plan" before args stream). Must stay false after a
	 * ready plan exists — otherwise post-approve code writes flash a plan card.
	 */
	treatPathlessPendingWritesAsPlan?: boolean;
};

const hasPlanExitPart = (parts: unknown): boolean => {
	if (!Array.isArray(parts)) return false;
	return parts.some((part) => isToolPart(part) && part.tool === "plan_exit");
};

const hasCompletedPlanExit = (message: MessageLike): boolean => {
	const parts = message.metadata?.custom?.opencode?.parts;
	if (!Array.isArray(parts)) return false;
	return parts.some(
		(part) => isToolPart(part) && part.tool === "plan_exit" && part.state?.status === "completed",
	);
};

/**
 * Project plan-writing / plan_exit tool parts into a single UI card model.
 * Hides plan-file write/edit and plan_exit rows in favor of the card.
 */
export function getPlanProjectionFromParts(
	parts: unknown,
	options?: GetPlanProjectionOptions,
): PlanProjection | undefined {
	if (!Array.isArray(parts)) return undefined;

	const treatPathlessPendingWritesAsPlan = options?.treatPathlessPendingWritesAsPlan === true;
	const tools = parts.filter(isToolPart);
	const writes = tools.filter((part) => {
		if (part.tool !== "write" && part.tool !== "edit") return false;
		const path = getToolPath(part);
		return (
			isPlanFilePath(path) || (treatPathlessPendingWritesAsPlan && !path && isPendingTool(part))
		);
	});
	const exits = tools.filter((part) => part.tool === "plan_exit");
	if (writes.length === 0 && exits.length === 0) return undefined;

	const latestWrite = writes.at(-1);
	const writePath = latestWrite ? getToolPath(latestWrite) : "";
	const latestExit = [...exits].reverse().find((part) => {
		const exitPath = getToolPath(part);
		return !writePath || !exitPath || pathsMatch(writePath, exitPath);
	});

	const anchor = latestWrite ?? latestExit;
	if (!anchor) return undefined;

	const anchorCallId = getCallId(anchor);
	if (!anchorCallId) return undefined;

	const path = writePath || (latestExit ? getToolPath(latestExit) : "");
	const markdown = resolvePlanMarkdownFromWrites(writes, options?.priorMarkdown ?? "");
	const failedTool = [latestWrite, latestExit].find((part) => part?.state?.status === "error");
	const missingCompletedPayload = latestExit?.state?.status === "completed" && !path && !markdown;

	let status: PlanStatus = "writing";
	let error: string | undefined;
	if (failedTool) {
		status = "error";
		error = getToolError(failedTool);
	} else if (missingCompletedPayload) {
		status = "error";
		error = "Kilo completed the plan handoff without a plan path or markdown.";
	} else if (latestExit?.state?.status === "completed") {
		status = "ready";
	}

	const hiddenCallIds = new Set<string>();
	for (const part of [...writes, ...exits]) {
		const callId = getCallId(part);
		if (callId) hiddenCallIds.add(callId);
	}

	return {
		status,
		path,
		markdown,
		anchorCallId,
		hiddenCallIds,
		...(error ? { error } : {}),
	};
}

export type ActivityGroupExclusionPart = {
	toolName?: string | undefined;
	toolCallId?: string | undefined;
	args?: unknown;
};

/**
 * Plan-projected tool calls must stay outside activity subgroups so PlanCard
 * never nests under Writing/Editing chrome. Prefer `hiddenPlanCallIds` (same
 * set PlanAwareToolUI uses); fall back to path / plan_exit when projection
 * isn't available yet.
 */
export function shouldExcludeToolCallFromActivityGroup(
	part: ActivityGroupExclusionPart,
	options?: { hiddenPlanCallIds?: ReadonlySet<string> | undefined },
): boolean {
	if (part.toolCallId && options?.hiddenPlanCallIds?.has(part.toolCallId)) {
		return true;
	}
	const toolName = part.toolName;
	if (toolName === "plan_exit") return true;
	if (toolName !== "write" && toolName !== "edit") return false;
	if (!isRecord(part.args)) return false;
	const path = getString(part.args, ["filePath", "filepath", "path", "file_path", "file"]);
	return isPlanFilePath(path);
}

/**
 * Reconstruct plan markdown by walking earlier messages in order.
 * Follow-up turns often only `edit` the plan, so each turn is applied onto the prior document.
 */
export function findPriorPlanMarkdown(messages: readonly MessageLike[], path: string): string {
	if (!path) return "";
	let markdown = "";
	for (const message of messages) {
		if (!message || message.role === "user") continue;
		const parts = message.metadata?.custom?.opencode?.parts;
		const projection = getPlanProjectionFromParts(parts, { priorMarkdown: markdown });
		if (!projection) continue;
		if (projection.path && !pathsMatch(projection.path, path)) continue;
		if (projection.markdown) markdown = projection.markdown;
	}
	return markdown;
}

type MessageWithId = MessageLike & { id?: string };

/**
 * Pathless pending writes may be plan drafts only before the first ready plan,
 * or when this turn already includes plan_exit (refine / plan handoff).
 */
function shouldTreatPathlessPendingWritesAsPlan(
	messages: readonly MessageLike[],
	index: number,
	parts: unknown,
): boolean {
	const priorHasReadyPlan = messages.slice(0, index).some(hasCompletedPlanExit);
	return !priorHasReadyPlan || hasPlanExitPart(parts);
}

/**
 * Project the plan from a single message index, enriching edit-only turns
 * with markdown reconstructed from earlier messages.
 */
export function getPlanProjectionAtMessageIndex(
	messages: readonly MessageLike[],
	index: number,
): PlanProjection | undefined {
	const message = messages[index];
	if (!message || message.role === "user") return undefined;
	const parts = message.metadata?.custom?.opencode?.parts;
	const treatPathlessPendingWritesAsPlan = shouldTreatPathlessPendingWritesAsPlan(
		messages,
		index,
		parts,
	);
	const base = getPlanProjectionFromParts(parts, { treatPathlessPendingWritesAsPlan });
	if (!base) return undefined;
	if (base.markdown) return base;
	const priorMarkdown = findPriorPlanMarkdown(messages.slice(0, index), base.path);
	if (!priorMarkdown) return base;
	return (
		getPlanProjectionFromParts(parts, {
			priorMarkdown,
			treatPathlessPendingWritesAsPlan,
		}) ?? base
	);
}

/** Resolve the plan projection for a thread message id (used by PlanAwareToolUI). */
export function getPlanProjectionForMessage(
	messages: readonly MessageWithId[],
	messageId: string,
): PlanProjection | undefined {
	const index = messages.findIndex((message) => message.id === messageId);
	if (index < 0) return undefined;
	return getPlanProjectionAtMessageIndex(messages, index);
}

/**
 * Newest plan projection anywhere in the thread (skips user messages; does not stop at them).
 * Use to decide which plan version is current after refinements.
 */
export function findNewestPlanProjection(
	messages: readonly MessageLike[],
): PlanProjection | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const projection = getPlanProjectionAtMessageIndex(messages, index);
		if (projection) return projection;
	}
	return undefined;
}

/** Resolve a historical plan snapshot by the tool-call id that anchors its card. */
export function findPlanProjectionByAnchorCallId(
	messages: readonly MessageLike[],
	anchorCallId: string,
): PlanProjection | undefined {
	if (!anchorCallId) return undefined;
	for (let index = 0; index < messages.length; index += 1) {
		const projection = getPlanProjectionAtMessageIndex(messages, index);
		if (projection?.anchorCallId === anchorCallId) return projection;
	}
	return undefined;
}

/** True when this anchor is the newest plan version in the thread (or no newer plan exists). */
export function isCurrentPlanVersion(
	messages: readonly MessageLike[],
	anchorCallId: string,
): boolean {
	const newest = findNewestPlanProjection(messages);
	return !newest || newest.anchorCallId === anchorCallId;
}
