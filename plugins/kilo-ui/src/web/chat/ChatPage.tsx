import { useAuiState } from "@assistant-ui/react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";

import { HEADER_TRAILING_ZONE } from "@anaconda-agentic-desktop/feature-sdk";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { Thread } from "./components/assistant-ui/thread.js";
import { useChatConnection } from "./connection/ChatConnectionContext.js";
import { ChatRightPanelHeaderToggle } from "./right-panel/ChatRightPanelHeaderToggle.js";
import { RightPanelTabContent } from "./right-panel/right-panel-tab-registry.js";
import { RightPanelTabs } from "./right-panel/RightPanelTabs.js";
import {
	resolveRightPanelSessionKey,
	selectActiveRightPanelTab,
	selectSessionRightPanelState,
	useRightPanelStore,
	type RightPanelTab,
	type RightPanelTabKind,
} from "./right-panel/right-panel-store.js";

const PANEL_WIDTH_STORAGE_KEY = "kilo-ui:chat-right-panel-width";
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH_FRACTION = 0.5;
const PANEL_GAP_PX = 12; // matches w-3 gutter

const panelSpring = {
	type: "spring" as const,
	stiffness: 420,
	damping: 36,
	mass: 0.85,
};

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
	const reduceMotion = useReducedMotion();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const sessionId = resolveRightPanelSessionKey(remoteId);

	const panelState = useRightPanelStore((state) =>
		selectSessionRightPanelState(state.bySessionId, sessionId),
	);
	const activeTab = useRightPanelStore((state) =>
		selectActiveRightPanelTab(state.bySessionId, sessionId),
	);
	const openTab = useRightPanelStore((state) => state.openTab);
	const activateTab = useRightPanelStore((state) => state.activateTab);
	const closeTab = useRightPanelStore((state) => state.closeTab);

	const containerRef = useRef<HTMLDivElement>(null);
	const hasInitializedPanelWidth = useRef(false);
	const prevPanelOpenRef = useRef(panelState.isOpen);
	const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth);
	const [frameWidth, setFrameWidth] = useState(0);
	const [isResizing, setIsResizing] = useState(false);
	const [panelMounted, setPanelMounted] = useState(panelState.isOpen);
	const [maximizedBySession, setMaximizedBySession] = useState<Record<string, boolean>>({});
	const [trackedSessionId, setTrackedSessionId] = useState(sessionId);
	const maximized = maximizedBySession[sessionId] === true;
	const panelOpen = panelState.isOpen;

	const panelSlotWidth = useMotionValue(0);
	const frameWidthMotion = useMotionValue(0);
	const chatWidth = useTransform([panelSlotWidth, frameWidthMotion], ([panel, frame]) =>
		Math.max(0, (frame as number) - (panel as number)),
	);

	// Page-scoped shell contribution: toggle lives in the app header only while
	// the chat route is mounted.
	useEffect(() => {
		return sdk.contribute(HEADER_TRAILING_ZONE, {
			component: ChatRightPanelHeaderToggle,
			label: "Chat right panel toggle",
			priority: 10,
		});
	}, [sdk]);

	const sessionChanged = sessionId !== trackedSessionId;
	if (sessionChanged) {
		setTrackedSessionId(sessionId);
	}

	// Closing the panel clears maximize for this session.
	if (!panelOpen && maximized) {
		setMaximizedBySession((prev) => {
			if (!prev[sessionId]) return prev;
			const { [sessionId]: _removed, ...rest } = prev;
			return rest;
		});
	}

	const clampPanelWidth = useCallback((value: number) => {
		const containerWidth = containerRef.current?.clientWidth ?? 1280;
		const maxWidth = Math.floor(containerWidth * PANEL_MAX_WIDTH_FRACTION);
		return Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, value));
	}, []);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const update = () => {
			const width = el.clientWidth;
			setFrameWidth(width);
			frameWidthMotion.set(width);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, [frameWidthMotion]);

	useEffect(() => {
		setPanelWidth((current) => clampPanelWidth(current));
	}, [clampPanelWidth, panelOpen]);

	const openWidth = maximized && frameWidth > 0 ? frameWidth : panelWidth + PANEL_GAP_PX;
	const targetPanelWidth = panelOpen ? openWidth : 0;

	// Only the open/close toggle springs. Maximize, resize, and session changes snap.
	useEffect(() => {
		const openChanged = prevPanelOpenRef.current !== panelOpen;
		prevPanelOpenRef.current = panelOpen;

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
			shouldSpring ? panelSpring : { duration: 0 },
		);
		void controls.then(() => {
			if (!panelOpen) setPanelMounted(false);
		});
		return () => controls.stop();
	}, [panelSlotWidth, targetPanelWidth, panelOpen, sessionChanged, reduceMotion, isResizing]);

	const toggleMaximized = useCallback(() => {
		setMaximizedBySession((prev) => ({
			...prev,
			[sessionId]: !prev[sessionId],
		}));
	}, [sessionId]);

	const handleActivate = useCallback(
		(tab: RightPanelTab) => {
			activateTab(sessionId, tab.id);
		},
		[activateTab, sessionId],
	);

	const handleCloseTab = useCallback(
		(tab: RightPanelTab) => {
			closeTab(sessionId, tab.id);
		},
		[closeTab, sessionId],
	);

	const handleAddTab = useCallback(
		(kind: RightPanelTabKind) => {
			openTab(sessionId, kind);
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
			activeTabId={panelOpen ? panelState.activeTabId : null}
			onActivate={handleActivate}
			onCloseTab={handleCloseTab}
			onAddTab={handleAddTab}
		>
			{activeTab ? <RightPanelTabContent tab={activeTab} /> : null}
		</RightPanelTabs>
	);

	return (
		<>
			{connection.isError ? (
				<p className="text-destructive px-6 pt-4 text-sm" role="alert" data-qa-id="kilo-chat-error">
					Could not connect to Kilo:{" "}
					{connection.error instanceof Error ? connection.error.message : String(connection.error)}
				</p>
			) : null}
			<div
				ref={containerRef}
				className="relative flex h-full min-h-0 overflow-hidden"
				data-qa-id="kilo-chat-page"
			>
				<motion.div
					className={cn(
						"min-h-0 min-w-0 overflow-hidden",
						frameWidth <= 0 && "flex-1",
						maximized && panelOpen && "pointer-events-none",
					)}
					style={frameWidth > 0 ? { width: chatWidth } : undefined}
				>
					<div
						className="bg-muted border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border"
						data-qa-id="kilo-chat-thread"
						data-chat-column-maximized-away={maximized && panelOpen ? "true" : "false"}
					>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<Thread />
						</div>
					</div>
				</motion.div>

				<motion.div
					className="h-full min-w-0 shrink-0 overflow-hidden"
					style={{ width: panelSlotWidth }}
				>
					{panelMounted ? (
						<div className="flex h-full shrink-0" style={{ width: openWidth }}>
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
