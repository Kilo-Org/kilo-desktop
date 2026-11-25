import { toolInput, type OpenCodeThreadState } from "@kilo-desktop/react-opencode";

import type { TaskItem, TaskStatus } from "./task-list";

/** What the task projection reads of a thread: its transcript and whether it runs. */
export type TaskThreadSource = Pick<OpenCodeThreadState, "messages" | "running" | "runState">;

export type TaskThreadProjection = {
	items: readonly TaskItem[];
};

const STATUS_MAP: Readonly<Record<string, TaskStatus | undefined>> = {
	pending: "pending",
	in_progress: "active",
	completed: "done",
	cancelled: "cancelled",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseTaskItems = (value: unknown): readonly TaskItem[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const items: TaskItem[] = [];
	for (const [index, candidate] of value.entries()) {
		if (!isRecord(candidate)) return undefined;
		const { content, status } = candidate;
		if (typeof content !== "string" || content.length === 0 || typeof status !== "string") {
			return undefined;
		}
		const mappedStatus = STATUS_MAP[status];
		if (!mappedStatus) return undefined;
		items.push({ id: `task-${index}`, text: content, status: mappedStatus });
	}
	return items;
};

const taskThreadProjectionCache = new WeakMap<TaskThreadSource, TaskThreadProjection | undefined>();

const isRunning = (source: TaskThreadSource): boolean =>
	source.running ||
	source.runState.type === "streaming" ||
	source.runState.type === "cancelling" ||
	source.runState.type === "reverting";

/**
 * The running turn's working list: its latest complete `todowrite` snapshot
 * (each call replaces the list). Nothing once the session stops, or before
 * the current turn (from its prompt) has written one.
 */
export function projectTaskThread(source: TaskThreadSource): TaskThreadProjection | undefined {
	if (taskThreadProjectionCache.has(source)) return taskThreadProjectionCache.get(source);
	if (!isRunning(source)) {
		taskThreadProjectionCache.set(source, undefined);
		return undefined;
	}

	let projection: TaskThreadProjection | undefined;
	for (const message of source.messages) {
		if (message.type === "user" || message.type === "idle") {
			projection = undefined;
			continue;
		}
		if (message.type !== "assistant") continue;
		for (const item of message.content) {
			if (item.type !== "tool" || item.name !== "todowrite") continue;
			const items = parseTaskItems(toolInput(item).todos);
			if (items) projection = { items };
		}
	}

	taskThreadProjectionCache.set(source, projection);
	return projection;
}
