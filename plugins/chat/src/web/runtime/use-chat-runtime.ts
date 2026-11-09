import type { AssistantRuntime } from "@assistant-ui/react";
import { OpenCodeAttachmentAdapter, useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useMemo, useRef } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";

import { PromptQueue } from "../../contracts";
import { createChatBackend, type ChatBackendOptions } from "./chat-backend";
import { createMainPromptQueue } from "./main-prompt-queue";

const isWorking = (status: string | undefined) => status === "busy" || status === "retry";

export interface ChatRuntimeOptions extends Omit<ChatBackendOptions, "getSystem"> {
	/** The chat to open; absent for a draft. */
	readonly chatId: string | null;
	readonly getSystem: NonNullable<ChatBackendOptions["getSystem"]>;
	/** The thread's chat id once it is known (a draft's after its first send). */
	readonly onChatId?: (chatId: string | undefined) => void;
	/** Queued prompts can be paused, reordered and edited (`prompt-queue-editing`). */
	readonly queueEditing?: boolean;
}

/**
 * One pane's transcript runtime over react-opencode. The backend is made once
 * (callbacks are read through a ref) so a re-render never swaps the runtime's
 * registry; a different chat remounts the hook's owner instead. Its prompt
 * queue is the chat's queue in main (`createMainPromptQueue`), so it outlives
 * the runtime.
 */
export function useChatRuntime(options: ChatRuntimeOptions): AssistantRuntime {
	const latest = useRef(options);
	latest.current = options;
	const backend = useMemo(
		() =>
			createChatBackend({
				services: options.services,
				directoryOf: (chatId) => latest.current.directoryOf(chatId),
				createChat: () => latest.current.createChat(),
				onCreateFailed: (error) => latest.current.onCreateFailed?.(error),
				getSystem: (chatId) => latest.current.getSystem(chatId),
				getAgent: () => latest.current.getAgent?.(),
				getModel: () => latest.current.getModel?.(),
				getVariant: () => latest.current.getVariant?.(),
				getKnownCommandNames: () => latest.current.getKnownCommandNames?.() ?? [],
				prepareModel: async (model) => {
					await latest.current.prepareModel?.(model);
				},
				resolveParts: async (parts) => (await latest.current.resolveParts?.(parts)) ?? parts,
				onPrompted: (chatId) => latest.current.onPrompted?.(chatId),
				onPromptFailed: (chatId) => latest.current.onPromptFailed?.(chatId),
			}),
		[options.services],
	);
	const adapters = useMemo(() => ({ attachments: new OpenCodeAttachmentAdapter() }), []);
	const initialChatId = useRef(options.chatId).current;
	const threadChatId = useRef(initialChatId);
	const queue = useDomain(PromptQueue);
	const conversations = useDomain(Conversations);
	const domains = useRef({ queue, conversations });
	domains.current = { queue, conversations };
	const createQueue = useMemo(
		() => () =>
			createMainPromptQueue({
				queue: () => domains.current.queue,
				chatId: () => threadChatId.current,
				chatWorking: () => {
					const chatId = threadChatId.current;
					const chats = domains.current.conversations?.getState().chats;
					return !!chatId && isWorking(chats?.[chatId]?.activity.status);
				},
				prompt: () => {
					const current = latest.current;
					return {
						getSystem: current.getSystem,
						...(current.getAgent ? { getAgent: current.getAgent } : {}),
						...(current.getModel ? { getModel: current.getModel } : {}),
						...(current.getVariant ? { getVariant: current.getVariant } : {}),
						...(current.getKnownCommandNames
							? { getKnownCommandNames: current.getKnownCommandNames }
							: {}),
						...(current.resolveParts ? { resolveParts: current.resolveParts } : {}),
					};
				},
				onError: (error) => console.error("[kilo.chat] Queued prompt", error),
			}),
		[],
	);
	return useOpenCodeRuntime({
		backend,
		...(initialChatId ? { initialSessionId: initialChatId } : {}),
		onThreadIdChange: (chatId) => {
			if (chatId) threadChatId.current = chatId;
			latest.current.onChatId?.(chatId);
		},
		messageQueue: {
			cancelBehavior: "pause",
			...(options.queueEditing ? { userControls: true } : {}),
			create: createQueue,
		},
		adapters,
	});
}
