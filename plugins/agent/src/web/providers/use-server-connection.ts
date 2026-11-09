import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";

import { AgentServer, type ServerConnection, type ServerStatus } from "../../contracts";

export interface ServerConnectionStatus {
	readonly isPending: boolean;
	readonly isError: boolean;
	readonly error: Error | null;
	/** Set once the server is ready; kept through a restart until the new one is known. */
	readonly connection: ServerConnection | undefined;
}

const selectStatus = (state: ServerStatus) => state.status;

/** Counts how many times the server has become ready, so each start reconnects. */
function useReadyCount(status: ServerStatus["status"] | undefined): number {
	const count = useRef(0);
	const previous = useRef(status);
	if (status === "ready" && previous.current !== "ready") count.current += 1;
	previous.current = status;
	return count.current;
}

/**
 * How to reach the Kilo server, from `kilo.agent/server.connect()`. Re-read
 * each time the server becomes ready (a restart can change its address); the
 * previous connection stays in use meanwhile, so pages keep their data rather
 * than flashing back to loading. Without the server (browser mode, or a failed
 * start) it reads as an error.
 */
export function useServerConnection(): ServerConnectionStatus {
	const server = useDomain(AgentServer);
	const status = useDomainState(AgentServer, selectStatus);
	const readyCount = useReadyCount(status);
	const query = useQuery({
		queryKey: ["kilo.agent", "server.connect", readyCount],
		queryFn: () => server!.methods.connect(undefined),
		enabled: server !== null && status === "ready",
		placeholderData: keepPreviousData,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});

	if (!server || status === "error") {
		return {
			isPending: false,
			isError: true,
			error: query.error ?? new Error("The Kilo server isn't running."),
			connection: undefined,
		};
	}
	return {
		isPending: query.data === undefined && !query.isError,
		isError: query.isError,
		error: query.error,
		connection: query.data,
	};
}
