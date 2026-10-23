import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { createChatRightPanelCapability } from "../right-panel/chat-right-panel-capability.js";
import { useRightPanelStore } from "../right-panel/right-panel-store.js";
import {
	bindChatPaneSync,
	CHAT_PANE_TAB_OPENED_EVENT,
	CHAT_PANE_TAB_UPDATED_EVENT,
	listenChatPaneSync,
} from "./chat-pane-sync.js";

const SESSION = "session-1";
const NOTEBOOK = {
	instanceId: "nb-1",
	definitionId: "notebook.notebook",
	title: "Notebook",
	ordinal: 1,
};

beforeEach(() => {
	useRightPanelStore.setState({ bySessionId: {} });
});

describe("listenChatPaneSync", () => {
	it("opens a notebook pane broadcast from another window", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const stop = listenChatPaneSync(sdk);

		sdk.events.emit(CHAT_PANE_TAB_OPENED_EVENT, { sessionId: SESSION, tab: NOTEBOOK });

		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs).toEqual([
			expect.objectContaining({
				instanceId: "nb-1",
				definitionId: "notebook.notebook",
				title: "Notebook",
			}),
		]);
		expect(useRightPanelStore.getState().bySessionId[SESSION]?.activeTabId).toBe("nb-1");
		stop();
	});

	it("applies pane updates broadcast from another window", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		useRightPanelStore.getState().openTab(
			SESSION,
			{ id: "notebook.notebook", title: "Notebook" },
			{
				instanceId: "nb-1",
				title: "Notebook",
				transient: true,
			},
		);
		const stop = listenChatPaneSync(sdk);

		sdk.events.emit(CHAT_PANE_TAB_UPDATED_EVENT, {
			sessionId: SESSION,
			instanceId: "nb-1",
			update: { title: "analysis.ipynb", transient: false },
		});

		expect(useRightPanelStore.getState().bySessionId[SESSION]?.tabs[0]).toMatchObject({
			title: "analysis.ipynb",
			transient: false,
		});
		stop();
	});
});

describe("bindChatPaneSync", () => {
	it("does not replay an emitted pane open in the originating window", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const panel = createChatRightPanelCapability();
		const active = panel.openContributedTab(SESSION, { id: "canvas.canvas", title: "Canvas" });
		const stop = listenChatPaneSync(sdk);
		const panes = bindChatPaneSync(sdk, panel);
		const changed = vi.fn();
		const unsubscribe = useRightPanelStore.subscribe(changed);

		const opened = panes.openContributedTab(
			SESSION,
			{ id: "notebook.notebook", title: "Notebook" },
			{ activate: false, instanceId: "nb-1" },
		);

		expect(opened.instanceId).toBe("nb-1");
		expect(panel.getActiveTabId(SESSION)).toBe(active.instanceId);
		expect(changed).toHaveBeenCalledOnce();
		unsubscribe();
		stop();
	});

	it("broadcasts contributed pane opens so other windows can show them", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const received = vi.fn();
		sdk.events.on(`kilo-ui.${CHAT_PANE_TAB_OPENED_EVENT}`, received);
		const panes = bindChatPaneSync(sdk, createChatRightPanelCapability());

		const tab = panes.openContributedTab(SESSION, {
			id: "notebook.notebook",
			title: "Notebook",
		});

		expect(received).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: SESSION,
				tab: expect.objectContaining({
					instanceId: tab.instanceId,
					definitionId: "notebook.notebook",
				}),
			}),
		);
	});

	it("broadcasts pane updates so other windows stay in sync", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const received = vi.fn();
		sdk.events.on(`kilo-ui.${CHAT_PANE_TAB_UPDATED_EVENT}`, received);
		const panes = bindChatPaneSync(sdk, createChatRightPanelCapability());
		const tab = panes.openContributedTab(SESSION, {
			id: "notebook.notebook",
			title: "Notebook",
		});

		panes.updateTab(SESSION, tab.instanceId, { title: "analysis.ipynb" });

		expect(received).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: SESSION,
				instanceId: tab.instanceId,
				update: { title: "analysis.ipynb" },
			}),
		);
	});
});
