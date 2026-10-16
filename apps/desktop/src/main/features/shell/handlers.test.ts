import { describe, expect, it, vi } from "vitest";

import { createShellHandlers } from "./handlers.js";

describe("shell handlers", () => {
	it("reveals the current application log without exposing its path to the renderer", async () => {
		const showItemInFolder = vi.fn(() => true);
		const handlers = createShellHandlers(
			{ showItemInFolder } as never,
			{} as never,
			false,
			() => "/user-data/logs/main.log",
		);

		await expect(handlers["shell:show-log-file"](undefined)).resolves.toEqual({ revealed: true });
		expect(showItemInFolder).toHaveBeenCalledWith("/user-data/logs/main.log");
	});

	it("brings the main window forward", () => {
		const reveal = vi.fn();
		const handlers = createShellHandlers({} as never, { reveal } as never, false);

		handlers["shell:focus-main-window"](undefined);

		expect(reveal).toHaveBeenCalledWith();
	});

	it("docks a session-independent pane window by its plugin and pane id", () => {
		vi.useFakeTimers();
		try {
			const dockPaneWindow = vi.fn();
			const board = {
				pluginId: "kilo-ui",
				paneId: "workspace-board",
				title: "Workspace Board",
				path: "/plugins/workspace-board",
			};
			const handlers = createShellHandlers(
				{} as never,
				{ listPaneWindows: () => [board], dockPaneWindow } as never,
				false,
			);

			expect(
				handlers["shell:dock-pane-window"]({ pluginId: "kilo-ui", paneId: "workspace-board" }),
			).toEqual({ docked: true });
			vi.runAllTimers();
			expect(dockPaneWindow).toHaveBeenCalledWith({
				pluginId: "kilo-ui",
				paneId: "workspace-board",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports the current application log path for display", async () => {
		const handlers = createShellHandlers(
			{} as never,
			{} as never,
			false,
			() => "/user-data/logs/main.log",
		);

		await expect(handlers["shell:get-log-file-path"](undefined)).resolves.toEqual({
			path: "/user-data/logs/main.log",
		});
	});
});
