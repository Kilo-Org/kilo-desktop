import { MessageNotSentError } from "@assistant-ui/react";
import type { OpenCodeRuntimeBackend } from "@kilo-desktop/react-opencode";

import type { ChatServices } from "./chat-services";
import { createPromptSender, type PromptOptions } from "./prompt-options";

export interface CreatedChat {
	readonly id: string;
	readonly directory: string | null;
	/** The work session the chat was created in, when the creator knows it. */
	readonly workSessionId?: string;
}

export interface ChatBackendOptions extends PromptOptions {
	readonly services: ChatServices;
	/** Creates the draft's chat on its first send. */
	readonly createChat: () => Promise<CreatedChat>;
	readonly onCreateFailed?: (error: unknown) => void;
}

/**
 * The react-opencode backend for one agent pane's thread. Work sessions own the
 * chat list, so the thread list is always empty: the runtime opens the pane's
 * chat by id, or starts a draft whose first send creates the chat through
 * kilo.work-sessions (with this app's stamp, permission rules and work session).
 * Every call goes through the window's one client (`ChatServices.transcriptClient`,
 * whose history reads are prefetched and filled with live text) and the
 * window's event stream; prompts carry the options read at send time
 * (`createPromptSender`).
 */
export function createChatBackend(options: ChatBackendOptions): OpenCodeRuntimeBackend {
	const { services } = options;
	return {
		client: services.transcriptClient,
		sendPrompt: createPromptSender(services.client, options),
		listSessionPage: async () => ({ sessions: [] }),
		initializeSession: async () => {
			try {
				const chat = await options.createChat();
				return { id: chat.id, ...(chat.directory ? { directory: chat.directory } : {}) };
			} catch (error) {
				options.onCreateFailed?.(error);
				// Nothing reached the server: the composer takes the draft back.
				throw new MessageNotSentError(error instanceof Error ? error.message : undefined);
			}
		},
		createEventSource: () => services.events(),
	};
}
