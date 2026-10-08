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
});
