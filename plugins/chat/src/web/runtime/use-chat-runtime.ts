import type { AssistantRuntime } from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useRef, useState, type RefObject } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import { PromptQueues } from "../../contracts";
import { KiloAttachmentAdapter } from "./attachment-adapter";
import { createChatBackend, type ChatBackendOptions } from "./chat-backend";
import { createMainPromptQueue } from "./main-prompt-queue";

const isWorking = (status: string | undefined) => status === "busy" || status === "retry";

export interface ChatRuntimeOptions extends Omit<ChatBackendOptions, "getSystem"> {
	/** The chat to open; absent for a draft. */
	readonly chatId: string | null;
	readonly getSystem: NonNullable<ChatBackendOptions["getSystem"]>;
	/** The thread's chat id once it is known (a draft's after its first send). */
	readonly onChatId?: (chatId: string | undefined) => void;
}

/** The runtime's backend over `services`, calling the latest options through `latest`. */
function chatRuntimeBackend(
	services: ChatRuntimeOptions["services"],
	latest: RefObject<ChatRuntimeOptions>,
) {
	return createChatBackend({
		services,
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
	});
}

/**
 * One pane's transcript runtime over react-opencode. The backend is made once
 * (callbacks are read through a ref) so a re-render never swaps the runtime's
 * registry; a different chat remounts the hook's owner instead. Its prompt
 * queue is the chat's queue in main (`createMainPromptQueue`), so it outlives
 * the runtime.
 */
export function useChatRuntime(options: ChatRuntimeOptions): AssistantRuntime {
	const latest = useLatestRef(options);
	// One backend per services: a new one would swap the runtime's registry.
	const [owned, setOwned] = useState(() => ({
		services: options.services,
		backend: chatRuntimeBackend(options.services, latest),
	}));
	if (owned.services !== options.services) {
		setOwned({ services: options.services, backend: chatRuntimeBackend(options.services, latest) });
	}
	const backend = owned.backend;
	const [adapters] = useState(() => ({ attachments: new KiloAttachmentAdapter() }));
	const [initialChatId] = useState(options.chatId);
	const threadChatId = useRef(initialChatId);
	const queue = useDomainObject(PromptQueues);
	const conversations = useDomainObject(Chats);
	const domains = useLatestRef({ queue, conversations });
	const createQueue = () =>
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
		});
	return useOpenCodeRuntime({
		backend,
		...(initialChatId ? { initialSessionId: initialChatId } : {}),
		onThreadIdChange: (chatId) => {
			if (chatId) threadChatId.current = chatId;
			latest.current.onChatId?.(chatId);
		},
		messageQueue: {
			cancelBehavior: "pause",
			userControls: true,
			create: createQueue,
		},
		adapters,
	});
}
