import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { AssistantRuntimeProvider, DataRenderers, Tools, useAui } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloGlobalConnection, KiloUiChatService } from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { navigateToChat } from "./chat-navigation.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { OpenCodeDataPart } from "./components/tools/opencode-data-part.js";
import toolkit from "./components/tools/toolkit.js";
import { ChatAgentSelectionProvider } from "./agent-selection/ChatAgentSelectionContext.js";
import { useKiloAgentCatalog } from "./agent-selection/use-kilo-agent-catalog.js";
import { useAgentSelection } from "./agent-selection/use-agent-selection.js";
import { KiloAuthProvider } from "../account/KiloAuthProvider.js";
import { ChatConnectionProvider } from "./connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "./model-selection/ChatModelSelectionContext.js";
import { modelRefToId } from "./model-selection/model-catalog.js";
import { useKiloModelCatalog } from "./model-selection/use-kilo-model-catalog.js";
import { usePersistedModelSelection } from "./model-selection/use-persisted-model-selection.js";
import {
	chatRightPanelCapability,
	type ChatRightPanelCapabilities,
} from "./right-panel/chat-right-panel-capability.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { KiloMcpAppsHost } from "./runtime/mcp-apps-host.js";
import { ElectronMcpAppRenderer } from "./components/mcp-apps/ElectronMcpAppRenderer.js";
import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import { KiloSuggestionProvider } from "./suggestions/KiloSuggestionContext.js";
import { createKiloSuggestionStore } from "./suggestions/kilo-suggestion-store.js";
import { PierreDiffProvider } from "./PierreDiffProvider.js";

import "./composer-glass.css";

/**
 * App-lifetime chat runtime: connection, model selection, and a single
 * `AssistantRuntimeProvider` shared by the shell sidebar SessionList and ChatPage.
 */
export function ChatFeatureProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const queryClient = useQueryClient();
	const { activeWorkspaceId } = useWorkspacesFeature();

	useEffect(() => {
		if (sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel) return;
		sdk.plugins.expose("chatRightPanel", chatRightPanelCapability);
	}, [sdk]);
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
	// One deferred covers the cold-start pending→ready transition so the promise
	// identity (and thus useKiloRuntime's backend / OpenCode SSE) stays fixed.
	// After the first settle, a new cache entry (dataUpdatedAt and/or data ref)
	// gets Promise.resolve. Comparing both avoids same-millisecond dataUpdatedAt
	// collisions that would otherwise keep a stale resolved promise after refresh.
	const heldConnectionPromiseRef = useRef<{
		promise: Promise<KiloGlobalConnection>;
		resolve?: (value: KiloGlobalConnection) => void;
		reject?: (reason: unknown) => void;
		data?: KiloGlobalConnection;
		dataUpdatedAt: number | null;
		errorUpdatedAt?: number;
	} | null>(null);
	const connectionPromise = useMemo(() => {
		if (connection.data && !connection.isFetching) {
			const held = heldConnectionPromiseRef.current;
			if (
				held &&
				held.dataUpdatedAt === connection.dataUpdatedAt &&
				held.data === connection.data
			) {
				return held.promise;
			}
			if (held?.resolve && held.dataUpdatedAt === null) {
				held.resolve(connection.data);
				heldConnectionPromiseRef.current = {
					promise: held.promise,
					data: connection.data,
					dataUpdatedAt: connection.dataUpdatedAt,
				};
				return held.promise;
			}
			const resolved = Promise.resolve(connection.data);
			heldConnectionPromiseRef.current = {
				promise: resolved,
				data: connection.data,
				dataUpdatedAt: connection.dataUpdatedAt,
			};
			return resolved;
		}
		if (connection.isError && !connection.isFetching) {
			const held = heldConnectionPromiseRef.current;
			if (held && held.errorUpdatedAt === connection.errorUpdatedAt) {
				return held.promise;
			}
			const error =
				connection.error instanceof Error
					? connection.error
					: new Error(String(connection.error ?? "Could not connect to Kilo"));
			if (held?.reject && held.dataUpdatedAt === null && held.errorUpdatedAt === undefined) {
				held.reject(error);
				heldConnectionPromiseRef.current = {
					promise: held.promise,
					dataUpdatedAt: null,
					errorUpdatedAt: connection.errorUpdatedAt,
				};
				return held.promise;
			}
			const rejected = Promise.reject<KiloGlobalConnection>(error);
			void rejected.catch(() => undefined);
			heldConnectionPromiseRef.current = {
				promise: rejected,
				dataUpdatedAt: null,
				errorUpdatedAt: connection.errorUpdatedAt,
			};
			return rejected;
		}
		const held = heldConnectionPromiseRef.current;
		if (
			held &&
			(held.dataUpdatedAt !== null || held.resolve || held.errorUpdatedAt !== undefined)
		) {
			// Keep the current identity while a refetch is in flight; settle above
			// replaces it when dataUpdatedAt changes.
			return held.promise;
		}
		let resolve!: (value: KiloGlobalConnection) => void;
		let reject!: (reason: unknown) => void;
		const pending = new Promise<KiloGlobalConnection>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		void pending.catch(() => undefined);
		heldConnectionPromiseRef.current = {
			promise: pending,
			resolve,
			reject,
			dataUpdatedAt: null,
		};
		void queryClient.fetchQuery(connectionOptions).catch(() => undefined);
		return pending;
	}, [
		connection.data,
		connection.dataUpdatedAt,
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

	// The embedded Kilo server reuses its port and credentials across restart, so
	// the cached connection normally stays valid. It can still fall back to a new
	// port if the old one is unavailable, so refetch the cached connection when it
	// reports ready again to rebuild the runtime against the current baseUrl.
	// Guarded on an existing connection so the initial cold-start "ready" does
	// not disrupt the first connection fetch.
	const hasConnection = connection.data !== undefined;
	useEffect(() => {
		if (!hasConnection) return;
		return sdk.events.on("kilo-server.server-status-changed", (status: unknown) => {
			if (
				typeof status === "object" &&
				status !== null &&
				(status as { status?: unknown }).status === "ready"
			) {
				refreshConnection();
			}
		});
	}, [sdk, refreshConnection, hasConnection]);

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
	const suggestions = useMemo(() => createKiloSuggestionStore(), []);

	const catalogQuery = useKiloModelCatalog(connection.data);
	const { model, validatedModel, setModel, name, effort, efforts, setEffort } =
		usePersistedModelSelection(catalogQuery.data);
	const activeEffort = resolveModelEffort(
		catalogQuery.data?.models ?? [],
		validatedModel ? modelRefToId(validatedModel) : undefined,
		effort,
	);

	const agentCatalogQuery = useKiloAgentCatalog(connection.data, connection.dataUpdatedAt);
	const { agent, getAgent, setAgent, resetAgent } = useAgentSelection(agentCatalogQuery.data);
	const resetAgentRef = useRef(resetAgent);
	resetAgentRef.current = resetAgent;

	const onThreadIdChange = useMemo(
		() => (threadId?: string) => {
			// New/draft threads prefer Code and never carry the previous session's agent.
			if (!threadId) {
				resetAgentRef.current();
			}
			sessionActivity.getState().setOpenSession(threadId ?? null);
			if (threadId) sessionActivity.getState().markVisited(threadId);
			navigateToChat(sdk);
		},
		[sdk, sessionActivity],
	);

	const runtime = useKiloRuntime({
		connectionPromise,
		prepareSession,
		...(agent ? { defaultAgent: agent } : {}),
		getAgent,
		...(validatedModel ? { defaultModel: validatedModel } : {}),
		...(activeEffort === undefined ? {} : { variant: activeEffort }),
		onThreadIdChange,
		onError: refreshConnection,
		sessionActivity,
		suggestions,
	});

	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({
			toolkit,
			mcpApp: ElectronMcpAppRenderer({
				host: KiloMcpAppsHost(),
				hostInfo: { name: "Anaconda Desktop", version: "1.0.0" },
				hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
			}),
		}),
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
		connection: connection.data,
		connectionPromise,
	};

	return (
		<PierreDiffProvider>
			<ChatConnectionProvider status={connectionStatus}>
				<KiloAuthProvider>
					<SessionActivityProvider store={sessionActivity}>
						<KiloSuggestionProvider store={suggestions}>
							<ChatAgentSelectionProvider value={agentSelection}>
								<ChatModelSelectionProvider value={modelSelection}>
									<AssistantRuntimeProvider aui={aui} runtime={runtime}>
										{children}
									</AssistantRuntimeProvider>
								</ChatModelSelectionProvider>
							</ChatAgentSelectionProvider>
						</KiloSuggestionProvider>
					</SessionActivityProvider>
				</KiloAuthProvider>
			</ChatConnectionProvider>
		</PierreDiffProvider>
	);
}
