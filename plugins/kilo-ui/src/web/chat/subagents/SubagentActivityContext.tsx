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
import { useSessionActivity } from "../session-activity/SessionActivityProvider.js";
import { childSessionIdFromTaskPart, subagentDisplayStatus } from "./subagent-state.js";

const record = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const text = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const typeLabelFor = (agent: string) =>
	agent
		? agent.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
		: "Subagent";

export type SubagentActivity = {
	childSessionId: string;
	toolCallId: string;
	title: string;
	typeLabel: string;
	status: ReturnType<typeof subagentDisplayStatus>;
	directory?: string | undefined;
};

function deriveActivities(extras: ReturnType<typeof useOptionalOpenCodeRuntimeExtras>) {
	if (
		!extras?.state?.messageOrder ||
		!extras.state.messagesById ||
		!extras.state.childSessionsById
	) {
		return [];
	}
	const calls = new Map<string, { toolCallId: string; title: string; typeLabel: string }>();
	for (const messageId of extras.state.messageOrder) {
		for (const part of extras.state.messagesById[messageId]?.parts ?? []) {
			const childSessionId = childSessionIdFromTaskPart(part);
			if (!childSessionId) continue;
			const input = record(record(record(part)?.state)?.input);
			const rawPart = record(part);
			const toolCallId = text(rawPart?.callID) || text(rawPart?.id);
			if (!toolCallId) continue;
			const agent = text(input?.subagent_type);
			const title = text(input?.description) || text(input?.prompt) || "Delegated task";
			calls.set(childSessionId, {
				toolCallId,
				title,
				typeLabel: typeLabelFor(agent),
			});
		}
	}
	return Object.entries(extras.state.childSessionsById).flatMap(([childSessionId, child]) => {
		const call = calls.get(childSessionId);
		return call
			? [
					{
						childSessionId,
						...call,
						status: subagentDisplayStatus(child),
						directory: child.session?.directory,
					},
				]
			: [];
	});
}

const active = (activity: SubagentActivity) =>
	activity.status === "working" || activity.status === "waiting";

type Value = {
	activities: readonly SubagentActivity[];
	hasActiveSubagents: boolean;
	activeToolCallIds: ReadonlySet<string>;
	stoppingIds: ReadonlySet<string>;
	stopSubagent(activity: SubagentActivity): Promise<void>;
	stopAllSubagents(): Promise<void>;
};
const Context = createContext<Value>({
	activities: [],
	hasActiveSubagents: false,
	activeToolCallIds: new Set(),
	stoppingIds: new Set(),
	stopSubagent: async () => undefined,
	stopAllSubagents: async () => undefined,
});

export function SubagentActivityProvider({ children }: { children: ReactNode }) {
	const extras = useOptionalOpenCodeRuntimeExtras();
	const { connection, connectionPromise } = useChatConnection();
	const activities = useMemo(() => deriveActivities(extras), [extras]);
	const activeActivities = useMemo(() => activities.filter(active), [activities]);
	const hasActiveSubagents = activeActivities.length > 0;
	const activeToolCallIds = useMemo(
		() => new Set(activeActivities.map((activity) => activity.toolCallId)),
		[activeActivities],
	);
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
	const stopSubagent = async (activity: SubagentActivity) => {
		setStoppingIds((current) => new Set(current).add(activity.childSessionId));
		try {
			const resolved = connection ?? (await connectionPromise);
			const directory =
				activity.directory ?? extras?.session?.directory ?? resolved.globalDirectory;
			await createKiloDirectoryClient(resolved, directory).session.abort(
				{ sessionID: activity.childSessionId, scope: "session" },
				{ throwOnError: true },
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not stop subagent");
		} finally {
			setStoppingIds((current) => {
				const next = new Set(current);
				next.delete(activity.childSessionId);
				return next;
			});
		}
	};
	const value: Value = {
		activities,
		hasActiveSubagents,
		activeToolCallIds,
		stoppingIds,
		stopSubagent,
		stopAllSubagents: async () => void (await Promise.all(activeActivities.map(stopSubagent))),
	};
	return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useSubagentActivity = () => useContext(Context);
