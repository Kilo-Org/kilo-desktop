import { createContext, useContext, type ReactNode } from "react";

import type { KiloModelCatalog, KiloModelRef } from "./model-catalog.js";

export type ChatModelSelectionStatus = {
	model: KiloModelRef | undefined;
	setModel: (model: KiloModelRef) => void;
	/** Sticky reasoning effort / OpenCode variant id. */
	effort: string | undefined;
	setEffort: (effort: string) => void;
	catalog: KiloModelCatalog | undefined;
	isCatalogPending: boolean;
	isCatalogError: boolean;
};

const ChatModelSelectionContext = createContext<ChatModelSelectionStatus | null>(null);

export function ChatModelSelectionProvider({
	value,
	children,
}: {
	value: ChatModelSelectionStatus;
	children: ReactNode;
}) {
	return (
		<ChatModelSelectionContext.Provider value={value}>
			{children}
		</ChatModelSelectionContext.Provider>
	);
}

export function useChatModelSelection(): ChatModelSelectionStatus {
	const status = useContext(ChatModelSelectionContext);
	if (!status) {
		throw new Error("useChatModelSelection requires ChatModelSelectionProvider");
	}
	return status;
}
