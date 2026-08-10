import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, type ReactNode } from "react";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloGlobalConnection, KiloUiChatService } from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { navigateToChat } from "./chat-navigation.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { ChatConnectionProvider } from "./connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "./model-selection/ChatModelSelectionContext.js";
import { modelRefToId } from "./model-selection/model-catalog.js";
import { useKiloModelCatalog } from "./model-selection/use-kilo-model-catalog.js";
import { usePersistedModelSelection } from "./model-selection/use-persisted-model-selection.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";

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
	// One deferred covers the cold-start pending→ready transition so the promise
	// identity (and thus useKiloRuntime's backend / OpenCode SSE) stays fixed.
	// After the first settle, a new dataUpdatedAt always gets Promise.resolve.
	const heldConnectionPromiseRef = useRef<{
		promise: Promise<KiloGlobalConnection>;
		resolve?: (value: KiloGlobalConnection) => void;
		reject?: (reason: unknown) => void;
		dataUpdatedAt: number | null;
		errorUpdatedAt?: number;
	} | null>(null);
	const connectionPromise = useMemo(() => {
		if (connection.data && !connection.isFetching) {
			const held = heldConnectionPromiseRef.current;
			if (held && held.dataUpdatedAt === connection.dataUpdatedAt) {
				return held.promise;
			}
			if (held?.resolve && held.dataUpdatedAt === null) {
				held.resolve(connection.data);
				heldConnectionPromiseRef.current = {
					promise: held.promise,
					dataUpdatedAt: connection.dataUpdatedAt,
				};
				return held.promise;
			}
			const resolved = Promise.resolve(connection.data);
			heldConnectionPromiseRef.current = {
				promise: resolved,
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
			navigateToChat(sdk);
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
