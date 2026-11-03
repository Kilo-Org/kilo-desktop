import { BellIcon } from "lucide-react";

import {
	definePlugin,
	KernelCommand,
	KernelWindows,
	KernelWindowView,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import {
	PaneKind,
	Panes,
	SessionRenderer,
	Sessions,
	type PaneImplementation,
	type SessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";
import type { PaneKind as LayoutKind } from "@kilo-desktop/pane-layout";
import { Main, SettingsSection, LeftSidebar } from "@kilo-desktop/plugin-shell/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { Navigator, PaneLauncher, SessionAction } from "../contracts";
import { followLastVisits, loadLastVisits } from "./attention/last-visited";
import { sessionsNeedingAttention } from "./attention/live-activity";
import { trackVisits } from "./attention/visits";
import { SessionHeaderActions, SessionHeaderLeading } from "./home/SessionHeader";
import { WorkbenchHome } from "./home/WorkbenchHome";
import { LayoutPresetsMenu } from "./layouts/LayoutPresetsMenu";
import { resetListState, sessionSearch, visibleSessions } from "./list-state";
import { SessionList } from "./list/SessionList";
import { SESSION_RENDERERS } from "./list/session-renderers";
import { adjacentId, idAtShortcutSlot, nextCandidateId, NUMBERED_SLOTS } from "./numbered-sessions";
import { startNewSession } from "./new-session";
import { provideNavigator } from "./navigator";
import { notificationPreferences } from "./notifications/notification-preferences";
import { NotificationSettings } from "./notifications/NotificationSettings";
import { startChatNotifier } from "./notifications/start-notifier";
import {
	closePane,
	launchPaneForPerson,
	panesInOrder,
	sessionPanesOf,
	setArrangement,
	type PanesHandle,
} from "./panes/pane-actions";
import { panePicker } from "./panes/pane-picker";
import { PaneWindowView } from "./panes/PaneWindowView";
import { paneWindows, reconcilePopOuts } from "./panes/pop-outs";
import { sessionLayout } from "./panes/session-layout";
import { workbenchTelemetry, type TrackWorkbench } from "./telemetry";
import { SessionsViewWindow } from "./views/SessionsViewHost";

/** kilo.workbench's renderer entry: the session list, the home view and their commands. */
export const workbenchWebEntry = definePlugin({
	activate(sdk) {
		resetListState();
		notificationPreferences.reload();
		sdk.extensions.implement(KernelWindowView, "pane", PaneWindowView);
		sdk.extensions.implement(KernelWindowView, "sessions-view-window", SessionsViewWindow);
		sdk.extensions.implement(SessionRenderer, "sessions", SESSION_RENDERERS);
		sdk.extensions.implement(SettingsSection, "notifications", {
			component: NotificationSettings,
			icon: BellIcon,
		});
		if (sdk.context.get("kernel/secondaryWindow")) {
			loadLastVisits();
			sdk.onDispose(followLastVisits());
			return;
		}
		const { showInPlace } = provideNavigator(sdk);
		trackVisits(sdk, loadLastVisits());
		startChatNotifier(sdk);
		sdk.onDispose(reconcilePopOuts(sdk));
		sdk.extensions.implement(LeftSidebar, "sessions", SessionList);
		sdk.extensions.implement(Main, "workbench", {
			component: WorkbenchHome,
			headerLeading: SessionHeaderLeading,
			headerActions: SessionHeaderActions,
		});
		sdk.extensions.implement(SessionAction, "layouts", LayoutPresetsMenu);
		implementCommands(sdk, (sessionId) => openSession(sdk, sessionId));
		sdk.extensions.implement(KernelCommand, "open-session", (args) => {
			const sessionId = (args as { sessionId?: unknown } | undefined)?.sessionId;
			if (typeof sessionId === "string") openSession(sdk, sessionId);
		});
		sdk.extensions.implement(KernelCommand, "show-sessions-view", (args) => {
			const view = (args as { view?: unknown } | undefined)?.view;
			if (typeof view === "string") showInPlace(view);
		});
		implementPaneCommands(sdk);
	},
});

function openSession(sdk: PluginSdk, sessionId: string): void {
	void sdk.domains.get(Navigator)?.methods.open({ sessionId });
}

function implementCommands(sdk: PluginSdk, open: (sessionId: string) => void): void {
	const activeSessionId = () => sdk.domains.get(Navigator)?.getState().activeSessionId ?? undefined;
	const command = (id: string, handler: () => void) =>
		sdk.extensions.implement(KernelCommand, id, handler);

	command("new-session", () =>
		startNewSession({
			sessions: sdk.domains.get(Sessions),
			navigator: sdk.domains.get(Navigator),
			workspaces: sdk.domains.get(Workspaces),
		}),
	);
	command("search", sessionSearch.toggle);
	const step = (delta: 1 | -1) => {
		const sessionId = adjacentId(visibleSessions.get(), activeSessionId(), delta);
		if (sessionId) open(sessionId);
	};
	command("next-session", () => step(1));
	command("previous-session", () => step(-1));
	command("next-attention-session", () => {
		const order = visibleSessions.get();
		const sessionId = nextCandidateId(
			order,
			sessionsNeedingAttention(sdk, order),
			activeSessionId(),
		);
		if (sessionId) open(sessionId);
	});
	command("toggle-pin-session", () => {
		const sessions = sdk.domains.get(Sessions);
		const session = sessions?.getState().sessions.find(({ id }) => id === activeSessionId());
		if (!sessions || !session || session.archived) return;
		void sessions.methods
			.setPinned({ id: session.id, pinned: !session.pinned })
			.catch(() => undefined);
	});
	for (const slot of NUMBERED_SLOTS) {
		command(slot === 9 ? "session-last" : `session-${slot}`, () => {
			const sessionId = idAtShortcutSlot(visibleSessions.get(), slot);
			if (sessionId) open(sessionId);
		});
	}
}

/** Tab commands act on the panes of this window's open session. */
function implementPaneCommands(sdk: PluginSdk): void {
	const command = (id: string, handler: () => void) =>
		sdk.extensions.implement(KernelCommand, id, handler);
	const track = workbenchTelemetry(sdk);
	const layoutKindOf = (kind: string) =>
		sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)?.metadata
			.layoutKind ?? "tool";
	const current = () => {
		const sessionId = sdk.domains.get(Navigator)?.getState().activeSessionId;
		const panes = sdk.domains.get(Panes);
		if (!sessionId || !panes) return null;
		const state = sessionPanesOf(panes, sessionId);
		const layout = sessionLayout(state, layoutKindOf);
		return { sessionId, panes, state, order: panesInOrder(layout) };
	};
	const show = (pick: (order: string[], activeId: string | null) => string | undefined) => {
		const session = current();
		const paneId = session && pick(session.order, session.state.activePaneId);
		if (!session || !paneId) return;
		void session.panes.methods
			.activate({ sessionId: session.sessionId, paneId })
			.catch(() => undefined);
	};

	command("new-pane", () => panePicker.open({ placement: undefined, title: "New tab" }));
	command("new-group-right", () =>
		panePicker.open({ placement: { beside: "after" }, title: "New group" }),
	);
	command("new-group-below", () =>
		panePicker.open({ placement: { beside: "below" }, title: "New group" }),
	);
	command("close-pane", () => {
		const session = current();
		const paneId = session?.state.activePaneId;
		if (!session || !paneId) return;
		void closePane(
			session.panes,
			session.sessionId,
			paneId,
			(kind) =>
				sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)
					?.implementation as PaneImplementation | undefined,
			track,
		).catch(() => undefined);
	});
	command("next-pane", () => show((order, active) => adjacentId(order, active ?? undefined, 1)));
	command("previous-pane", () =>
		show((order, active) => adjacentId(order, active ?? undefined, -1)),
	);
	command("toggle-carousel", () => {
		const session = current();
		if (!session) return;
		void setArrangement(
			session.panes,
			session.sessionId,
			session.state.arrangement === "carousel" ? "tiles" : "carousel",
			track,
		).catch(() => undefined);
	});
	sdk.domains.provide(PaneLauncher, {
		initialState: {},
		methods: {
			openOrShow: async ({ kind }) => {
				const session = current();
				if (session) await openOrShowPane(sdk, session, kind, layoutKindOf, track);
			},
		},
	});
	for (const slot of NUMBERED_SLOTS) {
		command(slot === 9 ? "pane-last" : `pane-${slot}`, () =>
			show((order) => idAtShortcutSlot(order, slot)),
		);
	}
}

/**
 * Shows the session's last pane of `kind` — its window when popped out — or,
 * when it has none, opens one as if picked from "+" (reported as opened).
 */
async function openOrShowPane(
	sdk: PluginSdk,
	session: {
		readonly sessionId: string;
		readonly panes: PanesHandle;
		readonly state: SessionPanes;
	},
	kind: string,
	layoutKindOf: (kind: string) => LayoutKind,
	track: TrackWorkbench,
): Promise<void> {
	const { sessionId, panes } = session;
	const existing = session.state.panes.findLast((pane) => pane.kind === kind);
	if (!existing) {
		await launchPaneForPerson(track, panes, sessionId, kind, layoutKindOf);
		return;
	}
	const windows = sdk.domains.get(KernelWindows);
	const popOut = windows
		? paneWindows(windows.getState()).find(
				(window) => window.sessionId === sessionId && window.paneId === existing.id,
			)
		: undefined;
	if (windows && popOut) await windows.methods.focus({ windowId: popOut.windowId });
	else await panes.methods.activate({ sessionId, paneId: existing.id });
}
