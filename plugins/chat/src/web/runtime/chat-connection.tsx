import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useDomainState } from "@kilo-desktop/kernel/web";
import { AgentServer, type ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

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

const selectStatus = (state: { status: string; version?: string | undefined }) =>
	`${state.status}\n${state.version ?? ""}`;

/** The window's Kilo connection, re-read whenever the server restarts. */
export function useChatConnection(): ChatConnectionStatus {
	const services = useContext(ServicesContext);
	const status = useDomainState(AgentServer, selectStatus);
	const [connection, setConnection] = useState<ServerConnection | undefined>();
	const ready = status?.startsWith("ready\n") ?? false;
	useEffect(() => {
		if (!services || !ready) {
			setConnection(undefined);
			return;
		}
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
	}, [services, ready, status]);
	return { connection, isPending: connection === undefined };
}
