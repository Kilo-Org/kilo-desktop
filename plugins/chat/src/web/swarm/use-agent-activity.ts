import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ChatMirrorServices } from "../runtime/chat-mirror";
import { agentActivityOf, type AgentActivity } from "./agent-activity";

/** How often a busy agent's "doing now" line is re-read when its chat reports no change. */
const BUSY_REFRESH_MS = 5_000;

const runsAStep = (activity: AgentActivity | undefined) =>
	activity?.steps.some((step) => step.status === "running") ?? false;

/**
 * A team member's activity, read from its chat's messages. Keyed by the
 * chat's `updatedAt`, so it re-reads whenever kilo.core sees the chat change;
 * while a tool call runs it also re-reads every few seconds, since a long
 * call doesn't move `updatedAt`. Keeps the previous read on screen meanwhile.
 */
export function useAgentActivity(
	services: ChatMirrorServices,
	chatId: string,
	options: {
		readonly directory?: string;
		readonly updatedAt?: number;
		readonly enabled?: boolean;
	},
): AgentActivity | undefined {
	const { directory, updatedAt } = options;
	const enabled = options.enabled !== false;
	const query = useQuery<AgentActivity>(
		{
			queryKey: ["kilo.chat", "swarm-agent-activity", chatId, directory, updatedAt],
			enabled,
			placeholderData: keepPreviousData,
			refetchInterval: (current) =>
				enabled && runsAStep(current.state.data) ? BUSY_REFRESH_MS : false,
			queryFn: async ({ signal }) => {
				const { data } = await services.chat.globalClient.session.messages(
					{ sessionID: chatId, ...(directory ? { directory } : {}) },
					{ throwOnError: true, signal },
				);
				return agentActivityOf(data ?? []);
			},
		},
		services.queries,
	);
	return query.data;
}
