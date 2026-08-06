import { useQueryClient } from "@tanstack/react-query";
import { MessageSquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloCodeService, KiloWorkspaceConnection } from "../contracts/schemas.js";
import { ChatConnectionProvider } from "./ChatConnectionContext.js";
import { Thread } from "./components/assistant-ui/thread.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";

/**
 * Nav icon for the kilo-code chat route (plugin.json `nav[].icon`).
 */
export const ChatNavIcon = MessageSquareIcon;

function ChatThread({
	connectionPromise,
}: {
	connectionPromise: Promise<KiloWorkspaceConnection>;
}) {
	const runtime = useKiloRuntime({ connectionPromise });
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<div className="flex h-full min-h-0 flex-col" data-qa-id="kilo-chat-thread">
				<Thread />
			</div>
		</AssistantRuntimeProvider>
	);
}

/**
 * Full-page chat surface contributed by kilo-code (`/plugins/chat`).
 * Uses a per-chat unscoped Kilo directory under `{storageDir}/chats/<chatId>/`.
 *
 * Mounts the composer immediately. `server.getConnection` may still be
 * resolving (Kilo starting); the composer waits on first send before clearing
 * the draft.
 */
export function ChatPage() {
	const sdk = useSdk<KiloCodeService>("kilo-code");
	const queryClient = useQueryClient();
	const [chatId] = useState(() => crypto.randomUUID());
	const connectionInput = useMemo(() => ({ scope: "unscoped" as const, chatId }), [chatId]);
	const connection = useSdkQuery(sdk, "server.getConnection", connectionInput);

	// Recreate when the query recovers after an error (refetch / restart). A single
	// ensureQueryData promise permanently rejects and would block sends forever.
	const connectionPromise = useMemo(() => {
		if (connection.data) {
			return Promise.resolve(connection.data);
		}
		if (connection.isError && !connection.isFetching) {
			const error =
				connection.error instanceof Error
					? connection.error
					: new Error(String(connection.error ?? "Could not connect to Kilo"));
			const rejected = Promise.reject(error);
			// Keep the rejection for send-time awaiters; avoid an unhandled rejection if
			// the user never sends while the banner is showing.
			void rejected.catch(() => undefined);
			return rejected;
		}
		const promise = queryClient.ensureQueryData(
			sdkQueryOptions(sdk, "server.getConnection", connectionInput),
		);
		void promise.catch(() => undefined);
		return promise;
	}, [
		connection.data,
		connection.errorUpdatedAt,
		connection.isError,
		connection.isFetching,
		connectionInput,
		queryClient,
		sdk,
	]);

	const connectionStatus = {
		isPending: connection.isPending,
		isError: connection.isError,
		error: connection.error instanceof Error ? connection.error : null,
		connectionPromise,
	};

	return (
		<ChatConnectionProvider status={connectionStatus}>
			{connection.isError ? (
				<p className="text-destructive px-6 pt-4 text-sm" role="alert" data-qa-id="kilo-chat-error">
					Could not connect to Kilo:{" "}
					{connection.error instanceof Error ? connection.error.message : String(connection.error)}
				</p>
			) : null}
			<ChatThread connectionPromise={connectionPromise} />
		</ChatConnectionProvider>
	);
}
