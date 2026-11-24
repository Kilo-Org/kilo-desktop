import { createContext, useContext, useState, type ReactNode } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { useStableCallback, useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

import { useChatConnection } from "../runtime/chat-connection";
import { directoryClient } from "../runtime/kilo-client";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import {
	childSessionIdFromTaskPart,
	isActiveSubagentStatus,
	subagentDisplayStatus,
	subagentTaskTitle,
	subagentTypeLabel,
} from "./subagent-state";

const record = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const text = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

export type SubagentActivity = {
	childSessionId: string;
	toolCallId: string;
	title: string;
	typeLabel: string;
	status: ReturnType<typeof subagentDisplayStatus>;
	directory?: string | undefined;
};

const NO_ACTIVITIES: readonly SubagentActivity[] = [];

/** Joins task calls (in delegation order) with their child sessions. */
function deriveActivities(
	extras: ReturnType<typeof useOptionalOpenCodeRuntimeExtras>,
): readonly SubagentActivity[] {
	const state = extras?.state;
	if (!state?.messageOrder || !state.messagesById || !state.childSessionsById) {
		return NO_ACTIVITIES;
	}
	const calls = new Map<string, { toolCallId: string; title: string; typeLabel: string }>();
	for (const messageId of state.messageOrder) {
		const message = state.messagesById[messageId];
		for (const part of message?.parts ?? []) {
			const childSessionId = childSessionIdFromTaskPart(part);
			if (!childSessionId) continue;
			const input = record(record(record(part)?.state)?.input);
			const rawPart = record(part);
			const toolCallId = text(rawPart?.callID) || text(rawPart?.id);
			if (!toolCallId) continue;
			const agent = text(input?.subagent_type);
			const title = subagentTaskTitle(part) ?? "Delegated task";
			calls.set(childSessionId, { toolCallId, title, typeLabel: subagentTypeLabel(agent) });
		}
	}
	const activities: SubagentActivity[] = [];
	for (const [childSessionId, call] of calls) {
		const child = state.childSessionsById[childSessionId];
		if (!child) continue;
		activities.push({
			childSessionId,
			...call,
			status: subagentDisplayStatus(child),
			directory: child.session?.directory,
		});
	}
	return activities;
}

const sameActivity = (left: SubagentActivity, right: SubagentActivity) =>
	left.childSessionId === right.childSessionId &&
	left.toolCallId === right.toolCallId &&
	left.title === right.title &&
	left.typeLabel === right.typeLabel &&
	left.status === right.status &&
	left.directory === right.directory;

const sameActivities = (left: readonly SubagentActivity[], right: readonly SubagentActivity[]) =>
	left.length === right.length &&
	left.every((activity, index) => sameActivity(activity, right[index]!));

const isSubagentActive = (activity: SubagentActivity) => isActiveSubagentStatus(activity.status);

export type SubagentStopTarget = Pick<SubagentActivity, "childSessionId" | "directory">;

type Value = {
	activities: readonly SubagentActivity[];
	/** Subagents still working or waiting on input, from any turn. */
	activeActivities: readonly SubagentActivity[];
	activityByToolCallId: ReadonlyMap<string, SubagentActivity>;
	hasActiveSubagents: boolean;
	stoppingIds: ReadonlySet<string>;
	stopSubagent(target: SubagentStopTarget): Promise<void>;
	stopAllSubagents(): Promise<void>;
};
const Context = createContext<Value>({
	activities: [],
	activeActivities: [],
	activityByToolCallId: new Map(),
	hasActiveSubagents: false,
	stoppingIds: new Set(),
	stopSubagent: async () => undefined,
	stopAllSubagents: async () => undefined,
});

export function SubagentActivityProvider({ children }: { children: ReactNode }) {
	const extras = useOptionalOpenCodeRuntimeExtras();
	const { connection } = useChatConnection();
	const chats = useDomainObject(Chats);
	// Extras change with every streamed token; the activities rarely do. Keeping
	// them (and the context value) while unchanged spares every message a render.
	const activities = useStableValue(deriveActivities(extras), sameActivities);
	const activeActivities = activities.filter(isSubagentActive);
	const activityByToolCallId = new Map(
		activities.map((activity) => [activity.toolCallId, activity]),
	);
	const hasActiveSubagents = activeActivities.length > 0;
	const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(() => new Set());
	const parentSessionId = extras?.session?.id;

	// Aborts use the server's default "tree" scope: "session" scope leaves the
	// target's descendants and background jobs running, which then wake the
	// parent back up when they finish. kilo.core stops the chats it knows (in
	// their own folder); others go to the server from here.
	const abortChat = async (sessionID: string, directory: string | undefined) => {
		if (chats?.getState().chats[sessionID]) {
			await chats.methods.abort({ id: sessionID });
			return;
		}
		const target = directory ?? extras?.session?.directory;
		if (!connection || !target) throw new Error();
		await directoryClient(connection, target).session.abort({ sessionID }, { throwOnError: true });
	};
	const abortSessionTree = async (
		sessionID: string,
		directory: string | undefined,
		stoppingSessionIds: readonly string[],
		failureMessage: string,
	) => {
		setStoppingIds((current) => new Set([...current, ...stoppingSessionIds]));
		try {
			await abortChat(sessionID, directory);
		} catch (error) {
			toast.error(error instanceof Error && error.message ? error.message : failureMessage);
		}
		setStoppingIds((current) => {
			const next = new Set(current);
			for (const id of stoppingSessionIds) next.delete(id);
			return next;
		});
	};
	const stopSubagent = useStableCallback((target: SubagentStopTarget) =>
		abortSessionTree(
			target.childSessionId,
			target.directory,
			[target.childSessionId],
			"Could not stop subagent",
		),
	);
	// Stopping the parent's tree also catches subagents the UI does not see as
	// active (stale status, nested subagents) and keeps the parent from resuming.
	const stopAllSubagents = useStableCallback(async () => {
		if (!parentSessionId) {
			await Promise.all(activeActivities.map(stopSubagent));
			return;
		}
		await abortSessionTree(
			parentSessionId,
			extras?.session?.directory,
			activeActivities.map((activity) => activity.childSessionId),
			"Could not stop subagents",
		);
	});
	const value: Value = {
		activities,
		activeActivities,
		activityByToolCallId,
		hasActiveSubagents,
		stoppingIds,
		stopSubagent,
		stopAllSubagents,
	};
	return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useSubagentActivity = () => useContext(Context);
