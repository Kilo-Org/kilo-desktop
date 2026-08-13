import { createContext, useContext, type ReactNode } from "react";

import type { ModelSelectorEffortOption } from "../components/assistant-ui/model-selector.js";
import type { KiloModelCatalog, KiloModelRef } from "./model-catalog.js";

type ChatModelSelectionStatus = {
	model: KiloModelRef | undefined;
	setModel: (model: KiloModelRef) => void;
	/** Sticky reasoning effort / OpenCode variant id. */
	effort: string | undefined;
	setEffort: (effort: string) => void;
	/**
	 * Last known display name / effort options for optimistic first paint
	 * before `provider.list` resolves.
	 */
	name: string | undefined;
	efforts: readonly ModelSelectorEffortOption[] | undefined;
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
