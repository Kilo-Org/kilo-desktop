import { describe, expect, it, vi } from "vitest";

import { pane, panesOf, renderWorkSessions, workSession } from "../../testing";
import { ORIGIN_PANES_HANDED_OVER_KEY, ORIGIN_PANES_STORAGE_KEY } from "./origin-panes";

/** Origin's `kilo-ui:right-panel-state:v3`, a zustand persist value. */
const ORIGIN_STATE = {
	version: 3,
	state: {
		bySessionId: {
			wses_tabs: {
				tabs: [
					{
						instanceId: "terminal-1",
						definitionId: "terminal.terminal",
						title: "Terminal",
						ordinal: 1,
						metadata: { cwd: "/projects/app", stale: 3 },
					},
					{
						instanceId: "plan-1",
						definitionId: "kilo-ui.plan",
						title: "Plan",
						metadata: { chatId: "ses_tabs" },
					},
					{ instanceId: "gone-1", definitionId: "retired.tab", title: "Gone" },
				],
				activeTabId: "terminal-1",
				layoutJson: '{"saved":true}',
				arrangement: "carousel",
				planAnchorCallId: "call_1",
			},
			wses_closed_chat: {
				tabs: [{ instanceId: "files-1", definitionId: "files.files", title: "Files" }],
				chatPaneOpen: false,
			},
			wses_mine: {
				tabs: [{ instanceId: "browser-1", definitionId: "browser.browser", title: "Browser" }],
			},
		},
	},
};

const storage = (state: unknown = ORIGIN_STATE) => ({
	[ORIGIN_PANES_STORAGE_KEY]: JSON.stringify(state),
});

const agentPane = (workSessionId: string, title: string) =>
	pane(`agent:${workSessionId}`, "kilo.chat/agent", { title });

describe("origin's panes", () => {
	it("reopen with their layout, active pane and arrangement", async () => {
		const { panesState } = await renderWorkSessions({
			workSessions: [workSession("wses_tabs", { title: "Tabs", chatIds: ["ses_tabs"] })],
			localStorage: storage(),
		});

		await vi.waitFor(() => expect(panesState("wses_tabs").arrangement).toBe("carousel"));
		expect(panesState("wses_tabs")).toEqual({
			panes: [
				expect.objectContaining({ id: "agent:wses_tabs", kind: "kilo.chat/agent", title: "Tabs" }),
				expect.objectContaining({
					id: "terminal-1",
					kind: "kilo.terminal/terminal",
					metadata: { cwd: "/projects/app" },
				}),
				expect.objectContaining({
					id: "plan-1",
					kind: "kilo.chat/plan",
					metadata: { chatId: "ses_tabs", planAnchorCallId: "call_1" },
				}),
			],
			activePaneId: "terminal-1",
			layout: '{"saved":true}',
			arrangement: "carousel",
		});
	});

	it("reuse kilo.chat's untouched agent pane, and close it where origin had closed the chat", async () => {
		const { panesState } = await renderWorkSessions({
			workSessions: [
				workSession("wses_tabs", { title: "Tabs" }),
				workSession("wses_closed_chat", { title: "Closed chat" }),
			],
			panes: {
				wses_tabs: panesOf([agentPane("wses_tabs", "Tabs")]),
				wses_closed_chat: panesOf([agentPane("wses_closed_chat", "Closed chat")]),
			},
			localStorage: storage(),
		});

		await vi.waitFor(() =>
			expect(panesState("wses_closed_chat").panes.map((entry) => entry.id)).toEqual(["files-1"]),
		);
		expect(panesState("wses_closed_chat").activePaneId).toBe("files-1");
		await vi.waitFor(() =>
			expect(panesState("wses_tabs").panes.map((entry) => entry.id)).toEqual([
				"agent:wses_tabs",
				"terminal-1",
				"plan-1",
			]),
		);
	});

	it("leave a work session the person has changed alone", async () => {
		const mine = panesOf([pane("pane_9", "kilo.terminal/terminal")], { layout: "mine" });
		const { panesState, calls } = await renderWorkSessions({
			workSessions: [workSession("wses_tabs"), workSession("wses_mine")],
			panes: { wses_mine: mine },
			localStorage: storage(),
		});

		await vi.waitFor(() => expect(panesState("wses_tabs").layout).toBe('{"saved":true}'));
		expect(panesState("wses_mine")).toEqual(mine);
		expect(calls.openPane).not.toHaveBeenCalledWith(
			expect.objectContaining({ workSessionId: "wses_mine" }),
		);
	});

	it("wait for origin's work sessions to be imported, then hand over once", async () => {
		const first = await renderWorkSessions({ localStorage: storage() });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(first.calls.openPane).not.toHaveBeenCalled();
		expect(localStorage.getItem(ORIGIN_PANES_HANDED_OVER_KEY)).toBeNull();

		first.workSessions.workSessions().setState({ workSessions: [workSession("wses_tabs")] });
		await vi.waitFor(() => expect(first.panesState("wses_tabs").panes).toHaveLength(3));
		expect(localStorage.getItem(ORIGIN_PANES_HANDED_OVER_KEY)).toBe("1");

		const again = await renderWorkSessions({
			workSessions: [workSession("wses_tabs")],
			localStorage: { ...localStorage },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(again.calls.openPane).not.toHaveBeenCalled();
	});

	it("do nothing without origin's key, or with a value that isn't origin's", async () => {
		const none = await renderWorkSessions({ workSessions: [workSession("wses_tabs")] });
		const garbage = await renderWorkSessions({
			workSessions: [workSession("wses_tabs")],
			localStorage: { [ORIGIN_PANES_STORAGE_KEY]: "{not json" },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(none.calls.openPane).not.toHaveBeenCalled();
		expect(garbage.calls.openPane).not.toHaveBeenCalled();
	});
});
