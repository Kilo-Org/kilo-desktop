import type { AssistantRuntime } from "@assistant-ui/react";
import { OpenCodeAttachmentAdapter, useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useMemo, useRef } from "react";

import { createChatBackend, type ChatBackendOptions } from "./chat-backend";

/** The flag behind pausing, reordering and editing queued prompts. */
export const PROMPT_QUEUE_EDITING_FLAG = "prompt-queue-editing";

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
 * registry; a different chat remounts the hook's owner instead.
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
			}),
		[options.services],
	);
	const adapters = useMemo(() => ({ attachments: new OpenCodeAttachmentAdapter() }), []);
	const initialChatId = useRef(options.chatId).current;
	return useOpenCodeRuntime({
		backend,
		...(initialChatId ? { initialSessionId: initialChatId } : {}),
		onThreadIdChange: (chatId) => latest.current.onChatId?.(chatId),
		messageQueue: {
			cancelBehavior: "pause",
			...(options.queueEditing ? { userControls: true } : {}),
		},
		adapters,
	});
}
