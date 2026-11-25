import type {
	KiloAssistantContent,
	KiloToolCall,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode-v2";

import type { TaskItem, TaskStatus } from "./task-list";

export type TaskThreadSource = {
	runState?: { type: string } | undefined;
	sessionStatus?: { type: string } | null | undefined;
	messageOrder: readonly string[];
	messagesById: Readonly<Record<string, SessionMessageInfo | undefined>>;
};

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

const isTaskWrite = (item: KiloAssistantContent): item is KiloToolCall =>
	item.type === "tool" && item.name.toLowerCase() === "todowrite";

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

/** Projects replacement-style task writes into the latest complete working-list snapshot. */
export function projectTaskThread(source: TaskThreadSource): TaskThreadProjection | undefined {
	if (taskThreadProjectionCache.has(source)) return taskThreadProjectionCache.get(source);
	const hasLifecycleState = source.runState !== undefined || source.sessionStatus !== undefined;
	const active =
		source.runState?.type === "streaming" ||
		source.runState?.type === "cancelling" ||
		source.runState?.type === "reverting" ||
		source.sessionStatus?.type === "busy" ||
		source.sessionStatus?.type === "retry";
	if (hasLifecycleState && !active) {
		taskThreadProjectionCache.set(source, undefined);
		return undefined;
	}

	let projection: TaskThreadProjection | undefined;
	for (const messageId of source.messageOrder) {
		const message = source.messagesById[messageId];
		if (!message) continue;
		if (message.type !== "assistant") {
			// A prompt starts a new list; Kilo's context notes and markers don't.
			if (message.type === "user") projection = undefined;
			continue;
		}
		for (const item of message.content) {
			if (!isTaskWrite(item)) continue;
			const input = item.state.status === "streaming" ? undefined : item.state.input;
			const items = isRecord(input) ? parseTaskItems(input.todos) : undefined;
			if (!items) continue;
			projection = { items };
		}
	}

	taskThreadProjectionCache.set(source, projection);
	return projection;
}
