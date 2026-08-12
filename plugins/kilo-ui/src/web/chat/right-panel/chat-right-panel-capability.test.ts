import { beforeEach, describe, expect, it } from "vitest";

import {
	chatRightPanelCapability,
	createChatRightPanelCapability,
	NOTEBOOK_TAB_DEFINITION_ID,
	NOTEBOOK_TAB_TITLE,
} from "./chat-right-panel-capability.js";
import { useRightPanelStore } from "./right-panel-store.js";

const SESSION = "session-1";

beforeEach(() => {
	useRightPanelStore.setState({ bySessionId: {} });
	chatRightPanelCapability.setFocusedSessionId(null);
});

describe("createChatRightPanelCapability", () => {
	it("tracks focused session id", () => {
		const panel = createChatRightPanelCapability();
		expect(panel.getFocusedSessionId()).toBeNull();
		panel.setFocusedSessionId(SESSION);
		expect(panel.getFocusedSessionId()).toBe(SESSION);
		panel.setFocusedSessionId(null);
		expect(panel.getFocusedSessionId()).toBeNull();
	});

	it("lists only notebook tabs for a session", () => {
		const panel = createChatRightPanelCapability();
		panel.openContributedTab(SESSION, {
			id: NOTEBOOK_TAB_DEFINITION_ID,
			title: NOTEBOOK_TAB_TITLE,
		});
		panel.openContributedTab(SESSION, { id: "other.panel", title: "Other" });
		panel.openContributedTab(SESSION, {
			id: NOTEBOOK_TAB_DEFINITION_ID,
			title: NOTEBOOK_TAB_TITLE,
		});

		const notebooks = panel.listNotebookTabs(SESSION);
		expect(notebooks).toHaveLength(2);
		expect(notebooks.every((tab) => !tab.notebook_id.includes(":"))).toBe(true);
		expect(notebooks.map((tab) => tab.title)).toEqual(["Notebook 1", "Notebook 2"]);
		expect(notebooks.filter((tab) => tab.active)).toHaveLength(1);
		expect(notebooks.find((tab) => tab.active)?.title).toBe("Notebook 2");
	});

	it("strips a legacy notebook.notebook: prefix from notebook_id", () => {
		const panel = createChatRightPanelCapability();
		useRightPanelStore.setState({
			bySessionId: {
				[SESSION]: {
					isOpen: true,
					activeTabId: `${NOTEBOOK_TAB_DEFINITION_ID}:legacy-uuid`,
					tabs: [
						{
							instanceId: `${NOTEBOOK_TAB_DEFINITION_ID}:legacy-uuid`,
							definitionId: NOTEBOOK_TAB_DEFINITION_ID,
							title: "Notebook 1",
							ordinal: 1,
						},
					],
				},
			},
		});
		expect(panel.listNotebookTabs(SESSION)).toEqual([
			{ notebook_id: "legacy-uuid", title: "Notebook 1", active: true },
		]);
	});

	it("opens a contributed tab and returns the active instance", () => {
		const panel = createChatRightPanelCapability();
		const tab = panel.openContributedTab(SESSION, {
			id: NOTEBOOK_TAB_DEFINITION_ID,
			title: NOTEBOOK_TAB_TITLE,
		});
		expect(tab.definitionId).toBe(NOTEBOOK_TAB_DEFINITION_ID);
		expect(tab.title).toBe("Notebook 1");
		expect(panel.listTabs(SESSION)).toEqual([tab]);
	});

	it("show opens the panel without adding tabs", () => {
		const panel = createChatRightPanelCapability();
		panel.show(SESSION);
		expect(useRightPanelStore.getState().bySessionId[SESSION]).toMatchObject({
			isOpen: true,
			tabs: [],
		});
	});
});
