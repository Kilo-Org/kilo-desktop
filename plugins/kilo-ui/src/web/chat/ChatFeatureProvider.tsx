import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, type ReactNode } from "react";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloGlobalConnection, KiloUiChatService } from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { ChatConnectionProvider } from "./connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "./model-selection/ChatModelSelectionContext.js";
import { modelRefToId } from "./model-selection/model-catalog.js";
import { useKiloModelCatalog } from "./model-selection/use-kilo-model-catalog.js";
import { usePersistedModelSelection } from "./model-selection/use-persisted-model-selection.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";

const CHAT_ROUTE_PATH = "/plugins/chat";

/**
 * App-lifetime chat runtime: connection, model selection, and a single
 * `AssistantRuntimeProvider` shared by the shell sidebar SessionList and ChatPage.
 */
export function ChatFeatureProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const queryClient = useQueryClient();
	const { activeWorkspaceId } = useWorkspacesFeature();
	const connectionOptions = useMemo(
		() =>
			({
				...sdkQueryOptions(sdk, "chat.getConnection"),
				retry: false,
				staleTime: Number.POSITIVE_INFINITY,
				gcTime: Number.POSITIVE_INFINITY,
				refetchOnMount: false,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
			}) as const,
		[sdk],
	);
	const connection = useQuery(connectionOptions);
	const connectionPromise = useMemo(() => {
		if (connection.data && !connection.isFetching) {
			return Promise.resolve(connection.data);
		}
		if (connection.isError && !connection.isFetching) {
			const error =
				connection.error instanceof Error
					? connection.error
					: new Error(String(connection.error ?? "Could not connect to Kilo"));
			const rejected = Promise.reject<KiloGlobalConnection>(error);
			void rejected.catch(() => undefined);
			return rejected;
		}
		const pending = queryClient.fetchQuery(connectionOptions);
		void pending.catch(() => undefined);
		return pending;
	}, [
		connection.data,
		connection.error,
		connection.errorUpdatedAt,
		connection.isError,
		connection.isFetching,
		connectionOptions,
		queryClient,
	]);
	const refreshConnection = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: connectionOptions.queryKey,
			exact: true,
		});
	}, [connectionOptions.queryKey, queryClient]);

	const activeWorkspaceIdRef = useRef(activeWorkspaceId);
	activeWorkspaceIdRef.current = activeWorkspaceId;
	const prepareSession = useMemo(
		() => () =>
			sdk.client["chat.prepareSession"]({
				...(activeWorkspaceIdRef.current ? { workspaceId: activeWorkspaceIdRef.current } : {}),
			}),
		[sdk],
	);

	const sessionActivity = useMemo(() => createSessionActivityStore(), []);

	const catalogQuery = useKiloModelCatalog(connection.data);
	const { model, setModel, effort, setEffort } = usePersistedModelSelection(catalogQuery.data);
	const activeEffort = resolveModelEffort(
		catalogQuery.data?.models ?? [],
		model ? modelRefToId(model) : undefined,
		effort,
	);

	const onThreadIdChange = useMemo(
		() => (threadId?: string) => {
			sessionActivity.getState().setOpenSession(threadId ?? null);
			if (threadId) sessionActivity.getState().markVisited(threadId);
			const path = sdk.location.peek().path;
			if (path !== CHAT_ROUTE_PATH && !path.startsWith(`${CHAT_ROUTE_PATH}/`)) {
				sdk.navigate(CHAT_ROUTE_PATH);
			}
		},
		[sdk, sessionActivity],
	);

	const runtime = useKiloRuntime({
		connectionPromise,
		prepareSession,
		...(model ? { defaultModel: model } : {}),
		...(activeEffort === undefined ? {} : { variant: activeEffort }),
		onThreadIdChange,
		onError: refreshConnection,
		sessionActivity,
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

	const connectionStatus = {
		isPending: connection.isPending,
		isError: connection.isError,
		error: connection.error instanceof Error ? connection.error : null,
		connectionPromise,
	};

	return (
		<ChatConnectionProvider status={connectionStatus}>
			<SessionActivityProvider store={sessionActivity}>
				<ChatModelSelectionProvider value={modelSelection}>
					<AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
				</ChatModelSelectionProvider>
			</SessionActivityProvider>
		</ChatConnectionProvider>
	);
}
