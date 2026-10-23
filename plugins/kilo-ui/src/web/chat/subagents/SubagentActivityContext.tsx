import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import { useSessionActivity } from "../../session/activity/SessionActivityProvider.js";
import {
	childSessionIdFromTaskPart,
	isActiveSubagentStatus,
	subagentDisplayStatus,
	subagentTaskTitle,
	subagentTypeLabel,
} from "./subagent-state.js";

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
	const { connection, connectionPromise } = useChatConnection();
	const activities = useMemo(() => deriveActivities(extras), [extras]);
	const activeActivities = useMemo(() => activities.filter(isSubagentActive), [activities]);
	const activityByToolCallId = useMemo(
		() => new Map(activities.map((activity) => [activity.toolCallId, activity])),
		[activities],
	);
	const hasActiveSubagents = activeActivities.length > 0;
	const applyActivityEvent = useSessionActivity((state) => state.applyEvent);
	const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(() => new Set());
	const parentSessionId = extras?.session?.id;
	const parentState = extras?.state;
	const parentSessionStatus = parentState?.sessionStatus?.type;
	const parentIsWorking =
		parentState?.sessionStatus?.type === "busy" ||
		parentState?.sessionStatus?.type === "retry" ||
		parentState?.runState?.type === "streaming" ||
		parentState?.runState?.type === "cancelling" ||
		parentState?.runState?.type === "reverting";
	const parentBaseStatus =
		parentSessionStatus === "retry" ? "retry" : parentIsWorking ? "busy" : "idle";
	const parentBaseStatusById = useRef(new Map<string, "busy" | "retry" | "idle">());
	if (parentSessionId) parentBaseStatusById.current.set(parentSessionId, parentBaseStatus);

	useEffect(() => {
		if (!parentSessionId) return;
		return () => {
			applyActivityEvent({
				type: "session.status",
				properties: {
					sessionID: parentSessionId,
					status: { type: parentBaseStatusById.current.get(parentSessionId) ?? "idle" },
				},
			} as never);
		};
	}, [applyActivityEvent, parentSessionId]);
	useEffect(() => {
		if (!parentSessionId) return;
		applyActivityEvent({
			type: "session.status",
			properties: {
				sessionID: parentSessionId,
				status: { type: parentIsWorking || hasActiveSubagents ? "busy" : "idle" },
			},
		} as never);
	}, [applyActivityEvent, hasActiveSubagents, parentIsWorking, parentSessionId]);
	// Aborts use the server's default "tree" scope: "session" scope leaves the
	// target's descendants and background jobs running, which then wake the
	// parent back up when they finish.
	const abortSessionTree = async (
		sessionID: string,
		directory: string | undefined,
		stoppingSessionIds: readonly string[],
		failureMessage: string,
	) => {
		setStoppingIds((current) => new Set([...current, ...stoppingSessionIds]));
		try {
			const resolved = connection ?? (await connectionPromise);
			await createKiloDirectoryClient(
				resolved,
				directory ?? extras?.session?.directory ?? resolved.globalDirectory,
			).session.abort({ sessionID }, { throwOnError: true });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : failureMessage);
		} finally {
			setStoppingIds((current) => {
				const next = new Set(current);
				for (const id of stoppingSessionIds) next.delete(id);
				return next;
			});
		}
	};
	const stopSubagent = (target: SubagentStopTarget) =>
		abortSessionTree(
			target.childSessionId,
			target.directory,
			[target.childSessionId],
			"Could not stop subagent",
		);
	// Stopping the parent's tree also catches subagents the UI does not see as
	// active (stale status, nested subagents) and keeps the parent from resuming.
	const stopAllSubagents = async () => {
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
	};
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
