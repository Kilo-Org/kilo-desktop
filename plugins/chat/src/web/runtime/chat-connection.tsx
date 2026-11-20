import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { KiloServer, type ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import type { ChatSelections } from "../selection/chat-selections";
import type { ChatServices } from "./chat-services";

export interface ChatConnectionStatus {
	/** The running server's connection; undefined until it is ready. */
	readonly connection: ServerConnection | undefined;
	readonly isPending: boolean;
}

const ServicesContext = createContext<ChatServices | null>(null);

export function ChatConnectionProvider({
	services,
	children,
}: {
	services: ChatServices;
	children: ReactNode;
}) {
	return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** The window's per-chat agent and model selections; undefined outside a chat connection. */
export function useChatSelections(): ChatSelections | undefined {
	return useContext(ServicesContext)?.selections;
}

/** Drops a permission request the server no longer waits on from the window's threads. */
export function useSettlePermission():
	| ((permissionId: string, chatId: string) => void)
	| undefined {
	const services = useContext(ServicesContext);
	return services
		? (permissionId, chatId) => services.settlePermission(permissionId, chatId)
		: undefined;
}

const selectStatus = (state: { status: string; version?: string | undefined }) =>
	`${state.status}\n${state.version ?? ""}`;

const isReady = (status: string | undefined) => status?.startsWith("ready\n") ?? false;

/** The window's Kilo connection, re-read whenever the server restarts. */
export function useChatConnection(): ChatConnectionStatus {
	const services = useContext(ServicesContext);
	const status = useDomainObjectState(KiloServer, selectStatus);
	const [connection, setConnection] = useState<ServerConnection | undefined>();
	if ((!services || !isReady(status)) && connection !== undefined) setConnection(undefined);
	// Keyed on the whole status, so a restart re-reads the connection.
	useEffect(() => {
		if (!services || !isReady(status)) return;
		let current = true;
		services.connection().then(
			(next) => {
				if (current) setConnection(next);
			},
			() => {
				if (current) setConnection(undefined);
			},
		);
		return () => {
			current = false;
		};
	}, [services, status]);
	return { connection, isPending: connection === undefined };
}
