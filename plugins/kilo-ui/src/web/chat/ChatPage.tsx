import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloUiChatService, KiloWorkspaceConnection } from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { ChatConnectionProvider } from "./ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "./ChatModelSelectionContext.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { Thread } from "./components/assistant-ui/thread.js";
import { modelRefToId } from "./model-catalog.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { useKiloModelCatalog } from "./use-kilo-model-catalog.js";
import { usePersistedModelSelection } from "./use-persisted-model-selection.js";

function ChatThread({
	connectionPromise,
	catalogScopeKey,
}: {
	connectionPromise: Promise<KiloWorkspaceConnection>;
	catalogScopeKey: string;
}) {
	const catalogQuery = useKiloModelCatalog(connectionPromise, catalogScopeKey);
	const { model, setModel, effort, setEffort } = usePersistedModelSelection(catalogQuery.data);
	const activeEffort = resolveModelEffort(
		catalogQuery.data?.models ?? [],
		model ? modelRefToId(model) : undefined,
		effort,
	);

	const runtime = useKiloRuntime({
		connectionPromise,
		...(model ? { defaultModel: model } : {}),
		...(activeEffort === undefined ? {} : { variant: activeEffort }),
	});

	const modelSelection = useMemo(
		() => ({
			model,
			setModel,
			effort,
			setEffort,
			catalog: catalogQuery.data,
			isCatalogPending: catalogQuery.isPending,
			isCatalogError: catalogQuery.isError,
		}),
		[
			catalogQuery.data,
			catalogQuery.isError,
			catalogQuery.isPending,
			effort,
			model,
			setEffort,
			setModel,
		],
	);

	return (
		<ChatModelSelectionProvider value={modelSelection}>
			<AssistantRuntimeProvider runtime={runtime}>
				<div className="flex h-full min-h-0 flex-col" data-qa-id="kilo-chat-thread">
					<Thread />
				</div>
			</AssistantRuntimeProvider>
		</ChatModelSelectionProvider>
	);
}

/**
 * Full-page chat surface contributed by kilo-ui (`/plugins/chat`).
 * Scopes the Kilo directory from the active workspace (primary folder), or an
 * unscoped per-chat directory under `{userData}/chats/<chatId>/` when none is selected.
 *
 * Mounts the composer immediately. Connection may still be resolving (Kilo
 * starting); the composer waits on first send before clearing the draft.
 */
export function ChatPage() {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const queryClient = useQueryClient();
	const { activeWorkspaceId } = useWorkspacesFeature();
	const [chatId] = useState(() => crypto.randomUUID());
	const connectionInput = useMemo(
		() => ({
			chatId,
			...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
		}),
		[chatId, activeWorkspaceId],
	);
	const connection = useSdkQuery(sdk, "chat.getConnection", connectionInput);

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
			void rejected.catch(() => undefined);
			return rejected;
		}
		const promise = queryClient.ensureQueryData(
			sdkQueryOptions(sdk, "chat.getConnection", connectionInput),
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
			<ChatThread
				key={connection.data?.directory ?? `chat:${chatId}`}
				connectionPromise={connectionPromise}
				catalogScopeKey={connection.data?.directory ?? `chat:${chatId}`}
			/>
		</ChatConnectionProvider>
	);
}
