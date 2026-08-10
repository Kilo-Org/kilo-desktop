import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { AssistantRuntimeProvider, DataRenderers, Tools, useAui } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloGlobalConnection, KiloUiChatService } from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { OpenCodeDataPart } from "./components/tools/opencode-data-part.js";
import toolkit from "./components/tools/toolkit.js";
import { ChatAgentSelectionProvider } from "./agent-selection/ChatAgentSelectionContext.js";
import { useKiloAgentCatalog } from "./agent-selection/use-kilo-agent-catalog.js";
import { useAgentSelection } from "./agent-selection/use-agent-selection.js";
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
	const { model, setModel, name, effort, efforts, setEffort } = usePersistedModelSelection(
		catalogQuery.data,
	);
	const activeEffort = resolveModelEffort(
		catalogQuery.data?.models ?? [],
		model ? modelRefToId(model) : undefined,
		effort,
	);

	const agentCatalogQuery = useKiloAgentCatalog(connection.data);
	const { agent, setAgent, resetAgent } = useAgentSelection();
	const resetAgentRef = useRef(resetAgent);
	resetAgentRef.current = resetAgent;

	const onThreadIdChange = useMemo(
		() => (threadId?: string) => {
			// New/draft threads always start on Code — never carry the previous session's agent.
			if (!threadId) {
				resetAgentRef.current();
			}
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
		defaultAgent: agent,
		...(model ? { defaultModel: model } : {}),
		...(activeEffort === undefined ? {} : { variant: activeEffort }),
		onThreadIdChange,
		onError: refreshConnection,
		sessionActivity,
	});

	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({ toolkit }),
	});

	useEffect(() => aui.dataRenderers.setFallbackDataUI(OpenCodeDataPart), [aui]);

	const modelSelection = useMemo(
		() => ({
			model,
			setModel,
			effort,
			setEffort,
			name,
			efforts,
			catalog: catalogQuery.data,
			isCatalogPending: catalogQuery.isPending,
			isCatalogError: catalogQuery.isError,
		}),
		[
			catalogQuery.data,
			catalogQuery.isError,
			catalogQuery.isPending,
			effort,
			efforts,
			model,
			name,
			setEffort,
			setModel,
		],
	);

	const agentSelection = useMemo(
		() => ({
			agent,
			setAgent,
			catalog: agentCatalogQuery.data,
			isCatalogPending: agentCatalogQuery.isPending,
			isCatalogError: agentCatalogQuery.isError,
		}),
		[
			agent,
			agentCatalogQuery.data,
			agentCatalogQuery.isError,
			agentCatalogQuery.isPending,
			setAgent,
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
				<ChatAgentSelectionProvider value={agentSelection}>
					<ChatModelSelectionProvider value={modelSelection}>
						<AssistantRuntimeProvider aui={aui} runtime={runtime}>
							{children}
						</AssistantRuntimeProvider>
					</ChatModelSelectionProvider>
				</ChatAgentSelectionProvider>
			</SessionActivityProvider>
		</ChatConnectionProvider>
	);
}
