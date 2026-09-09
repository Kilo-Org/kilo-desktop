import { beforeEach, describe, expect, it } from "vitest";

import { PLAN_TAB_DEFINITION_ID } from "./right-panel-tab-registry.js";
import {
	DEFAULT_ARRANGEMENT,
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	persistedRightPanelState,
	resolveRightPanelSessionKey,
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

describe("right-panel-store", () => {
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
});
