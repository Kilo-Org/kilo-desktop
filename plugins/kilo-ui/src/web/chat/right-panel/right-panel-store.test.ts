import { beforeEach, describe, expect, it } from "vitest";

import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	EMPTY_SESSION_RIGHT_PANEL_STATE,
	resolveRightPanelSessionKey,
	selectActiveRightPanelTab,
	selectSessionRightPanelState,
	useRightPanelStore,
} from "./right-panel-store.js";

const SESSION = "session-1";

beforeEach(() => {
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("resolveRightPanelSessionKey", () => {
	it("falls back to draft when remote id is missing", () => {
		expect(resolveRightPanelSessionKey(undefined)).toBe(DRAFT_RIGHT_PANEL_SESSION_KEY);
		expect(resolveRightPanelSessionKey("")).toBe(DRAFT_RIGHT_PANEL_SESSION_KEY);
		expect(resolveRightPanelSessionKey("  ")).toBe(DRAFT_RIGHT_PANEL_SESSION_KEY);
	});

	it("uses the remote id when present", () => {
		expect(resolveRightPanelSessionKey("abc")).toBe("abc");
	});

	it("uses the stable local id before a remote session exists", () => {
		expect(resolveRightPanelSessionKey(undefined, "local-1")).toBe("local-1");
		expect(resolveRightPanelSessionKey("remote-1", "local-1")).toBe("remote-1");
	});
});

describe("right-panel-store", () => {
	it("toggles visibility without adding tabs", () => {
		useRightPanelStore.getState().toggleVisibility(SESSION);
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION),
		).toEqual({
			isOpen: true,
			activeTabId: null,
			tabs: [],
			planAnchorCallId: null,
		});

		useRightPanelStore.getState().toggleVisibility(SESSION);
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION),
		).toEqual(EMPTY_SESSION_RIGHT_PANEL_STATE);
	});

	it("opens the placeholder tab and selects it", () => {
		useRightPanelStore.getState().openTab(SESSION, "placeholder");
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.isOpen).toBe(true);
		expect(state.tabs).toEqual([{ id: "placeholder", kind: "placeholder" }]);
		expect(state.activeTabId).toBe("placeholder");
		expect(selectActiveRightPanelTab(useRightPanelStore.getState().bySessionId, SESSION)).toEqual({
			id: "placeholder",
			kind: "placeholder",
		});
	});

	it("opens the plan tab and selects it", () => {
		useRightPanelStore.getState().openPlan(SESSION);
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.isOpen).toBe(true);
		expect(state.tabs).toEqual([{ id: "plan", kind: "plan" }]);
		expect(state.activeTabId).toBe("plan");
		expect(state.planAnchorCallId).toBeNull();
		expect(selectActiveRightPanelTab(useRightPanelStore.getState().bySessionId, SESSION)).toEqual({
			id: "plan",
			kind: "plan",
		});
	});

	it("stores the plan anchor when opening a historical snapshot", () => {
		useRightPanelStore.getState().openPlan(SESSION, { anchorCallId: "write-1" });
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION)
				.planAnchorCallId,
		).toBe("write-1");

		useRightPanelStore.getState().openPlan(SESSION, { anchorCallId: "edit-2" });
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION)
				.planAnchorCallId,
		).toBe("edit-2");

		useRightPanelStore.getState().closeTab(SESSION, "plan");
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION)
				.planAnchorCallId,
		).toBeNull();
	});

	it("does not duplicate the placeholder tab", () => {
		useRightPanelStore.getState().openTab(SESSION, "placeholder");
		useRightPanelStore.getState().openTab(SESSION, "placeholder");
		const state = selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION);
		expect(state.tabs).toHaveLength(1);
	});

	it("keeps the panel open on the empty state after closing the last tab", () => {
		useRightPanelStore.getState().openTab(SESSION, "placeholder");
		useRightPanelStore.getState().closeTab(SESSION, "placeholder");
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION),
		).toEqual({
			isOpen: true,
			activeTabId: null,
			tabs: [],
			planAnchorCallId: null,
		});
	});

	it("scopes state per session", () => {
		useRightPanelStore.getState().openTab(SESSION, "placeholder");
		useRightPanelStore.getState().show("session-2");
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, SESSION).tabs,
		).toHaveLength(1);
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, "session-2"),
		).toEqual({
			isOpen: true,
			activeTabId: null,
			tabs: [],
			planAnchorCallId: null,
		});
	});

	it("moves draft state from the local thread id to the assigned remote id", () => {
		useRightPanelStore.getState().openPlan("local-1", { anchorCallId: "write-1" });

		useRightPanelStore.getState().moveSessionState("local-1", "session-1");

		expect(useRightPanelStore.getState().bySessionId["local-1"]).toBeUndefined();
		expect(
			selectSessionRightPanelState(useRightPanelStore.getState().bySessionId, "session-1"),
		).toEqual({
			isOpen: true,
			activeTabId: "plan",
			tabs: [{ id: "plan", kind: "plan" }],
			planAnchorCallId: "write-1",
		});
	});
});
