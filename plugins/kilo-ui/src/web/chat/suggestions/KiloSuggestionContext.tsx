import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useOpenCodeSession } from "@assistant-ui/react-opencode";
import { useStore } from "zustand";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { pickPendingSuggestion, type KiloSuggestionRequest } from "./kilo-suggestion-logic.js";
import type { KiloSuggestionStore, KiloSuggestionStoreState } from "./kilo-suggestion-store.js";
import { createKiloSuggestionStore } from "./kilo-suggestion-store.js";

const KiloSuggestionContext = createContext<KiloSuggestionStore | null>(null);
const EMPTY_SUGGESTION_STORE = createKiloSuggestionStore();

export function KiloSuggestionProvider({
	store,
	children,
}: {
	store: KiloSuggestionStore;
	children: ReactNode;
}) {
	return <KiloSuggestionContext.Provider value={store}>{children}</KiloSuggestionContext.Provider>;
}

function useKiloSuggestionStore(): KiloSuggestionStore {
	return useContext(KiloSuggestionContext) ?? EMPTY_SUGGESTION_STORE;
}

export function useKiloSuggestionState<T>(selector: (state: KiloSuggestionStoreState) => T): T {
	return useStore(useKiloSuggestionStore(), selector);
}

/** Oldest pending suggestion for the open session, if any. */
export function usePendingKiloSuggestion(): KiloSuggestionRequest | null {
	const sessionId = useOpenCodeSession()?.id;
	const remoteId = useAuiState((state) => {
		const id = state.threadListItem.remoteId;
		return typeof id === "string" ? id : undefined;
	});
	const pending = useKiloSuggestionState((state) => state.pending);
	return useMemo(
		() => pickPendingSuggestion(pending, sessionId ?? remoteId),
		[pending, remoteId, sessionId],
	);
}

const REQUEST_OPTIONS = { throwOnError: true } as const;

export function useKiloSuggestionActions() {
	const connection = useChatConnection().connection;
	const directory = useOpenCodeSession()?.directory;

	return useMemo(
		() => ({
			accept: async (request: KiloSuggestionRequest, index: number) => {
				if (!connection) throw new Error("Not connected to Kilo.");
				if (!directory) throw new Error("Could not resolve the session directory.");
				await createKiloDirectoryClient(connection, directory).suggestion.accept(
					{ requestID: request.id, index },
					REQUEST_OPTIONS,
				);
			},
			dismiss: async (request: KiloSuggestionRequest) => {
				if (!connection) throw new Error("Not connected to Kilo.");
				if (!directory) throw new Error("Could not resolve the session directory.");
				await createKiloDirectoryClient(connection, directory).suggestion.dismiss(
					{ requestID: request.id },
					REQUEST_OPTIONS,
				);
			},
		}),
		[connection, directory],
	);
}
