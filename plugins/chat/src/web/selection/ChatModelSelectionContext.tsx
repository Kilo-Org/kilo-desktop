import { createContext, useContext, type ReactNode } from "react";

import type { ModelSourceStatus } from "../../contracts";
import type { ModelSelectorEffortOption } from "./model-selector";
import type { KiloModelCatalog, KiloModelRef } from "./model-catalog";

/** The first `model-source` contribution as the picker uses it. */
export interface ActiveModelSource {
	readonly providerId: string;
	readonly title: string;
	readonly settingsSection?: string | undefined;
	readonly status: ModelSourceStatus | null;
	/** True when the source has models the Kilo catalog may not list yet. */
	readonly hasModels: boolean;
	/** True until the source's models are known. */
	readonly pending: boolean;
	readonly start?: (() => Promise<void>) | undefined;
}

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
	/** True while `provider.list` is in flight, including refetches. */
	isCatalogFetching?: boolean;
	/** Reads kilo.core's models again, e.g. after AI Providers (kilo.core) changed it. */
	refreshCatalog?: () => void;
	modelSource?: ActiveModelSource | undefined;
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

/** The pane's model selection; null outside an agent pane's composer. */
export function useOptionalChatModelSelection(): ChatModelSelectionStatus | null {
	return useContext(ChatModelSelectionContext);
}
