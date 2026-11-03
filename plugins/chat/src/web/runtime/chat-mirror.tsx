import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";

import { IMPLEMENTING_AGENT } from "../plan/use-approve-plan";
import { useTranscriptAui } from "../thread/transcript-scope";
import { ChatConnectionProvider } from "./chat-connection";
import type { ChatServices } from "./chat-services";
import { chatSystemPrompt } from "./system-prompt";
import { useChatRuntime } from "./use-chat-runtime";

export interface ChatMirrorServices {
	readonly chat: ChatServices;
	readonly queries: QueryClient;
}

const cannotStartChats = () => Promise.reject(new Error("This pane can't start a chat."));

/**
 * A chat's transcript runtime for a pane beside the agent pane (plan,
 * subagent). It is the pane's own react-opencode runtime over the window's
 * Kilo connection and shared event stream, not the agent pane's: the agent
 * pane may sit in another group, be closed, or be in another window (a
 * popped-out pane is rendered by its own window), so nothing here depends
 * on it being mounted. The only prompt it sends is a plan's implement
 * fallback, with the implementing agent.
 */
export function ChatMirror({
	services,
	sessionId,
	chatId,
	children,
}: {
	services: ChatMirrorServices;
	sessionId: string;
	chatId: string | null;
	children: ReactNode;
}) {
	return (
		<QueryClientProvider client={services.queries}>
			<ChatConnectionProvider services={services.chat}>
				<MirrorRuntime
					key={chatId ?? ""}
					services={services.chat}
					sessionId={sessionId}
					chatId={chatId}
				>
					{children}
				</MirrorRuntime>
			</ChatConnectionProvider>
		</QueryClientProvider>
	);
}

function MirrorRuntime({
	services,
	sessionId,
	chatId,
	children,
}: {
	services: ChatServices;
	sessionId: string;
	chatId: string | null;
	children: ReactNode;
}) {
	const conversations = useDomain(Conversations);
	const directoryOf = useCallback(
		(id: string) => conversations?.getState().chats[id]?.directory ?? null,
		[conversations],
	);
	const getSystem = useCallback(
		async (id: string) => {
			const chat = conversations?.getState().chats[id];
			const config = await conversations?.methods
				.sessionConfig({
					sessionId,
					workspaceId: chat?.workspaceId ?? null,
					directory: chat?.directory ?? null,
				})
				.catch(() => undefined);
			return chatSystemPrompt(chat?.workspaceFolders ?? [], config?.instructions ?? []);
		},
		[conversations, sessionId],
	);
	const runtime = useChatRuntime({
		services,
		chatId,
		directoryOf,
		createChat: cannotStartChats,
		getSystem,
		getAgent: () => IMPLEMENTING_AGENT,
	});
	const aui = useTranscriptAui();
	return (
		<AssistantRuntimeProvider aui={aui} runtime={runtime}>
			{children}
		</AssistantRuntimeProvider>
	);
}
