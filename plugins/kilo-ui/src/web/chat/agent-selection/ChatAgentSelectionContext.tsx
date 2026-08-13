import { createContext, useContext, type ReactNode } from "react";

import type { KiloAgentCatalog } from "./agent-catalog.js";

type ChatAgentSelectionStatus = {
	agent: string | undefined;
	setAgent: (agent: string) => void;
	catalog: KiloAgentCatalog | undefined;
	isCatalogPending: boolean;
	isCatalogError: boolean;
};

const ChatAgentSelectionContext = createContext<ChatAgentSelectionStatus | null>(null);

export function ChatAgentSelectionProvider({
	value,
	children,
}: {
	value: ChatAgentSelectionStatus;
	children: ReactNode;
}) {
	return (
		<ChatAgentSelectionContext.Provider value={value}>
			{children}
		</ChatAgentSelectionContext.Provider>
	);
}

export function useChatAgentSelection(): ChatAgentSelectionStatus {
	const status = useContext(ChatAgentSelectionContext);
	if (!status) {
		throw new Error("useChatAgentSelection requires ChatAgentSelectionProvider");
	}
	return status;
}
