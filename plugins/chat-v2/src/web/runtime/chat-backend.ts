import { MessageNotSentError } from "@assistant-ui/react";
import type {
	KiloClient,
	OpenCodeRuntimeBackend,
	OpenCodeSessionRef,
} from "@kilo-desktop/react-opencode-v2";

import type { ChatServices } from "./chat-services";
import { createDeferredKiloClient } from "./deferred-client";
import { withPrefetchedHistory } from "./history-prefetch";
import { withPendingPrompts } from "./pending-prompts";
import { withPromptOptions, type PromptOptions } from "./prompt-options";
import { withMcpWarmup } from "./with-mcp-warmup";

export interface CreatedChat {
	readonly id: string;
	readonly directory: string | null;
	/** The work session the chat was created in, when the creator knows it. */
	readonly workSessionId?: string;
}

export interface ChatBackendOptions extends PromptOptions {
	readonly services: ChatServices;
	/** Where a chat lives, when known without asking the server. */
	readonly directoryOf: (chatId: string) => string | null;
	/** Creates the draft's chat on its first send. */
	readonly createChat: () => Promise<CreatedChat>;
	readonly onCreateFailed?: (error: unknown) => void;
}

/**
 * The react-opencode backend for one agent pane's thread. Work sessions own the
 * chat list, so the thread list is always empty: the runtime opens the pane's
 * chat by id, or starts a draft whose first send creates the chat through
 * kilo.work-sessions (with this app's stamp, permission rules and work session).
 * Prompts warm the chat's own directory first; the event stream is the
 * window's, with the prompts the chat was already waiting on replayed to each
 * thread that subscribes (`withPendingPrompts`), and a history the thread
 * reads carries the text streamed since (`LiveParts`).
 */
export function createChatBackend(options: ChatBackendOptions): OpenCodeRuntimeBackend {
	const { services } = options;
	const directories = new Map<string, string>();
	const sessionClients = new Map<string, KiloClient>();

	const remember = (ref: OpenCodeSessionRef) => {
		if (ref.directory) directories.set(ref.id, ref.directory);
	};

	const directoryOf = async (chatId: string): Promise<string> => {
		const known = directories.get(chatId) ?? options.directoryOf(chatId);
		if (known) return known;
		const session = await services.globalClient.session.get({ sessionID: chatId });
		const directory = session?.location.directory;
		if (!directory) throw new Error(`Could not find where chat ${chatId} runs.`);
		directories.set(chatId, directory);
		return directory;
	};

	const getSessionClient = (ref: OpenCodeSessionRef) => {
		remember(ref);
		let client = sessionClients.get(ref.id);
		if (!client) {
			client = createDeferredKiloClient(async () => {
				const [connection, directory] = await Promise.all([
					services.connection(),
					directoryOf(ref.id),
				]);
				return withPrefetchedHistory(
					withPromptOptions(withMcpWarmup(services.clients.client(connection), directory), options),
					ref.id,
					services.history,
				);
			});
			sessionClients.set(ref.id, client);
		}
		return client;
	};

	return {
		globalClient: services.globalClient,
		getSessionClient,
		patchHistory: (chatId, messages) => services.liveParts.patchMessages(chatId, messages),
		listSessionPage: async () => ({ sessions: [] }),
		initializeSession: async () => {
			try {
				const chat = await options.createChat();
				const ref = { id: chat.id, ...(chat.directory ? { directory: chat.directory } : {}) };
				remember(ref);
				return ref;
			} catch (error) {
				options.onCreateFailed?.(error);
				// Nothing reached the server: the composer takes the draft back.
				throw new MessageNotSentError(error instanceof Error ? error.message : undefined);
			}
		},
		createEventSource: () =>
			withPendingPrompts(services.events(), () => [...sessionClients.entries()]),
	};
}
