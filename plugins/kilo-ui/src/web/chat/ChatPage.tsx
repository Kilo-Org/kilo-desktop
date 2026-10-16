import { useAui, useAuiState } from "@assistant-ui/react";
import { Minimize2Icon } from "lucide-react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type ComponentType,
} from "react";

import type { PluginPageProps } from "@kilo-desktop/feature-sdk";
import {
	findPane,
	flattenPanes,
	movePane,
	removePane,
	serializeLayout,
	setActivePane,
	type Arrangement,
	type PaneLayout,
} from "@kilo-desktop/pane-layout";
import { useFeatureFlag, useSdk, useSdkContributions } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { ChatLocationBreadcrumb, ChatSessionBreadcrumb } from "./ChatSessionBreadcrumb.js";
import { DetachedWindowLayout } from "./DetachedWindowLayout.js";
import { ChatMarkdownProvider } from "./ChatMarkdownContext.js";
import type { ChatMarkdownExtensionContext } from "./chat-markdown-extensions.js";
import { resolveChatWorkspace } from "./chat-workspace-directory.js";
import { Thread } from "./components/assistant-ui/thread.js";
import type { LayoutPreset } from "../../contracts/layout-presets/schemas.js";
import { LayoutPresetsMenu } from "./layout-presets/LayoutPresetsMenu.js";
import { captureLayoutTemplate } from "./layout-presets/layout-template.js";
import { useDefaultLayout } from "./layout-presets/use-default-layout.js";
import { CHAT_LAYOUTS_FEATURE_FLAG } from "./layout-presets/feature-flag.js";

import { ChatPaneCanvas } from "./pane-canvas/ChatPaneCanvas.js";
import {
	FILES_PANE_DEFINITION_ID,
	workspaceFolderName,
} from "./pane-canvas/default-workspace-files-pane.js";
import { shouldShowChatCanvas } from "./pane-canvas/chat-canvas-visibility.js";
import type { PaneIconOverride } from "./pane-canvas/pane-kind-icon.js";
import {
	agentPaneId,
	ensureAgentPane,
	isAgentPaneId,
	mergeArtifactPanes,
	parseStoredLayout,
	syncChatLayout,
} from "./pane-canvas/pane-layout-state.js";
import { PaneLaunchToolbar } from "./pane-canvas/PaneLaunchToolbar.js";
import { PaneSessionChrome } from "./pane-canvas/PaneSessionChrome.js";
import { PaneSessionProvider } from "./pane-canvas/PaneSessionContext.js";
import { useRevealContributedPane } from "./pane-canvas/reveal-contributed-pane.js";
import {
	resetPaneSessionHeader,
	usePaneSessionHeaderStore,
} from "./pane-canvas/pane-session-header-store.js";
import { chatRightPanelCapability } from "./right-panel/chat-right-panel-capability.js";
import { RightPanelTabCloseDialog } from "./right-panel/RightPanelTabCloseDialog.js";
import {
	RightPanelTabContent,
	type RightPanelTabDefinition,
	useRightPanelTabDefinitions,
} from "./right-panel/right-panel-tab-registry.js";
import {
	DEFAULT_ARRANGEMENT,
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	resolveRightPanelSessionKey,
	resolveVisibleRightPanelSessionKey,
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel/right-panel-store.js";
import { useSessionActivity } from "./session-activity/SessionActivityProvider.js";
import {
	withWorktreeFolder,
	worktreeDirectoryOf,
} from "./session-workspace/chat-session-workspace-capability.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";

const EMPTY_WORKSPACE_FOLDERS: ChatMarkdownExtensionContext["workspaceFolders"] = [];
const KILO_UI_PLUGIN_ID = "kilo-ui";
export const CHAT_HEADER_ACTIONS_ZONE = "kilo-ui/chat-header-actions";

export interface ChatHeaderActionProps {
	readonly workspaceDirectory?: string;
	readonly onOpenChanges?: () => void;
	readonly onAppendToChat?: (text: string) => void;
}

function unpinLayout(layout: PaneLayout): PaneLayout {
	if (!layout.groups.some((group) => group.pinned)) return layout;
	return {
		...layout,
		groups: layout.groups.map((group) => (group.pinned ? { ...group, pinned: false } : group)),
	};
}

type DetachedPaneRequest = {
	sessionId: string;
	paneId: string;
	workspaceId?: string;
};

function detachedPaneRequest(search: Record<string, unknown>): DetachedPaneRequest | null {
	if (search.paneWindow !== true && search.paneWindow !== "true") return null;
	if (search.panePluginId !== KILO_UI_PLUGIN_ID) return null;
	if (typeof search.paneSessionId !== "string" || !search.paneSessionId.trim()) return null;
	if (typeof search.paneId !== "string" || !search.paneId.trim()) return null;
	return {
		sessionId: search.paneSessionId,
		paneId: search.paneId,
		...(typeof search.paneWorkspaceId === "string" && search.paneWorkspaceId.trim()
			? { workspaceId: search.paneWorkspaceId }
			: {}),
	};
}

function DetachedSessionGate({
	children,
	remoteId,
	sessionId,
}: {
	children: ReactNode;
	remoteId: string | undefined;
	sessionId: string;
}) {
	const aui = useAui();
	useEffect(() => {
		if (remoteId === sessionId) return;
		void aui.threads.switchToThread(sessionId, { unarchive: false });
	}, [aui, remoteId, sessionId]);

	if (remoteId !== sessionId) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Spinner aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>Loading pane…</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	}
	return children;
}

const ChatThreadSurface = memo(function ChatThreadSurface({
	sessionId,
	workspaceFolders,
}: ChatMarkdownExtensionContext) {
	return (
		<PaneSessionProvider sessionId={sessionId}>
			<ChatMarkdownProvider sessionId={sessionId} workspaceFolders={workspaceFolders}>
				<Thread />
			</ChatMarkdownProvider>
		</PaneSessionProvider>
	);
});

export function ChatPageHeaderLeading() {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<ChatSessionBreadcrumb />
		</div>
	);
}

export function ChatPageHeaderActions() {
	const state = usePaneSessionHeaderStore();
	const layoutsEnabled = useFeatureFlag(CHAT_LAYOUTS_FEATURE_FLAG, false);
	const contributions = useSdkContributions(CHAT_HEADER_ACTIONS_ZONE);
	if (!state.ready) return null;
	return (
		<div className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]">
			{contributions.map((contribution) => {
				const Component = contribution.component as ComponentType<ChatHeaderActionProps>;
				return (
					<Component
						key={`${state.sessionId}:${contribution.featureId}.${contribution.id}`}
						{...(state.workspaceDirectory ? { workspaceDirectory: state.workspaceDirectory } : {})}
						onOpenChanges={state.onOpenChanges}
						onAppendToChat={state.onAppendToChat}
					/>
				);
			})}
			{state.hasCanvas ? (
				<>
					<PaneLaunchToolbar
						definitions={state.definitions}
						onLaunchChat={state.onLaunchChat}
						onLaunch={state.onLaunch}
					/>
					<PaneSessionChrome
						arrangement={state.arrangement}
						onArrangementChange={state.onArrangementChange}
					/>
					{layoutsEnabled ? (
						<LayoutPresetsMenu capture={state.captureLayout} onApply={state.onApplyLayout} />
					) : null}
				</>
			) : null}
		</div>
	);
}

/**
 * Full-page chat surface contributed by kilo-ui (`/plugins/chat`).
 * Connection and `AssistantRuntimeProvider` live in `ChatFeatureProvider`
 * so the shell sidebar SessionList shares the same runtime.
 */
export function ChatPage({ search = {} }: Partial<PluginPageProps> = {}) {
	const sdk = useSdk(KILO_UI_PLUGIN_ID);
	const aui = useAui();
	const layoutsEnabled = useFeatureFlag(CHAT_LAYOUTS_FEATURE_FLAG, false);
	const rightPanelDefinitions = useRightPanelTabDefinitions();
	const availableDefinitionIds = useMemo(
		() => rightPanelDefinitions.map((definition) => definition.id),
		[rightPanelDefinitions],
	);
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const localThreadId = useAuiState((s) => s.threadListItem.id);
	const sessionTitle = useAuiState((s) => s.threadListItem.title);
	const chatTitle = sessionTitle?.trim() || "New Chat";
	const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
	const threadStatus = useAuiState((s) => s.threadListItem.status);
	const detached = detachedPaneRequest(search);
	const isDetached = detached !== null;
	const effectiveRemoteId = detached?.sessionId ?? remoteId;
	const promotedSessionId =
		detached?.sessionId ?? resolveRightPanelSessionKey(remoteId, localThreadId);
	const prePromotionSessionId = resolveRightPanelSessionKey(undefined, localThreadId);
	const sessionId = useRightPanelStore((state) =>
		isDetached
			? promotedSessionId
			: resolveVisibleRightPanelSessionKey(
					state.bySessionId,
					promotedSessionId,
					prePromotionSessionId,
				),
	);
	const { activeWorkspaceId, workspaces } = useWorkspacesFeature();
	const sessionWorkspaceId = useSessionActivity((state) =>
		effectiveRemoteId ? state.sessions[effectiveRemoteId]?.workspaceId : undefined,
	);
	const sessionActivity = useSessionActivity((state) =>
		remoteId ? state.sessions[remoteId] : undefined,
	);
	const chatWorkspaceOptions = {
		remoteId: effectiveRemoteId,
		activeWorkspaceId,
		sessionWorkspaceId: detached?.workspaceId ?? sessionWorkspaceId,
		workspaces,
	};
	const workspace = resolveChatWorkspace(chatWorkspaceOptions);
	const worktreeDirectory = worktreeDirectoryOf(sessionActivity);
	const workspaceDirectory =
		worktreeDirectory ??
		workspace?.folders.find((folder) => folder.isPrimary)?.path ??
		workspace?.folders[0]?.path;
	const headerWorkspaceDirectory = remoteId?.trim()
		? (worktreeDirectory ??
			workspace?.folders.find((folder) => folder.isPrimary)?.path ??
			workspace?.folders[0]?.path)
		: undefined;
	const workspaceFolders = useMemo(
		() => withWorktreeFolder(workspace?.folders ?? EMPTY_WORKSPACE_FOLDERS, worktreeDirectory),
		[worktreeDirectory, workspace?.folders],
	);

	const panelState = useRightPanelStore((state) =>
		selectSessionRightPanelState(state.bySessionId, sessionId),
	);
	const openTab = useRightPanelStore((state) => state.openTab);
	const activateTab = useRightPanelStore((state) => state.activateTab);
	const closeTab = useRightPanelStore((state) => state.closeTab);
	const setChatPaneOpen = useRightPanelStore((state) => state.setChatPaneOpen);
	const moveSessionState = useRightPanelStore((state) => state.moveSessionState);
	const clearSession = useRightPanelStore((state) => state.clearSession);
	const persistLayoutJson = useRightPanelStore((state) => state.setLayout);
	const persistArrangement = useRightPanelStore((state) => state.setArrangement);
	const applyTemplate = useRightPanelStore((state) => state.applyTemplate);

	const hasExtraPanes = panelState.tabs.length > 0;
	const hasCanvas = shouldShowChatCanvas({
		hasMessages,
		hasExtraPanes,
		remoteId,
		status: threadStatus,
	});
	const arrangement: Arrangement = panelState.arrangement ?? DEFAULT_ARRANGEMENT;
	const localAlias =
		localThreadId?.trim() && localThreadId !== sessionId ? agentPaneId(localThreadId) : undefined;
	const aliases = useMemo(() => {
		const next = [agentPaneId("draft")];
		if (localAlias) next.push(localAlias);
		return next;
	}, [localAlias]);

	const layout = useMemo(
		() =>
			syncChatLayout({
				layout: parseStoredLayout(panelState.layoutJson),
				sessionId,
				aliases,
				tabs: panelState.tabs,
				title: chatTitle,
				activeTabId: panelState.activeTabId,
				showAgent: panelState.chatPaneOpen !== false,
			}),
		[
			aliases,
			panelState.activeTabId,
			panelState.chatPaneOpen,
			panelState.layoutJson,
			panelState.tabs,
			sessionId,
			chatTitle,
		],
	);
	const [poppedOutPaneIds, setPoppedOutPaneIds] = useState<ReadonlySet<string>>(() => new Set());
	const [redockedPaneId, setRedockedPaneId] = useState<string | null>(null);
	const [revealActivePaneNonce, setRevealActivePaneNonce] = useState(0);

	useEffect(() => {
		if (isDetached || !sdk.shell.canPopOutPanes) return;
		let cancelled = false;
		let loaded = false;
		const changes = new Map<string, boolean>();
		setPoppedOutPaneIds(new Set());
		const apply = (paneId: string, open: boolean) => {
			if (!loaded) changes.set(paneId, open);
			setPoppedOutPaneIds((current) => {
				const has = current.has(paneId);
				if (has === open) return current;
				const next = new Set(current);
				if (open) next.add(paneId);
				else next.delete(paneId);
				return next;
			});
		};
		void sdk.shell.listPaneWindows(KILO_UI_PLUGIN_ID).then((windows) => {
			if (cancelled) return;
			const next = new Set(
				windows.filter((window) => window.sessionId === sessionId).map((window) => window.paneId),
			);
			for (const [paneId, open] of changes) {
				if (open) next.add(paneId);
				else next.delete(paneId);
			}
			loaded = true;
			changes.clear();
			setPoppedOutPaneIds(next);
		});
		const unsubscribe = sdk.shell.onPaneWindowChanged((event) => {
			if (event.pluginId !== KILO_UI_PLUGIN_ID || event.sessionId !== sessionId) return;
			if (event.type === "opened") apply(event.paneId, true);
			if (event.type === "docked") {
				apply(event.paneId, false);
				setRedockedPaneId(event.paneId);
			}
		});
		void sdk.shell.syncPaneWindows(KILO_UI_PLUGIN_ID, sessionId);
		return () => {
			cancelled = true;
			unsubscribe();
			void sdk.shell.syncPaneWindows(KILO_UI_PLUGIN_ID, null);
		};
	}, [isDetached, sdk, sessionId]);

	const [closeRequest, setCloseRequest] = useState<{
		readonly sessionId: string;
		readonly tab: RightPanelTab;
	} | null>(null);
	const [tabCloseError, setTabCloseError] = useState<string | null>(null);

	useEffect(() => {
		chatRightPanelCapability.setFocusedSessionId(sessionId);
		return () => {
			if (chatRightPanelCapability.getFocusedSessionId() === sessionId) {
				chatRightPanelCapability.setFocusedSessionId(null);
			}
		};
	}, [sessionId]);

	useLayoutEffect(() => {
		if (isDetached) return;
		if (!remoteId?.trim()) return;
		if (localThreadId?.trim() && localThreadId !== remoteId) {
			moveSessionState(localThreadId, remoteId);
		}
		if (remoteId !== DRAFT_RIGHT_PANEL_SESSION_KEY) {
			moveSessionState(DRAFT_RIGHT_PANEL_SESSION_KEY, remoteId);
		}
	}, [isDetached, localThreadId, moveSessionState, remoteId]);

	useEffect(() => {
		if (!hasExtraPanes) return;
		const json = serializeLayout(layout);
		if (json === panelState.layoutJson) return;
		persistLayoutJson(sessionId, json);
	}, [hasExtraPanes, layout, panelState.layoutJson, persistLayoutJson, sessionId]);

	const commitLayout = useCallback(
		(next: PaneLayout) => {
			persistLayoutJson(sessionId, serializeLayout(next));
		},
		[persistLayoutJson, sessionId],
	);

	const handleSelectPane = useCallback(
		(paneId: string) => {
			if (isAgentPaneId(paneId)) return;
			activateTab(sessionId, paneId);
		},
		[activateTab, sessionId],
	);

	const dockPaneWindow = useCallback(
		(paneId: string) =>
			sdk.shell.dockPaneWindow({
				pluginId: KILO_UI_PLUGIN_ID,
				sessionId,
				paneId,
			}),
		[sdk, sessionId],
	);

	const handlePopOutPane = useCallback(
		async (paneId: string) => {
			const pane = findPane(layout, paneId);
			if (!pane) return;
			await sdk.shell.openPaneWindow({
				pluginId: KILO_UI_PLUGIN_ID,
				sessionId,
				paneId,
				title: pane.title,
				path: "/plugins/chat",
				...(workspace?.id ? { workspaceId: workspace.id } : {}),
			});
			setPoppedOutPaneIds((current) => new Set(current).add(paneId));
			if (layout.activePaneId !== paneId) return;
			const next = flattenPanes(layout).find(
				(candidate) => candidate.id !== paneId && !poppedOutPaneIds.has(candidate.id),
			);
			if (next) commitLayout(setActivePane(layout, next.id));
		},
		[commitLayout, layout, poppedOutPaneIds, sdk, sessionId, workspace?.id],
	);

	const handleFocusPoppedOutPane = useCallback(
		(paneId: string) => {
			void sdk.shell.focusPaneWindow({
				pluginId: KILO_UI_PLUGIN_ID,
				sessionId,
				paneId,
			});
		},
		[sdk, sessionId],
	);

	const handleDockPoppedOutPane = useCallback(
		async (paneId: string) => {
			await dockPaneWindow(paneId);
			setRedockedPaneId(paneId);
		},
		[dockPaneWindow],
	);

	useEffect(() => {
		if (!redockedPaneId) return;
		setPoppedOutPaneIds((current) => {
			if (!current.has(redockedPaneId)) return current;
			const next = new Set(current);
			next.delete(redockedPaneId);
			return next;
		});
		if (findPane(layout, redockedPaneId)) {
			commitLayout(setActivePane(layout, redockedPaneId));
			handleSelectPane(redockedPaneId);
		}
		setRedockedPaneId(null);
	}, [commitLayout, handleSelectPane, layout, redockedPaneId]);

	const paneRevealRequest = useRevealContributedPane((state) => state.request);
	const handledPaneRevealNonceRef = useRef(paneRevealRequest?.nonce ?? 0);
	useEffect(() => {
		if (isDetached || !paneRevealRequest || paneRevealRequest.sessionId !== sessionId) return;
		if (paneRevealRequest.nonce === handledPaneRevealNonceRef.current) return;
		const { paneId } = paneRevealRequest;
		if (poppedOutPaneIds.has(paneId)) {
			handledPaneRevealNonceRef.current = paneRevealRequest.nonce;
			handleFocusPoppedOutPane(paneId);
			return;
		}
		// A brand-new pane joins the layout on the next render; wait for it.
		if (!findPane(layout, paneId)) return;
		handledPaneRevealNonceRef.current = paneRevealRequest.nonce;
		if (layout.activePaneId !== paneId) commitLayout(setActivePane(layout, paneId));
		setRevealActivePaneNonce((current) => current + 1);
	}, [
		commitLayout,
		handleFocusPoppedOutPane,
		isDetached,
		layout,
		paneRevealRequest,
		poppedOutPaneIds,
		sessionId,
	]);

	const finishClosingTab = useCallback(
		(closingSessionId: string, tab: RightPanelTab) => {
			const onClose = chatRightPanelCapability.getTabLifecycle(
				closingSessionId,
				tab.instanceId,
			)?.onClose;
			setTabCloseError(null);
			if (poppedOutPaneIds.has(tab.instanceId)) void dockPaneWindow(tab.instanceId);
			closeTab(closingSessionId, tab.instanceId);
			setCloseRequest(null);
			void Promise.resolve()
				.then(() => onClose?.())
				.catch((error: unknown) => {
					setTabCloseError(
						error instanceof Error ? error.message : `Could not clean up ${tab.title}.`,
					);
				});
		},
		[closeTab, dockPaneWindow, poppedOutPaneIds],
	);

	// Layout telemetry is recorded only at user-initiated entry points; store
	// syncs, template application, and cross-window replays stay untracked.
	const trackLayout = useCallback(
		(
			event: "Pane Opened" | "Pane Closed" | "Layout Arrangement Changed" | "Layout Preset Applied",
			data: Record<string, unknown> = {},
		) => {
			void sdk.telemetry.track({ event, data }).catch(() => undefined);
		},
		[sdk.telemetry],
	);

	const handleClosePane = useCallback(
		(paneId: string) => {
			if (isAgentPaneId(paneId)) {
				if (flattenPanes(layout).length <= 1) return;
				if (poppedOutPaneIds.has(paneId)) void dockPaneWindow(paneId);
				setChatPaneOpen(sessionId, false);
				commitLayout(removePane(layout, paneId));
				trackLayout("Pane Closed", { paneType: "chat" });
				return;
			}
			const tab = panelState.tabs.find((entry) => entry.instanceId === paneId);
			if (!tab) return;
			if (!tab.dirty) {
				finishClosingTab(sessionId, tab);
				trackLayout("Pane Closed", { paneType: tab.definitionId });
				return;
			}
			setCloseRequest({ sessionId, tab });
		},
		[
			commitLayout,
			dockPaneWindow,
			finishClosingTab,
			layout,
			panelState.tabs,
			poppedOutPaneIds,
			sessionId,
			setChatPaneOpen,
			trackLayout,
		],
	);

	const closeRequestedTab = useCallback(() => {
		if (!closeRequest) return;
		finishClosingTab(closeRequest.sessionId, closeRequest.tab);
		trackLayout("Pane Closed", { paneType: closeRequest.tab.definitionId });
	}, [closeRequest, finishClosingTab, trackLayout]);

	const wasEmptyRef = useRef(!hasMessages);

	useLayoutEffect(() => {
		if (isDetached) return;
		const emptied = wasEmptyRef.current === false && !hasMessages;
		if (emptied) {
			clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
			if (!remoteId?.trim() && sessionId !== DRAFT_RIGHT_PANEL_SESSION_KEY) {
				clearSession(sessionId);
			}
		}
		wasEmptyRef.current = !hasMessages;
	}, [clearSession, hasMessages, isDetached, remoteId, sessionId]);
	useDefaultLayout(
		sessionId,
		isDetached ? undefined : prePromotionSessionId,
		!isDetached && threadStatus === "new" && !remoteId?.trim() && !hasMessages,
		layoutsEnabled,
		availableDefinitionIds,
	);

	const handleLaunch = useCallback(
		(definition: RightPanelTabDefinition, targetGroupId?: string) => {
			openTab(
				sessionId,
				definition,
				definition.id === FILES_PANE_DEFINITION_ID && workspaceDirectory
					? {
							title: workspaceFolderName(workspaceDirectory) ?? definition.title,
							metadata: { workspaceDirectory },
						}
					: undefined,
			);
			if (!targetGroupId) return;
			const current = selectSessionRightPanelState(
				useRightPanelStore.getState().bySessionId,
				sessionId,
			);
			const paneId = current.activeTabId;
			if (!paneId) return;
			const withPane = mergeArtifactPanes(layout, current.tabs, paneId);
			commitLayout(setActivePane(movePane(withPane, paneId, targetGroupId, "inside"), paneId));
		},
		[commitLayout, layout, openTab, sessionId, workspaceDirectory],
	);

	const handleLaunchChat = useCallback(
		(targetGroupId?: string) => {
			const paneId = agentPaneId(sessionId);
			const withAgent = ensureAgentPane(layout, sessionId, aliases, chatTitle);
			setChatPaneOpen(sessionId, true);
			const next = targetGroupId ? movePane(withAgent, paneId, targetGroupId, "inside") : withAgent;
			commitLayout(setActivePane(next, paneId));
			setRevealActivePaneNonce((current) => current + 1);
		},
		[aliases, chatTitle, commitLayout, layout, sessionId, setChatPaneOpen],
	);
	const handleOpenChanges = useCallback(() => {
		const existing = panelState.tabs.findLast((tab) => tab.definitionId === "git.changes");
		if (existing) {
			if (poppedOutPaneIds.has(existing.instanceId)) {
				handleFocusPoppedOutPane(existing.instanceId);
				return;
			}
			activateTab(sessionId, existing.instanceId);
			commitLayout(setActivePane(layout, existing.instanceId));
			setRevealActivePaneNonce((current) => current + 1);
			return;
		}
		const changesDefinition = rightPanelDefinitions.find(
			(definition) => definition.id === "git.changes",
		);
		if (!changesDefinition) return;
		handleLaunch(changesDefinition);
		trackLayout("Pane Opened", { paneType: changesDefinition.id });
	}, [
		activateTab,
		commitLayout,
		handleFocusPoppedOutPane,
		handleLaunch,
		layout,
		panelState.tabs,
		poppedOutPaneIds,
		rightPanelDefinitions,
		sessionId,
		trackLayout,
	]);
	const handleAppendToChat = useCallback(
		(text: string) => {
			const draft = aui.composer.getState().text;
			aui.composer.setText(draft ? `${draft}\n\n${text}` : text);
			handleLaunchChat();
			const paneId = agentPaneId(sessionId);
			if (sdk.shell.canPopOutPanes) {
				// Drafts are window-local; dock idempotently even while the initial window list loads.
				void handleDockPoppedOutPane(paneId);
			}
		},
		[aui, handleDockPoppedOutPane, handleLaunchChat, sdk, sessionId],
	);
	const handleUserLaunch = useCallback(
		(definition: RightPanelTabDefinition, targetGroupId?: string) => {
			handleLaunch(definition, targetGroupId);
			trackLayout("Pane Opened", { paneType: definition.id });
		},
		[handleLaunch, trackLayout],
	);
	const handleUserLaunchChat = useCallback(
		(targetGroupId?: string) => {
			handleLaunchChat(targetGroupId);
			trackLayout("Pane Opened", { paneType: "chat" });
		},
		[handleLaunchChat, trackLayout],
	);
	const handleArrangementChange = useCallback(
		(next: Arrangement) => {
			if (next === "tiles") {
				const unpinned = unpinLayout(layout);
				if (unpinned !== layout) commitLayout(unpinned);
			}
			persistArrangement(sessionId, next);
			trackLayout("Layout Arrangement Changed", { arrangement: next });
		},
		[commitLayout, layout, persistArrangement, sessionId, trackLayout],
	);

	const captureLayout = useCallback(
		() => captureLayoutTemplate(layout, panelState),
		[layout, panelState],
	);
	const handleApplyLayout = useCallback(
		(preset: LayoutPreset) => {
			applyTemplate(sessionId, preset.template, availableDefinitionIds);
			trackLayout("Layout Preset Applied");
		},
		[applyTemplate, availableDefinitionIds, sessionId, trackLayout],
	);

	// Before paint: the shell header sizes itself from these actions, so a late
	// publish would grow the header a frame after the canvas appears.
	useLayoutEffect(() => {
		if (isDetached) return;
		usePaneSessionHeaderStore.setState({
			ready: true,
			sessionId,
			hasCanvas,
			workspaceDirectory: headerWorkspaceDirectory ?? null,
			arrangement,
			onArrangementChange: handleArrangementChange,
			definitions: rightPanelDefinitions,
			onLaunch: handleUserLaunch,
			onOpenChanges: handleOpenChanges,
			onAppendToChat: handleAppendToChat,
			onLaunchChat: handleUserLaunchChat,
			captureLayout,
			onApplyLayout: handleApplyLayout,
		});
		return () => resetPaneSessionHeader();
	}, [
		arrangement,
		captureLayout,
		handleApplyLayout,
		handleUserLaunch,
		handleOpenChanges,
		handleAppendToChat,
		handleUserLaunchChat,
		handleArrangementChange,
		hasCanvas,
		headerWorkspaceDirectory,
		isDetached,
		rightPanelDefinitions,
		sessionId,
	]);

	const tabsById = useMemo(() => {
		const map = new Map(panelState.tabs.map((tab) => [tab.instanceId, tab]));
		return map;
	}, [panelState.tabs]);

	const paneTitleHint = useCallback(
		(paneId: string) => {
			const tab = tabsById.get(paneId);
			if (!tab?.metadata?.workspaceDirectory || tab.metadata.relativePath) return undefined;
			return tab.metadata.workspaceDirectory;
		},
		[tabsById],
	);
	const iconForPane = useCallback(
		(paneId: string): PaneIconOverride | undefined => {
			const tab = tabsById.get(paneId);
			if (!tab) return undefined;
			const definition = rightPanelDefinitions.find((entry) => entry.id === tab.definitionId);
			if (!definition) return undefined;
			return {
				Icon: definition.Icon,
				...(tab.iconKey ? { iconKey: tab.iconKey } : {}),
			};
		},
		[rightPanelDefinitions, tabsById],
	);

	const renderPane = useCallback(
		(paneId: string) => {
			if (isAgentPaneId(paneId)) {
				return (
					<div className="flex min-h-0 flex-1 flex-col" data-qa-id="kilo-chat-thread">
						<ChatThreadSurface sessionId={sessionId} workspaceFolders={workspaceFolders} />
					</div>
				);
			}
			const tab = tabsById.get(paneId);
			if (!tab) return null;
			return (
				<div
					className="flex min-h-0 flex-1 flex-col"
					data-qa-id={`chat-pane-content-${tab.instanceId}`}
				>
					<RightPanelTabContent
						tab={tab}
						sessionId={sessionId}
						definitions={rightPanelDefinitions}
						{...(workspaceDirectory ? { workspaceDirectory } : {})}
						{...(workspaceFolders.length > 0 ? { workspaceFolders } : {})}
					/>
				</div>
			);
		},
		[rightPanelDefinitions, sessionId, tabsById, workspaceDirectory, workspaceFolders],
	);

	if (detached) {
		const pane = findPane(layout, detached.paneId);
		const paneTitle = pane?.title ?? "Pane";
		return (
			<DetachedWindowLayout
				title={
					<ChatLocationBreadcrumb
						{...(workspace?.name ? { locationLabel: workspace.name } : {})}
						{...(workspace?.color ? { locationColor: workspace.color } : {})}
						title={paneTitle}
						qaId="detached-pane-breadcrumb"
					/>
				}
				actions={
					<div className="-mr-1 flex items-center gap-1 [-webkit-app-region:no-drag]">
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Dock"
										data-qa-id="chat-pane-dock"
										onClick={() => void dockPaneWindow(detached.paneId)}
									/>
								}
							>
								<Minimize2Icon />
							</TooltipTrigger>
							<TooltipContent side="bottom">Dock</TooltipContent>
						</Tooltip>
					</div>
				}
				contentQaId="detached-pane-content"
			>
				<DetachedSessionGate remoteId={remoteId} sessionId={detached.sessionId}>
					{pane ? (
						renderPane(pane.id)
					) : (
						<div className="text-muted-foreground grid h-full place-items-center text-sm">
							This pane is no longer available.
						</div>
					)}
				</DetachedSessionGate>
			</DetachedWindowLayout>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col">
			{tabCloseError ? (
				<p
					className="text-destructive px-6 pt-4 text-sm"
					role="alert"
					data-qa-id="chat-pane-lifecycle-close-error"
				>
					{tabCloseError}
				</p>
			) : null}
			{closeRequest ? (
				<RightPanelTabCloseDialog
					key={`${closeRequest.sessionId}:${closeRequest.tab.instanceId}`}
					tab={closeRequest.tab}
					lifecycle={chatRightPanelCapability.getTabLifecycle(
						closeRequest.sessionId,
						closeRequest.tab.instanceId,
					)}
					onCancel={() => setCloseRequest(null)}
					onClose={closeRequestedTab}
				/>
			) : null}
			{/* Islands carry their own tab row, so their top edge sits where the
			    bare pane's does (the negative margin cancels the group's drop-zone
			    padding) and the switch rides the header's height transition alone. */}
			{hasCanvas ? (
				<div
					className="relative -mt-0.5 flex min-h-0 flex-1 overflow-hidden p-1.5 pt-0"
					data-qa-id="kilo-chat-page"
					data-shell-canvas
				>
					<ChatPaneCanvas
						layout={layout}
						arrangement={arrangement}
						onLayoutChange={commitLayout}
						onSelectPane={handleSelectPane}
						onClosePane={handleClosePane}
						poppedOutPaneIds={poppedOutPaneIds}
						{...(sdk.shell.canPopOutPanes
							? {
									onPopOutPane: handlePopOutPane,
									onFocusPoppedOutPane: handleFocusPoppedOutPane,
									onDockPoppedOutPane: handleDockPoppedOutPane,
								}
							: {})}
						definitions={rightPanelDefinitions}
						revealActivePaneNonce={revealActivePaneNonce}
						onLaunchChat={handleUserLaunchChat}
						onLaunch={handleUserLaunch}
						renderPane={renderPane}
						paneTitleHint={paneTitleHint}
						iconForPane={iconForPane}
					/>
				</div>
			) : (
				<div className="relative flex min-h-0 flex-1 overflow-hidden" data-qa-id="kilo-chat-page">
					<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
						<div
							className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
							data-qa-id="kilo-chat-thread"
						>
							<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
								<ChatThreadSurface sessionId={sessionId} workspaceFolders={workspaceFolders} />
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
