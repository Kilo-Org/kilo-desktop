import { beforeEach, describe, expect, it } from "vitest";
import { flattenPanes, parseLayoutJson } from "@kilo-desktop/pane-layout";

import { PLAN_TAB_DEFINITION_ID } from "./right-panel-tab-registry.js";
import {
	DEFAULT_ARRANGEMENT,
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	persistedRightPanelState,
	resolveRightPanelSessionKey,
	resolveVisibleRightPanelSessionKey,
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

describe("resolveRightPanelSessionKey", () => {
	it("uses a stable local id until a remote session exists", () => {
		expect(resolveRightPanelSessionKey(undefined)).toBe(DRAFT_RIGHT_PANEL_SESSION_KEY);
		expect(resolveRightPanelSessionKey(undefined, "local-1")).toBe("local-1");
		expect(resolveRightPanelSessionKey("remote-1", "local-1")).toBe("remote-1");
	});
});

describe("resolveVisibleRightPanelSessionKey", () => {
	const withPanes = (key: string): Record<string, SessionRightPanelState> => ({
		[key]: { activeTabId: null, tabs: [], planAnchorCallId: null, layoutJson: "{}" },
	});

	it("returns the promoted key when no promotion is in flight", () => {
		expect(resolveVisibleRightPanelSessionKey({}, "local-1", "local-1")).toBe("local-1");
	});

	it("returns the promoted key once its bucket exists", () => {
		const bySessionId = withPanes("remote-1");
		expect(resolveVisibleRightPanelSessionKey(bySessionId, "remote-1", "draft")).toBe("remote-1");
	});

	it("keeps the pre-promotion key while the promoted bucket is still missing", () => {
		const bySessionId = withPanes("draft");
		expect(resolveVisibleRightPanelSessionKey(bySessionId, "remote-1", "draft")).toBe("draft");
	});

	it("targets the promoted key directly when neither bucket has state", () => {
		expect(resolveVisibleRightPanelSessionKey({}, "remote-1", "draft")).toBe("remote-1");
	});
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
		useRightPanelStore.getState().moveSessionState("draft", "remote");
		expect(useRightPanelStore.getState().bySessionId.remote?.defaultLayoutInitialized).toBe(true);
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

	it("moves draft tabs to the assigned remote session", () => {
		useRightPanelStore.getState().openTab("local-1", CANVAS);
		useRightPanelStore.getState().moveSessionState("local-1", "remote-1");
		expect(useRightPanelStore.getState().bySessionId["local-1"]).toBeUndefined();
		expect(useRightPanelStore.getState().bySessionId["remote-1"]?.tabs[0]?.title).toBe("Canvas 1");
	});

	it("merges draft tabs into an existing remote session without losing either chat's panes", () => {
		useRightPanelStore.getState().openTab("local-1", CANVAS, {
			instanceId: "local-canvas",
			title: "Local canvas",
		});
		useRightPanelStore.getState().openTab("remote-1", CANVAS, {
			instanceId: "remote-canvas",
			title: "Remote canvas",
		});
		useRightPanelStore.getState().setArrangement("remote-1", "carousel");

		useRightPanelStore.getState().moveSessionState("local-1", "remote-1");

		expect(useRightPanelStore.getState().bySessionId["local-1"]).toBeUndefined();
		expect(
			useRightPanelStore.getState().bySessionId["remote-1"]?.tabs.map((tab) => tab.instanceId),
		).toEqual(["remote-canvas", "local-canvas"]);
		expect(useRightPanelStore.getState().bySessionId["remote-1"]?.activeTabId).toBe(
			"remote-canvas",
		);
		expect(useRightPanelStore.getState().bySessionId["remote-1"]?.arrangement).toBe("carousel");
	});

	it("clears pane state for a session", () => {
		useRightPanelStore.getState().openTab(DRAFT_RIGHT_PANEL_SESSION_KEY, CANVAS);
		useRightPanelStore.getState().setArrangement(DRAFT_RIGHT_PANEL_SESSION_KEY, "tiles");
		useRightPanelStore.getState().clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
		expect(
			useRightPanelStore.getState().bySessionId[DRAFT_RIGHT_PANEL_SESSION_KEY],
		).toBeUndefined();
	});

	it("omits the shared draft session from persisted pane state", () => {
		useRightPanelStore.getState().openTab(DRAFT_RIGHT_PANEL_SESSION_KEY, CANVAS);
		useRightPanelStore.getState().openTab(SESSION, CANVAS);
		const persisted = persistedRightPanelState(useRightPanelStore.getState());
		expect(persisted.bySessionId[DRAFT_RIGHT_PANEL_SESSION_KEY]).toBeUndefined();
		expect(persisted.bySessionId[SESSION]?.tabs).toHaveLength(1);
	});

	it("omits a marker-only default decision after draft promotion", () => {
		useRightPanelStore
			.getState()
			.initializeDefaultLayout(DRAFT_RIGHT_PANEL_SESSION_KEY, undefined, []);
		useRightPanelStore.getState().moveSessionState(DRAFT_RIGHT_PANEL_SESSION_KEY, SESSION);
		expect(useRightPanelStore.getState().bySessionId[SESSION]?.defaultLayoutInitialized).toBe(true);
		expect(
			persistedRightPanelState(useRightPanelStore.getState()).bySessionId[SESSION],
		).toBeUndefined();
	});
});
