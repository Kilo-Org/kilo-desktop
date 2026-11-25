import { createContext, useContext, useState, type ReactNode } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { useStableCallback, useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

import { useChatConnection } from "../runtime/chat-connection";
import { kiloClient } from "../runtime/kilo-client";
import { kiloThreadToolCalls } from "../runtime/kilo-transcript";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import {
	childSessionIdFromTaskPart,
	isActiveSubagentStatus,
	subagentDisplayStatus,
	subagentTaskTitle,
	subagentTypeLabel,
} from "./subagent-state";

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

/** Joins subagent calls (in delegation order) with their child sessions. */
function deriveActivities(
	extras: ReturnType<typeof useOptionalOpenCodeRuntimeExtras>,
): readonly SubagentActivity[] {
	const state = extras?.state;
	if (!state?.messageOrder || !state.messagesById || !state.childSessionsById) {
		return NO_ACTIVITIES;
	}
	const calls = new Map<string, { toolCallId: string; title: string; typeLabel: string }>();
	for (const tool of kiloThreadToolCalls(state)) {
		const childSessionId = childSessionIdFromTaskPart(tool);
		if (!childSessionId) continue;
		const input = tool.state.status === "streaming" ? undefined : tool.state.input;
		const title = subagentTaskTitle(tool) ?? "Delegated task";
		calls.set(childSessionId, {
			toolCallId: tool.id,
			title,
			typeLabel: subagentTypeLabel(text(input?.agent)),
		});
	}
	const activities: SubagentActivity[] = [];
	for (const [childSessionId, call] of calls) {
		const child = state.childSessionsById[childSessionId];
		if (!child) continue;
		activities.push({
			childSessionId,
			...call,
			status: subagentDisplayStatus(child),
			directory: child.session?.location.directory,
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

	// kilo.core stops the chats it knows; others are interrupted from here.
	const abortChat = async (sessionID: string) => {
		if (chats?.getState().chats[sessionID]) {
			await chats.methods.abort({ id: sessionID });
			return;
		}
		if (!connection) throw new Error();
		await kiloClient(connection).session.interrupt({ sessionID });
	};
	const abortSessionTree = async (
		sessionID: string,
		stoppingSessionIds: readonly string[],
		failureMessage: string,
	) => {
		setStoppingIds((current) => new Set([...current, ...stoppingSessionIds]));
		try {
			await abortChat(sessionID);
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
		abortSessionTree(target.childSessionId, [target.childSessionId], "Could not stop subagent"),
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
