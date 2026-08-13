import { createContext, useContext, type ReactNode } from "react";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";

export type ChatConnectionStatus = {
	isPending: boolean;
	isError: boolean;
	error: Error | null;
	/** Resolved connection when ready; undefined while pending or on error. */
	connection: KiloGlobalConnection | undefined;
	connectionPromise: Promise<KiloGlobalConnection>;
};

const ChatConnectionContext = createContext<ChatConnectionStatus | null>(null);

export function ChatConnectionProvider({
	status,
	children,
}: {
	status: ChatConnectionStatus;
	children: ReactNode;
}) {
	return <ChatConnectionContext.Provider value={status}>{children}</ChatConnectionContext.Provider>;
}

export function useChatConnection(): ChatConnectionStatus {
	const status = useContext(ChatConnectionContext);
	if (!status) {
		throw new Error("useChatConnection requires ChatConnectionProvider");
	}
	return status;
}
