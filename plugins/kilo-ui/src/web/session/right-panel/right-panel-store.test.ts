import { beforeEach, describe, expect, it } from "vitest";
import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";

import { PLAN_TAB_DEFINITION_ID } from "./right-panel-tab-registry.js";
import {
	DEFAULT_ARRANGEMENT,
	persistedRightPanelState,
	RIGHT_PANEL_STORAGE_KEY,
	selectActiveRightPanelTab,
	selectSessionRightPanelState,
	useRightPanelStore,
	type SessionRightPanelState,
} from "./right-panel-store.js";

const SESSION = "session-1";
const CANVAS = { id: "canvas.canvas", title: "Canvas" };

beforeEach(() => {
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("right-panel-store", () => {
	it("initializes a draft once, remembers no-default, and never overwrites existing panes", () => {
		const template = {
			version: 1 as const,
			arrangement: "carousel" as const,
			slots: [],
			groups: [],
		};
		useRightPanelStore.getState().initializeDefaultLayout("draft", undefined, []);
		useRightPanelStore.getState().initializeDefaultLayout("draft", template, []);
		expect(useRightPanelStore.getState().bySessionId.draft?.arrangement).toBe("tiles");
		useRightPanelStore.getState().setArrangement("draft", "tiles");
		expect(useRightPanelStore.getState().bySessionId.draft?.defaultLayoutInitialized).toBe(true);
		useRightPanelStore.getState().clearSession("draft");
		useRightPanelStore.getState().initializeDefaultLayout("draft", template, []);
		expect(useRightPanelStore.getState().bySessionId.draft?.arrangement).toBe("carousel");
		useRightPanelStore.getState().openTab("modified", CANVAS);
		const before = useRightPanelStore.getState().bySessionId.modified;
		useRightPanelStore.getState().initializeDefaultLayout("modified", template, []);
		expect(useRightPanelStore.getState().bySessionId.modified).toBe(before);
	});
	it("applies preset tabs and geometry in a single observable update", () => {
		const observations: SessionRightPanelState[] = [];
		const unsubscribe = useRightPanelStore.subscribe((state) => {
			observations.push(selectSessionRightPanelState(state.bySessionId, SESSION));
		});
		try {
			useRightPanelStore.getState().applyTemplate(
				SESSION,
				{
					version: 1,
					arrangement: "carousel",
					activePaneId: "terminal",
					slots: [
						{ id: "chat", type: "chat" },
						{ id: "terminal", type: "terminal" },
					],
					groups: [
						{
							id: "tabs",
							tabs: ["chat", "terminal"],
							activePaneId: "terminal",
							width: 500,
							pinned: false,
						},
					],
				},
				["terminal.terminal"],
			);
			expect(observations).toHaveLength(1);
			const state = observations[0]!;
			expect(state.arrangement).toBe("carousel");
			expect(state.tabs).toHaveLength(1);
			expect(state.activeTabId).toBe(state.tabs[0]?.instanceId);
			expect(flattenPanes(parseLayoutJson(state.layoutJson)!).map((pane) => pane.id)).toEqual([
				"agent:session-1",
				state.tabs[0]?.instanceId,
			]);
		} finally {
			unsubscribe();
		}
	});
	it("filters default layouts against the currently available definitions", () => {
		useRightPanelStore.getState().initializeDefaultLayout(
			SESSION,
			{
				version: 1,
				arrangement: "tiles",
				slots: [
					{ id: "chat", type: "chat" },
					{ id: "changes", type: "changes" },
				],
				groups: [
					{
						id: "tabs",
						tabs: ["chat", "changes"],
						activePaneId: "changes",
						width: 500,
						pinned: false,
					},
				],
			},
			["terminal.terminal"],
		);

		const state = useRightPanelStore.getState().bySessionId[SESSION]!;
		expect(state.tabs).toEqual([]);
		expect(flattenPanes(parseLayoutJson(state.layoutJson)!).map((pane) => pane.id)).toEqual([
			"agent:session-1",
		]);
	});
	it("uses fresh grouped-layout persistence with Tiles as the default", () => {
		expect(RIGHT_PANEL_STORAGE_KEY).toBe("kilo-ui:right-panel-state:v3");
		expect(DEFAULT_ARRANGEMENT).toBe("tiles");
		expect(useRightPanelStore.persist.getOptions().version).toBe(1);
	});

	it("falls back from a persisted legacy arrangement to Tiles", () => {
		const stored = {
			[SESSION]: {
				activeTabId: null,
				tabs: [],
				planAnchorCallId: null,
				arrangement: "tabs",
			},
		} as unknown as Record<string, SessionRightPanelState>;

		expect(selectSessionRightPanelState(stored, SESSION).arrangement).toBe("tiles");
	});

	it("keeps arrangement choices for a chat without artifact panes", () => {
		useRightPanelStore.getState().setArrangement(SESSION, "tiles");
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION).arrangement,
		).toBe("tiles");

		useRightPanelStore.getState().setArrangement(SESSION, "carousel");
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION).arrangement,
		).toBe("carousel");
	});

	it("opens multiple numbered contributions and selects the newest", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);

		expect(state.tabs.map(({ title }) => title)).toEqual(["Canvas 1", "Canvas 2"]);
		expect(new Set(state.tabs.map(({ instanceId }) => instanceId)).size).toBe(2);
		expect(
			selectActiveRightPanelTab(useRightPanelStore.getState().bySessionId, SESSION)?.title,
		).toBe("Canvas 2");
	});

	it("can open a contribution without focusing it", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS, { activate: false, title: "Canvas" });
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.tabs.map(({ title }) => title)).toEqual(["Canvas"]);
		expect(state.activeTabId).toBeNull();
	});

	it("keeps Plan singleton and maintains its historical anchor", () => {
		useRightPanelStore.getState().openPlan(SESSION, { anchorCallId: "write-1" });
		useRightPanelStore.getState().openPlan(SESSION, { anchorCallId: "edit-2" });
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.tabs).toEqual([
			{
				instanceId: "plan",
				definitionId: PLAN_TAB_DEFINITION_ID,
				title: "Plan",
				ordinal: null,
			},
		]);
		expect(state.planAnchorCallId).toBe("edit-2");
	});

	it("forgets which plan snapshot was open when the Plan tab closes", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		useRightPanelStore
			.getState()
			.openPlan(SESSION, { anchorCallId: "write-1", newestAnchorCallId: "write-2" });

		useRightPanelStore.getState().closeTab(SESSION, "plan");

		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.planAnchorCallId).toBeNull();
		expect(state.planNewestAnchorCallIdAtOpen ?? null).toBeNull();
	});

	it("returns empty state after closing the last tab", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		const [tab] = useRightPanelStore.getState().bySessionId[SESSION]!.tabs;
		useRightPanelStore.getState().closeTab(SESSION, tab!.instanceId);
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION),
		).toEqual({
			activeTabId: null,
			tabs: [],
			planAnchorCallId: null,
			arrangement: "tiles",
		});
	});

	it("isolates tabs by chat session", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		useRightPanelStore.getState().setArrangement("session-2", "carousel");
		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs).toHaveLength(1);
		expect(useRightPanelStore.getState().bySessionId["session-2"]?.tabs).toHaveLength(0);
	});

	it("updates dirty state without persisting it", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		const tab = useRightPanelStore.getState().bySessionId[SESSION]!.tabs[0]!;

		useRightPanelStore.getState().updateTab(SESSION, tab.instanceId, { dirty: true });

		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs[0]?.dirty).toBe(true);
		const persisted = persistedRightPanelState(useRightPanelStore.getState());
		expect(persisted.bySessionId[SESSION]?.tabs[0]).not.toHaveProperty("dirty");
	});

	it("persists contribution metadata needed to restore backing resources", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS, {
			metadata: { notebookPath: "/projects/analysis.ipynb" },
		});

		const persisted = persistedRightPanelState(useRightPanelStore.getState());
		expect(persisted.bySessionId[SESSION]?.tabs[0]?.metadata).toEqual({
			notebookPath: "/projects/analysis.ipynb",
		});
	});

	it("omits transient tabs from persisted state", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS, {
			metadata: { notebookOpenState: "opening" },
			transient: true,
		});

		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs).toHaveLength(1);
		expect(
			persistedRightPanelState(useRightPanelStore.getState()).bySessionId[SESSION],
		).toMatchObject({
			activeTabId: null,
			tabs: [],
		});
	});

	it("updates and persists a contribution-provided tab title", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		const tab = useRightPanelStore.getState().bySessionId[SESSION]!.tabs[0]!;

		useRightPanelStore.getState().updateTab(SESSION, tab.instanceId, {
			title: "analysis.ipynb",
		});

		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs[0]?.title).toBe(
			"analysis.ipynb",
		);
		expect(
			persistedRightPanelState(useRightPanelStore.getState()).bySessionId[SESSION]?.tabs[0]?.title,
		).toBe("analysis.ipynb");
	});

	it("moves pane state saved under adopted chats' ids to their new sessions", () => {
		useRightPanelStore.getState().openTab("ses_1", CANVAS);
		useRightPanelStore.getState().openTab("wses_b", CANVAS);
		useRightPanelStore.getState().openTab("ses_2", CANVAS);
		const kept = useRightPanelStore.getState().bySessionId.wses_b;

		useRightPanelStore.getState().renameSessions({ ses_1: "wses_a", ses_2: "wses_b" });

		const { bySessionId } = useRightPanelStore.getState();
		expect(Object.keys(bySessionId).sort()).toEqual(["wses_a", "wses_b"]);
		expect(bySessionId.wses_a?.tabs).toHaveLength(1);
		expect(bySessionId.wses_b).toBe(kept);
	});

	it("clears pane state for a session", () => {
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		useRightPanelStore.getState().setArrangement(SESSION, "tiles");
		useRightPanelStore.getState().clearSession(SESSION);
		expect(useRightPanelStore.getState().bySessionId[SESSION]).toBeUndefined();
	});

	it("omits a marker-only default decision from persisted pane state", () => {
		useRightPanelStore.getState().initializeDefaultLayout(SESSION, undefined, []);
		expect(useRightPanelStore.getState().bySessionId[SESSION]?.defaultLayoutInitialized).toBe(true);
		expect(
			persistedRightPanelState(useRightPanelStore.getState()).bySessionId[SESSION],
		).toBeUndefined();
	});
});
