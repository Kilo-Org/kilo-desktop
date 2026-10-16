import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AssistantRuntimeProvider, DataRenderers, Tools, useAui } from "@assistant-ui/react";
import type { OpenCodeServerEvent } from "@assistant-ui/react-opencode";

import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";

import type {
	KiloGlobalConnection,
	KiloSessionPreparation,
	KiloUiChatService,
} from "../../contracts/chat/schemas.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { ChatComposerCapabilityHost } from "./ChatComposerCapabilityHost.js";
import { resolveChatWorkspaceDirectory } from "./chat-workspace-directory.js";
import { navigateToChat } from "./chat-navigation.js";
import { resolveModelEffort } from "./components/assistant-ui/model-selector.js";
import { OpenCodeDataPart } from "./components/tools/opencode-data-part.js";
import toolkit from "./components/tools/toolkit.js";
import { KiloServerErrorToast } from "./KiloServerErrorToast.js";
import { LocalModelLoadingToast } from "./LocalModelLoadingToast.js";
import {
	INSTALLED_LOCAL_MODELS_QUERY_KEY,
	installedLocalModelsFromChangedPayload,
	useHasInstalledLocalModels,
} from "./use-installed-local-models.js";
import { useLocalInferenceStatus } from "./use-local-inference-status.js";
import { ChatAgentSelectionProvider } from "./agent-selection/ChatAgentSelectionContext.js";
import { ChatAutoApproveProvider } from "./auto-approve/ChatAutoApproveContext.js";
import { createAutoApprover } from "./auto-approve/auto-approver.js";
import { isRefusedForSignIn } from "./components/tools/tool-sign-in.js";
import { useKiloAgentCatalog } from "./agent-selection/use-kilo-agent-catalog.js";
import { useAgentSelection } from "./agent-selection/use-agent-selection.js";
import { findCatalogAgent } from "./agent-selection/agent-catalog.js";
import { useKiloCommandCatalog } from "./slash-commands/use-kilo-command-catalog.js";
import { KiloAuthProvider } from "../account/KiloAuthProvider.js";
import { KiloSignInCapabilityHost } from "../account/KiloSignInCapabilityHost.js";
import { ChatConnectionProvider } from "./connection/ChatConnectionContext.js";
import { ChatModelSelectionProvider } from "./model-selection/ChatModelSelectionContext.js";
import {
	attachGatewayModelDetails,
	modelRefToId,
	type KiloModelRef,
} from "./model-selection/model-catalog.js";
import {
	isModelCatalogPending,
	useKiloModelCatalog,
} from "./model-selection/use-kilo-model-catalog.js";
import { usePersistedModelSelection } from "./model-selection/use-persisted-model-selection.js";
import { useModelPreferences } from "./model-selection/use-model-preferences.js";
import { resolveLocalInferenceCapability } from "../providers/local-inference/capability.js";
import { KILO_PROVIDER_ID } from "../providers/provider-ids.js";
import {
	invalidateKiloProviderQueries,
	KILO_PROVIDER_LIST_QUERY_KEY,
} from "../providers/provider-queries.js";
import { isStaleKiloConnectionError } from "./kilo-connection-error.js";
import { bindChatPaneSync, listenChatPaneSync } from "./pane-canvas/chat-pane-sync.js";
import { chatRightPanelCapability } from "./right-panel/chat-right-panel-capability.js";
import type { SessionInitializedInfo } from "./runtime/create-kilo-runtime-backend.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";
import { KiloMcpAppsHost } from "./runtime/mcp-apps-host.js";
import { ElectronMcpAppRenderer } from "./components/mcp-apps/ElectronMcpAppRenderer.js";
import { SessionActivityProvider } from "./session-activity/SessionActivityProvider.js";
import {
	createSessionActivityStore,
	whenSessionsRefreshed,
} from "./session-activity/session-activity-store.js";
import { createChatSessionWorkspaceCapability } from "./session-workspace/chat-session-workspace-capability.js";
import { SessionListViewProvider } from "./session-list/use-session-list-view.js";
import { WorkspaceBoardProvider } from "./workspace-board/WorkspaceBoardProvider.js";
import { WorkspaceBoardWindowBridge } from "./workspace-board/WorkspaceBoardWindowBridge.js";
import {
	readGitDraftSelection,
	resolvePrepareSessionWorktreeInput,
} from "./git-draft-selection.js";
import { useWorktreeBranchNamer } from "./use-worktree-branch-namer.js";
import { useChatNotifier } from "./notifications/use-chat-notifier.js";
import { createKiloDirectoryClient } from "./runtime/create-kilo-runtime-client.js";
import { createSourceControlWriter } from "./source-control-writer.js";
import { WorktreeSetupProvider } from "./worktree-setup/WorktreeSetupContext.js";
import { PierreDiffProvider } from "./PierreDiffProvider.js";
import { KiloSessionSelectionSync } from "./session-selection/KiloSessionSelectionSync.js";
import { SubagentActivityProvider } from "./subagents/SubagentActivityContext.js";

import "./composer.css";

/**
 * App-lifetime chat runtime: connection, model selection, and a single
 * `AssistantRuntimeProvider` shared by the shell sidebar SessionList and ChatPage.
 */
export function ChatFeatureProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const queryClient = useQueryClient();
	const { activeWorkspaceId, workspaces } = useWorkspacesFeature();
	const localInference = resolveLocalInferenceCapability(sdk.plugins.get("local-inference"));
	const localInferenceStatus = useLocalInferenceStatus();
	const { hasInstalled: hasInstalledLocalModels, isPending: isInstalledLocalModelsPending } =
		useHasInstalledLocalModels(localInference !== null);
	const prepareModel = useMemo(
		() => (localInference ? (modelId: string) => localInference.prepareModel(modelId) : undefined),
		[localInference],
	);
	const startLocalInference = useCallback(async () => {
		if (!localInference?.connect) return;
		await localInference.connect();
		await queryClient.invalidateQueries({ queryKey: [...KILO_PROVIDER_LIST_QUERY_KEY] });
	}, [localInference, queryClient]);

	useEffect(() => {
		sdk.plugins.expose("chatRightPanel", bindChatPaneSync(sdk, chatRightPanelCapability));
		return listenChatPaneSync(sdk);
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
	const refreshConnection = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: connectionOptions.queryKey,
			exact: true,
		});
		invalidateKiloProviderQueries(queryClient);
	}, [connectionOptions.queryKey, queryClient]);
	useEffect(() => {
		return sdk.events.on("local-inference.models-changed", (payload) => {
			invalidateKiloProviderQueries(queryClient);
			const installed = installedLocalModelsFromChangedPayload(payload);
			if (installed === false) {
				queryClient.setQueryData(INSTALLED_LOCAL_MODELS_QUERY_KEY, false);
			}
			void queryClient.invalidateQueries({ queryKey: [...INSTALLED_LOCAL_MODELS_QUERY_KEY] });
		});
	}, [queryClient, sdk]);
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
		return pending;
	}, [
		connection.data,
		connection.dataUpdatedAt,
		connection.error,
		connection.errorUpdatedAt,
		connection.isError,
		connection.isFetching,
	]);
	// Worktree setup stays visible until the session exists (or startup fails):
	// clearing it right after preparation left a blank gap while the session
	// was created in the fresh directory, before the turn's working indicator.
	const [isSettingUpWorktree, setIsSettingUpWorktree] = useState(false);
	// Outlives `isSettingUpWorktree` until the next preparation: the session
	// exists before the thread learns its `remoteId`, and in between the
	// composer footer would otherwise resolve to the workspace checkout.
	const [isAwaitingWorktreeSession, setIsAwaitingWorktreeSession] = useState(false);
	const onRuntimeError = useCallback(
		(error: unknown) => {
			setIsSettingUpWorktree(false);
			setIsAwaitingWorktreeSession(false);
			if (isStaleKiloConnectionError(error)) void refreshConnection();
		},
		[refreshConnection],
	);

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
		() => async () => {
			const workspaceId = activeWorkspaceIdRef.current ?? undefined;
			// Cross-feature read of the git plugin's draft selection store:
			// a `worktree` mode with no entry (git inactive, race with the
			// menu's first write) means the workspace checkout.
			const worktree = resolvePrepareSessionWorktreeInput(readGitDraftSelection(sdk, workspaceId));
			if (worktree !== undefined) setIsSettingUpWorktree(true);
			setIsAwaitingWorktreeSession(worktree !== undefined);
			try {
				return await sdk.client["chat.prepareSession"]({
					...(workspaceId ? { workspaceId } : {}),
					...(worktree === undefined ? {} : worktree),
				});
			} catch (error) {
				setIsSettingUpWorktree(false);
				setIsAwaitingWorktreeSession(false);
				throw error;
			}
		},
		[sdk],
	);

	// Compensating cleanup: a worktree prepared for a session whose creation
	// then failed is removed fire-and-forget; git's managed-path guard makes
	// this a no-op for anything that is not a Kilo worktree.
	const onSessionCreateFailed = useCallback(
		(preparation: KiloSessionPreparation) =>
			sdk.client["chat.removeWorktree"]({ directory: preparation.directory }),
		[sdk],
	);

	const sessionActivity = useMemo(() => createSessionActivityStore(), []);
	const workspacesRef = useRef(workspaces);
	useEffect(() => {
		workspacesRef.current = workspaces;
	}, [workspaces]);
	useEffect(() => {
		sdk.plugins.expose(
			"chatSessionWorkspace",
			createChatSessionWorkspaceCapability({
				getSessionActivity: (sessionId) => sessionActivity.getState().sessions[sessionId],
				getWorkspaces: () => workspacesRef.current,
			}),
		);
	}, [sdk, sessionActivity]);

	// The namer holds per-session arming in memory, so it must outlive
	// connection refreshes: the connection is read through a ref instead of
	// being a memo dependency.
	const namerConnectionRef = useRef(connectionPromise);
	namerConnectionRef.current = connectionPromise;
	const branchNamer = useWorktreeBranchNamer({
		getConnection: () => namerConnectionRef.current,
		sessionActivity,
		renameWorktreeBranch: (input) => sdk.client["chat.renameWorktreeBranch"](input),
		hasWorktreeWork: (input) => sdk.client["chat.hasWorktreeWork"](input),
		log: (message) => console.warn(`[kilo-ui] branch naming: ${message}`),
	});
	const onLiveEvent = useChatNotifier(sdk, sessionActivity);

	const catalogQuery = useKiloModelCatalog(connection.data, connection.dataUpdatedAt);
	const gatewayModelDetails = useQuery({
		...sdkQueryOptions(sdk, "chat.getGatewayModelDetails"),
		enabled:
			catalogQuery.data?.models.some((model) => model.providerID === KILO_PROVIDER_ID) ?? false,
		staleTime: 5 * 60_000,
		gcTime: 30 * 60_000,
		retry: 1,
	});
	const catalogWithDetails = useMemo(
		() => attachGatewayModelDetails(catalogQuery.data, gatewayModelDetails.data),
		[catalogQuery.data, gatewayModelDetails.data],
	);
	const [activeThreadId, setActiveThreadId] = useState<string>();
	const [autoApprove, setAutoApprove] = useState(() => {
		try {
			return globalThis.localStorage?.getItem("kilo-ui:auto-approve") === "true";
		} catch {
			return false;
		}
	});
	const autoApproveRef = useRef(autoApprove);
	const autoApprover = useMemo(
		() =>
			createAutoApprover({
				getConnection: () => connectionPromise,
				isEnabled: () => autoApproveRef.current,
				resolveDirectory: (sessionId) =>
					sessionId ? sessionActivity.getState().sessions[sessionId]?.directory : undefined,
				directories: () =>
					Object.values(sessionActivity.getState().sessions).flatMap((session) =>
						session.directory ? [session.directory] : [],
					),
				onReveal: (event) => sessionActivity.getState().applyEvent(event),
				// A signed-out call to a sign-in tool is refused by the gateway, so
				// skip Kilo's permission prompt and let chat show the sign-in prompt.
				isRefusedForSignIn: (permission) =>
					isRefusedForSignIn(permission, {
						tools: sdk.tools.all(),
						getSession: () => sdk.auth.getSession(),
					}),
			}),
		[connectionPromise, sdk, sessionActivity],
	);
	useEffect(() => {
		// A persisted Auto mode (or a recreated approver) must still answer requests
		// that were pending before anything was listening; wait for sessions so the
		// drain knows their directories.
		let active = true;
		void whenSessionsRefreshed(sessionActivity).then(() => {
			if (active) void autoApprover.resync();
		});
		return () => {
			active = false;
			autoApprover.dispose();
		};
	}, [autoApprover, sessionActivity]);
	const changeAutoApprove = useCallback(
		(enabled: boolean) => {
			if (enabled === autoApproveRef.current) return;
			autoApproveRef.current = enabled;
			setAutoApprove(enabled);
			try {
				globalThis.localStorage?.setItem("kilo-ui:auto-approve", String(enabled));
			} catch {
				// Storage can be unavailable; the selection still works until the app closes.
			}
			void autoApprover.setEnabled(enabled);
		},
		[autoApprover],
	);
	const onPermissionEvent = useCallback(
		(event: OpenCodeServerEvent) => autoApprover.handleEvent(event),
		[autoApprover],
	);
	const onStreamReconnected = useCallback(() => void autoApprover.resync(), [autoApprover]);
	const agentCatalogQuery = useKiloAgentCatalog(connection.data, connection.dataUpdatedAt);
	const {
		preferences: modelPreferences,
		remember: rememberModelPreference,
		recordRecent: recordRecentModel,
	} = useModelPreferences();
	const rememberModel = useCallback(
		(agentName: string, selectedModel: KiloModelRef, selectedEffort: string | undefined) =>
			rememberModelPreference({
				agent: agentName,
				model: selectedModel,
				...(selectedEffort === undefined ? {} : { effort: selectedEffort }),
			}),
		[rememberModelPreference],
	);
	const { agent, getAgent, setAgent, resetDraftAgent, hydrateThreadAgent, promoteDraftAgent } =
		useAgentSelection(agentCatalogQuery.data, activeThreadId);
	const configuredAgent = findCatalogAgent(agentCatalogQuery.data, agent);
	const {
		model,
		validatedModel,
		setModel,
		name,
		effort,
		efforts,
		setEffort,
		hydrateThreadModel,
		promoteDraftModel,
		resetDraftModel,
	} = usePersistedModelSelection(
		catalogWithDetails,
		activeThreadId,
		configuredAgent
			? {
					agent: configuredAgent.name,
					...(configuredAgent.model ? { model: configuredAgent.model } : {}),
					...(configuredAgent.variant ? { effort: configuredAgent.variant } : {}),
				}
			: undefined,
		modelPreferences,
		rememberModel,
		recordRecentModel,
	);
	const selectModel = useCallback((next: KiloModelRef) => setModel(next), [setModel]);
	const activeEffort = resolveModelEffort(
		catalogQuery.data?.models ?? [],
		validatedModel ? modelRefToId(validatedModel) : undefined,
		effort,
	);

	const commandDirectory =
		resolveChatWorkspaceDirectory({
			remoteId: undefined,
			activeWorkspaceId,
			sessionWorkspaceId: undefined,
			workspaces,
		}) ?? connection.data?.globalDirectory;
	const commandCatalogQuery = useKiloCommandCatalog(connection.data, commandDirectory);
	const knownCommandNamesRef = useRef<readonly string[]>([]);
	knownCommandNamesRef.current = (commandCatalogQuery.data ?? []).map((command) => command.name);
	const resetDraftAgentRef = useRef(resetDraftAgent);
	resetDraftAgentRef.current = resetDraftAgent;
	const resetDraftModelRef = useRef(resetDraftModel);
	resetDraftModelRef.current = resetDraftModel;

	const onThreadIdChange = useMemo(
		() => (threadId?: string) => {
			setActiveThreadId(threadId);
			// New/draft threads prefer Code and never carry the previous session's agent.
			if (!threadId) {
				resetDraftAgentRef.current();
				resetDraftModelRef.current();
			}
			sessionActivity.getState().setOpenSession(threadId ?? null);
			if (threadId) sessionActivity.getState().markVisited(threadId);
			navigateToChat(sdk);
		},
		[sdk, sessionActivity],
	);
	const onSessionInitialized = useCallback(
		(threadId: string, info?: SessionInitializedInfo) => {
			setIsSettingUpWorktree(false);
			promoteDraftAgent(threadId);
			promoteDraftModel(threadId);
			// Only sessions created in this renderer lifetime may be auto-named;
			// the namer re-checks worktree eligibility on every prompt.
			branchNamer.arm(
				threadId,
				info?.worktreeBaseRef ? { baseRef: info.worktreeBaseRef } : undefined,
			);
			if (info?.worktreeDirectory) {
				void sdk.client["chat.linkWorktreeSession"]({
					directory: info.worktreeDirectory,
					sessionId: threadId,
					...(info.worktreeBaseRef ? { baseRef: info.worktreeBaseRef } : {}),
				}).catch(() => undefined);
			}
		},
		[sdk, promoteDraftAgent, promoteDraftModel, branchNamer],
	);

	const runtime = useKiloRuntime({
		connectionPromise,
		prepareSession,
		onSessionCreateFailed,
		...(agent ? { defaultAgent: agent } : {}),
		getAgent,
		...(validatedModel ? { defaultModel: validatedModel } : {}),
		...(prepareModel ? { prepareModel } : {}),
		onPrompt: branchNamer.prompt,
		...(activeEffort === undefined ? {} : { variant: activeEffort }),
		onThreadIdChange,
		onSessionInitialized,
		onError: onRuntimeError,
		sessionActivity,
		getKnownCommandNames: () => knownCommandNamesRef.current,
		onPermissionEvent,
		onStreamReconnected,
		...(onLiveEvent ? { onLiveEvent } : {}),
	});

	const aui = useAui({
		dataRenderers: DataRenderers(),
		tools: Tools({
			toolkit,
			mcpApp: ElectronMcpAppRenderer({
				host: KiloMcpAppsHost(),
				hostInfo: { name: "Kilo Desktop", version: "1.0.0" },
				hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
			}),
		}),
	});

	useEffect(() => aui.dataRenderers.setFallbackDataUI(OpenCodeDataPart), [aui]);

	const modelSelection = useMemo(
		() => ({
			model,
			setModel: selectModel,
			effort,
			setEffort,
			name,
			efforts,
			catalog: catalogWithDetails,
			isCatalogPending: isModelCatalogPending(catalogQuery),
			isCatalogError: catalogQuery.isError,
			isCatalogFetching: catalogQuery.isFetching,
			localInferenceAvailable: localInference !== null,
			localInferenceStatus,
			hasInstalledLocalModels,
			isInstalledLocalModelsPending,
			...(localInference?.connect ? { startLocalInference } : {}),
		}),
		[
			catalogWithDetails,
			catalogQuery.isError,
			catalogQuery.isFetching,
			catalogQuery.isPending,
			hasInstalledLocalModels,
			isInstalledLocalModelsPending,
			effort,
			efforts,
			localInference,
			localInferenceStatus,
			model,
			name,
			setEffort,
			selectModel,
			startLocalInference,
		],
	);
	const writerInputsRef = useRef({ validatedModel, activeEffort, prepareModel, connectionPromise });
	writerInputsRef.current = { validatedModel, activeEffort, prepareModel, connectionPromise };
	useEffect(() => {
		let mounted = true;
		sdk.plugins.expose("sourceControlWriter", {
			...createSourceControlWriter({
				getModel: () => writerInputsRef.current.validatedModel,
				getVariant: () => writerInputsRef.current.activeEffort,
				getPrepareModel: () => writerInputsRef.current.prepareModel,
				createDirectoryClient: async (directory) =>
					createKiloDirectoryClient(await writerInputsRef.current.connectionPromise, directory),
				isAvailable: () => mounted,
			}),
		});
		return () => {
			mounted = false;
		};
	}, [sdk]);

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
	const autoApproveSelection = {
		enabled: autoApprove,
		setEnabled: changeAutoApprove,
		revealedIds: autoApprover.revealedIds,
		checkingIds: autoApprover.checkingIds,
	};

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
					<KiloSignInCapabilityHost />
					<SessionActivityProvider store={sessionActivity}>
						<ChatAgentSelectionProvider value={agentSelection}>
							<ChatAutoApproveProvider value={autoApproveSelection}>
								<ChatModelSelectionProvider value={modelSelection}>
									<WorktreeSetupProvider
										isSettingUp={isSettingUpWorktree}
										isAwaitingSession={isAwaitingWorktreeSession}
									>
										<AssistantRuntimeProvider aui={aui} runtime={runtime}>
											<ChatComposerCapabilityHost />
											<SubagentActivityProvider>
												<KiloSessionSelectionSync
													hydrateAgent={hydrateThreadAgent}
													hydrateModel={hydrateThreadModel}
												/>
												<SessionListViewProvider>
													<WorkspaceBoardProvider>
														<WorkspaceBoardWindowBridge />
														{children}
													</WorkspaceBoardProvider>
												</SessionListViewProvider>
											</SubagentActivityProvider>
										</AssistantRuntimeProvider>
									</WorktreeSetupProvider>
								</ChatModelSelectionProvider>
							</ChatAutoApproveProvider>
						</ChatAgentSelectionProvider>
					</SessionActivityProvider>
				</KiloAuthProvider>
				<KiloServerErrorToast />
			</ChatConnectionProvider>
			<LocalModelLoadingToast models={catalogQuery.data?.models ?? []} />
		</PierreDiffProvider>
	);
}
