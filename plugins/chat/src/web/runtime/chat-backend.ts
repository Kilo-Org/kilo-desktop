import type { OpenCodeRuntimeBackend, OpenCodeSessionRef } from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { ChatServices } from "./chat-services";
import { createDeferredKiloClient } from "./deferred-client";
import { withPromptOptions, type PromptOptions } from "./prompt-options";
import { withMcpWarmup } from "./with-mcp-warmup";

export interface CreatedChat {
	readonly id: string;
	readonly directory: string | null;
}

export interface ChatBackendOptions extends PromptOptions {
	readonly services: ChatServices;
	/** Where a chat lives, when known without asking the server. */
	readonly directoryOf: (chatId: string) => string | null;
	/** Creates the draft's chat on its first send. */
	readonly createChat: () => Promise<CreatedChat>;
	readonly onCreateFailed?: (error: unknown) => void;
}

const REQUEST_OPTIONS = { throwOnError: true } as const;

/**
 * The react-opencode backend for one agent pane's thread. Sessions own the
 * chat list, so the thread list is always empty: the runtime opens the pane's
 * chat by id, or starts a draft whose first send creates the chat through
 * kilo.agent (with this app's stamp, permission rules and Work Session).
 * Writes go to the chat's own directory; the event stream is the window's.
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
		const { data } = await services.globalClient.session.get(
			{ sessionID: chatId },
			REQUEST_OPTIONS,
		);
		if (!data?.directory) throw new Error(`Could not find where chat ${chatId} runs.`);
		directories.set(chatId, data.directory);
		return data.directory;
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
				return withPromptOptions(
					withMcpWarmup(services.clients.directory(connection, directory)),
					options,
				);
			});
			sessionClients.set(ref.id, client);
		}
		return client as never;
	};

	return {
		globalClient: services.globalClient as never,
		getSessionClient,
		listSessionPage: async () => ({ sessions: [] }),
		initializeSession: async () => {
			try {
				const chat = await options.createChat();
				const ref = { id: chat.id, ...(chat.directory ? { directory: chat.directory } : {}) };
				remember(ref);
				return ref;
			} catch (error) {
				options.onCreateFailed?.(error);
				throw error;
			}
		},
		createEventSource: () => services.retainEvents(),
	};
}
