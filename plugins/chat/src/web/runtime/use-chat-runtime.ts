import type { AssistantRuntime, Attachment, CompleteAttachment } from "@assistant-ui/react";
import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";

import { PromptQueues } from "../../contracts";
import { KiloAttachmentAdapter } from "./attachment-adapter";
import { createChatBackend, type ChatBackendOptions } from "./chat-backend";
import { createFirstPromptHandover, type UnsentMessage } from "./first-prompt-handover";
import { createMainPromptQueue } from "./main-prompt-queue";
import type { QueuePromptOptions } from "./queued-prompt";

const isWorking = (status: string | undefined) => status === "busy" || status === "retry";

export interface ChatRuntimeOptions extends Omit<ChatBackendOptions, "getSystem"> {
	/** The chat to open; absent for a draft. */
	readonly chatId: string | null;
	readonly getSystem: NonNullable<ChatBackendOptions["getSystem"]>;
	/** The thread's chat id once it is known (a draft's after its first send). */
	readonly onChatId?: (chatId: string | undefined) => void;
	/**
	 * Read once, at mount. For a thread whose unmount is final (the New
	 * Session page's): a draft's first message it hadn't sent when it
	 * unmounted goes to main's prompt queue, else its text to the work
	 * session's draft through `keepDraft` (`createFirstPromptHandover`).
	 */
	readonly firstPromptHandover?: {
		readonly keepDraft: (workSessionId: string, text: string) => void;
	};
}

function queuePromptOptions(current: ChatRuntimeOptions): QueuePromptOptions {
	return {
		getSystem: current.getSystem,
		...(current.getAgent ? { getAgent: current.getAgent } : {}),
		...(current.getModel ? { getModel: current.getModel } : {}),
		...(current.getVariant ? { getVariant: current.getVariant } : {}),
		...(current.getKnownCommandNames ? { getKnownCommandNames: current.getKnownCommandNames } : {}),
		...(current.resolveParts ? { resolveParts: current.resolveParts } : {}),
	};
}

const isComplete = (attachment: Attachment): attachment is CompleteAttachment =>
	attachment.status.type === "complete";

/**
 * Notes each composer draft with something in it: the send empties the
 * composer before the runtime asks for the chat, so while the chat is
 * requested the last one noted is the message being sent. (Kilo's attachments
 * are complete once added, so a send never waits on them.)
 */
function followDraft(runtime: AssistantRuntime, note: (message: UnsentMessage) => void) {
	const composer = runtime.thread.composer;
	const noteCurrent = () => {
		const { text, attachments } = composer.getState();
		if (!text.trim() && attachments.length === 0) return;
		note({ text, attachments: attachments.filter(isComplete) });
	};
	noteCurrent();
	return composer.subscribe(noteCurrent);
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
	const queue = useDomainObject(PromptQueues);
	const conversations = useDomainObject(Chats);
	const domains = useRef({ queue, conversations });
	domains.current = { queue, conversations };
	const [handover] = useState(() =>
		options.firstPromptHandover
			? createFirstPromptHandover({
					queue: () => domains.current.queue,
					prompt: () => queuePromptOptions(latest.current),
					keepDraft: (workSessionId, text) =>
						latest.current.firstPromptHandover?.keepDraft(workSessionId, text),
					onError: (error) => console.error("[kilo.chat] First message handover", error),
				})
			: null,
	);
	useEffect(() => {
		if (!handover) return;
		handover.attach();
		return () => handover.detach();
	}, [handover]);
	const backend = useMemo(
		() =>
			createChatBackend({
				services: options.services,
				directoryOf: (chatId) => latest.current.directoryOf(chatId),
				createChat: () => {
					const create = () => latest.current.createChat();
					return handover ? handover.createChat(create) : create();
				},
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
		[options.services, handover],
	);
	const adapters = useMemo(() => ({ attachments: new KiloAttachmentAdapter() }), []);
	const initialChatId = useRef(options.chatId).current;
	const threadChatId = useRef(initialChatId);
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
				prompt: () => queuePromptOptions(latest.current),
				...(handover ? { onTaken: () => handover.taken() } : {}),
				onError: (error) => console.error("[kilo.chat] Queued prompt", error),
			}),
		[handover],
	);
	const runtime = useOpenCodeRuntime({
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
	useEffect(
		() => (handover ? followDraft(runtime, (message) => handover.noteDraft(message)) : undefined),
		[handover, runtime],
	);
	return runtime;
}
