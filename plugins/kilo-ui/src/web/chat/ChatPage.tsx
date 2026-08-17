import { useAuiState } from "@assistant-ui/react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";

import { HEADER_LEADING_ZONE, HEADER_TRAILING_ZONE } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import {
	SHELL_LAYOUT_SNAP,
	SHELL_LAYOUT_SPRING,
} from "@anaconda-agentic-desktop/ui/lib/shell-motion";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { ChatSessionBreadcrumb } from "./ChatSessionBreadcrumb.js";
import { resolveChatWorkspaceDirectory } from "./chat-workspace-directory.js";
import { Thread } from "./components/assistant-ui/thread.js";
import { useChatConnection } from "./connection/ChatConnectionContext.js";
import { chatRightPanelCapability } from "./right-panel/chat-right-panel-capability.js";
import { ChatRightPanelHeaderToggle } from "./right-panel/ChatRightPanelHeaderToggle.js";
import { RightPanelTabCloseDialog } from "./right-panel/RightPanelTabCloseDialog.js";
import {
	RightPanelTabContent,
	type RightPanelTabDefinition,
	useRightPanelTabDefinitions,
} from "./right-panel/right-panel-tab-registry.js";
import { RightPanelTabs } from "./right-panel/RightPanelTabs.js";
import {
	resolveRightPanelSessionKey,
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
} from "./right-panel/right-panel-store.js";
import { useSessionActivity } from "./session-activity/SessionActivityProvider.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";

const PANEL_WIDTH_STORAGE_KEY = "kilo-ui:chat-right-panel-width";
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH_FRACTION = 0.5;
const PANEL_GAP_PX = 12; // matches w-3 gutter

function readStoredPanelWidth(): number {
	try {
		const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
		const parsed = raw == null ? NaN : Number(raw);
		return Number.isFinite(parsed) ? parsed : PANEL_DEFAULT_WIDTH;
	} catch {
		return PANEL_DEFAULT_WIDTH;
	}
}

function writeStoredPanelWidth(width: number): void {
	try {
		localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)));
	} catch {
		// Ignore quota / private-mode failures.
	}
}

/**
 * Full-page chat surface contributed by kilo-ui (`/plugins/chat`).
 * Connection and `AssistantRuntimeProvider` live in `ChatFeatureProvider`
 * so the shell sidebar SessionList shares the same runtime.
 */
export function ChatPage() {
	const sdk = useSdk("kilo-ui");
	const connection = useChatConnection();
	const rightPanelDefinitions = useRightPanelTabDefinitions();
	const reduceMotion = useReducedMotion();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const localThreadId = useAuiState((s) => s.threadListItem.id);
	const sessionId = resolveRightPanelSessionKey(remoteId, localThreadId);
	const maximizeSessionId = localThreadId?.trim() ? localThreadId : sessionId;
	const { activeWorkspaceId, workspaces } = useWorkspacesFeature();
	const sessionWorkspaceId = useSessionActivity((state) =>
		remoteId ? state.sessions[remoteId]?.workspaceId : undefined,
	);
	const workspaceDirectory = resolveChatWorkspaceDirectory({
		remoteId,
		activeWorkspaceId,
		sessionWorkspaceId,
		workspaces,
	});

	const panelState = useRightPanelStore((state) =>
		selectSessionRightPanelState(state.bySessionId, sessionId),
	);
	const openTab = useRightPanelStore((state) => state.openTab);
	const activateTab = useRightPanelStore((state) => state.activateTab);
	const closeTab = useRightPanelStore((state) => state.closeTab);
	const moveSessionState = useRightPanelStore((state) => state.moveSessionState);

	const containerRef = useRef<HTMLDivElement>(null);
	const hasInitializedPanelWidth = useRef(false);
	const prevPanelOpenRef = useRef(panelState.isOpen);
	const previousSessionIdRef = useRef(sessionId);
	const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth);
	const [isResizing, setIsResizing] = useState(false);
	const [panelMounted, setPanelMounted] = useState(panelState.isOpen);
	const [maximizedBySession, setMaximizedBySession] = useState<Record<string, boolean>>({});
	const [closeRequest, setCloseRequest] = useState<{
		readonly sessionId: string;
		readonly tab: RightPanelTab;
	} | null>(null);
	const panelOpen = panelState.isOpen;
	const maximized = panelOpen && maximizedBySession[maximizeSessionId] === true;

	const panelSlotWidth = useMotionValue(0);

	// Page-scoped shell contributions: breadcrumb + panel toggle live in the app
	// header only while the chat route is mounted.
	useEffect(() => {
		const removeBreadcrumb = sdk.contribute(HEADER_LEADING_ZONE, {
			id: "chat-session-breadcrumb",
			component: ChatSessionBreadcrumb,
			label: "Chat session breadcrumb",
			priority: 10,
		});
		const removeToggle = sdk.contribute(HEADER_TRAILING_ZONE, {
			id: "chat-right-panel-toggle",
			component: ChatRightPanelHeaderToggle,
			label: "Chat right panel toggle",
			priority: 10,
		});
		return () => {
			removeBreadcrumb();
			removeToggle();
		};
	}, [sdk]);

	// WebMCP tools resolve "current session" from this focused key.
	useEffect(() => {
		chatRightPanelCapability.setFocusedSessionId(sessionId);
		return () => {
			if (chatRightPanelCapability.getFocusedSessionId() === sessionId) {
				chatRightPanelCapability.setFocusedSessionId(null);
			}
		};
	}, [sessionId]);

	useLayoutEffect(() => {
		if (!remoteId?.trim() || !localThreadId?.trim() || remoteId === localThreadId) return;
		moveSessionState(localThreadId, remoteId);
	}, [localThreadId, moveSessionState, remoteId]);

	const sessionChanged = sessionId !== previousSessionIdRef.current;

	// Closing the panel clears maximize for this session.
	useEffect(() => {
		if (panelOpen) return;
		setMaximizedBySession((prev) => {
			if (!prev[maximizeSessionId]) return prev;
			const { [maximizeSessionId]: _removed, ...rest } = prev;
			return rest;
		});
	}, [maximizeSessionId, panelOpen]);

	const clampPanelWidth = useCallback((value: number) => {
		const containerWidth = containerRef.current?.clientWidth ?? 1280;
		const maxWidth = Math.floor(containerWidth * PANEL_MAX_WIDTH_FRACTION);
		return Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, value));
	}, []);

	useEffect(() => {
		setPanelWidth((current) => clampPanelWidth(current));
	}, [clampPanelWidth, panelOpen]);

	const openWidth = panelWidth + PANEL_GAP_PX;
	const targetPanelWidth = panelOpen ? openWidth : 0;

	// Only the open/close toggle springs. Maximize, resize, and session changes snap.
	useEffect(() => {
		const openChanged = prevPanelOpenRef.current !== panelOpen;
		prevPanelOpenRef.current = panelOpen;
		previousSessionIdRef.current = sessionId;

		if (panelOpen) {
			setPanelMounted(true);
		}

		if (!hasInitializedPanelWidth.current) {
			hasInitializedPanelWidth.current = true;
			panelSlotWidth.set(targetPanelWidth);
			if (!panelOpen) setPanelMounted(false);
			return;
		}

		if (sessionChanged) {
			panelSlotWidth.set(targetPanelWidth);
			setPanelMounted(panelOpen);
			return;
		}

		const shouldSpring = openChanged && !reduceMotion && !isResizing;
		const controls = animate(
			panelSlotWidth,
			targetPanelWidth,
			shouldSpring ? SHELL_LAYOUT_SPRING : SHELL_LAYOUT_SNAP,
		);
		void controls.then(() => {
			if (!panelOpen) setPanelMounted(false);
		});
		return () => controls.stop();
	}, [
		panelSlotWidth,
		targetPanelWidth,
		panelOpen,
		sessionChanged,
		sessionId,
		reduceMotion,
		isResizing,
	]);

	const toggleMaximized = useCallback(() => {
		setMaximizedBySession((prev) => ({
			...prev,
			[maximizeSessionId]: !prev[maximizeSessionId],
		}));
	}, [maximizeSessionId]);

	const handleActivate = useCallback(
		(tab: RightPanelTab) => {
			activateTab(sessionId, tab.instanceId);
		},
		[activateTab, sessionId],
	);

	const handleCloseTab = useCallback(
		(tab: RightPanelTab) => {
			if (!tab.dirty) {
				closeTab(sessionId, tab.instanceId);
				return;
			}
			setCloseRequest({ sessionId, tab });
		},
		[closeTab, sessionId],
	);

	const closeRequestedTab = useCallback(() => {
		if (!closeRequest) return;
		closeTab(closeRequest.sessionId, closeRequest.tab.instanceId);
		setCloseRequest(null);
	}, [closeRequest, closeTab]);

	const handleAddTab = useCallback(
		(definition: RightPanelTabDefinition) => {
			openTab(sessionId, definition);
		},
		[openTab, sessionId],
	);

	const handleResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const handle = event.currentTarget;
			const startX = event.clientX;
			const startWidth = panelWidth;
			handle.setPointerCapture(event.pointerId);
			setIsResizing(true);

			const onMove = (moveEvent: PointerEvent) => {
				const delta = startX - moveEvent.clientX;
				const next = clampPanelWidth(startWidth + delta);
				setPanelWidth(next);
				panelSlotWidth.set(next + PANEL_GAP_PX);
			};
			const onUp = (upEvent: PointerEvent) => {
				handle.releasePointerCapture(upEvent.pointerId);
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onUp);
				setIsResizing(false);
				setPanelWidth((current) => {
					const next = clampPanelWidth(current);
					writeStoredPanelWidth(next);
					panelSlotWidth.set(next + PANEL_GAP_PX);
					return next;
				});
			};

			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onUp);
		},
		[clampPanelWidth, panelWidth, panelSlotWidth],
	);

	const panel = (
		<RightPanelTabs
			maximized={maximized}
			onToggleMaximized={toggleMaximized}
			tabs={panelState.tabs}
			definitions={rightPanelDefinitions}
			activeTabId={panelOpen ? panelState.activeTabId : null}
			onActivate={handleActivate}
			onCloseTab={handleCloseTab}
			onAddTab={handleAddTab}
		>
			{panelState.tabs.map((tab) => {
				const active = tab.instanceId === panelState.activeTabId;
				return (
					<div
						key={tab.instanceId}
						hidden={!active}
						className="min-h-0 flex-1 flex-col data-[active=true]:flex"
						data-active={active}
						data-qa-id={`chat-right-panel-content-${tab.instanceId}`}
					>
						<RightPanelTabContent
							tab={tab}
							sessionId={sessionId}
							definitions={rightPanelDefinitions}
							{...(workspaceDirectory ? { workspaceDirectory } : {})}
						/>
					</div>
				);
			})}
		</RightPanelTabs>
	);

	return (
		<>
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
			{connection.isError ? (
				<p
					className="text-destructive-foreground px-6 pt-4 text-sm"
					role="alert"
					data-qa-id="kilo-chat-error"
				>
					Could not connect to Kilo:{" "}
					{connection.error instanceof Error ? connection.error.message : String(connection.error)}
				</p>
			) : null}
			<div
				ref={containerRef}
				className="relative flex h-full min-h-0 overflow-hidden"
				data-qa-id="kilo-chat-page"
			>
				{/*
				  Chat column is flex-1 so it tracks shell layout (left-nav open/close) in the
				  same frame as the nav spring. Pixel widths derived from ResizeObserver
				  lagged that animation and made the right edge jump.
				*/}
				<div
					className={cn(
						"min-h-0 min-w-0 overflow-hidden",
						maximized && panelOpen ? "pointer-events-none w-0" : "flex-1",
					)}
				>
					<div
						className="bg-muted border-border relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border"
						data-qa-id="kilo-chat-thread"
						data-chat-column-maximized-away={maximized && panelOpen ? "true" : "false"}
					>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<Thread />
						</div>
					</div>
				</div>

				<motion.div
					className={cn(
						"h-full min-w-0 overflow-hidden",
						maximized && panelOpen ? "min-w-0 flex-1" : "shrink-0",
					)}
					{...(maximized && panelOpen ? {} : { style: { width: panelSlotWidth } })}
				>
					{panelMounted ? (
						<div
							className={cn("flex h-full", maximized ? "w-full" : "shrink-0")}
							style={maximized ? undefined : { width: openWidth }}
						>
							{maximized ? null : (
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize right panel"
									data-qa-id="chat-right-panel-resize"
									className="w-3 shrink-0 cursor-col-resize touch-none bg-transparent"
									onPointerDown={handleResizePointerDown}
								/>
							)}
							<div className="h-full min-w-0 flex-1 overflow-hidden">{panel}</div>
						</div>
					) : null}
				</motion.div>
			</div>
		</>
	);
}
