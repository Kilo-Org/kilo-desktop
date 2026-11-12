import { afterEach, describe, expect, it, vi } from "vitest";

import { slashCommandHandler, type ClientSlashCommandContext } from "./composer";

const context: ClientSlashCommandContext = {
	workSessionId: "wses_1",
	chatId: "ses_a",
	directory: "/projects/app",
	workspaceId: "w-app",
	workspaceFolders: [{ path: "/projects/app", isPrimary: true }],
	selection: { agent: "code", model: { providerID: "acme", modelID: "fast-1" } },
	running: false,
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("slashCommandHandler", () => {
	it("runs with the context the `/` menu passes and returns what it returns", async () => {
		const run = vi.fn(async () => "done");
		const handler = slashCommandHandler(run);

		await expect(Promise.resolve(handler(context))).resolves.toBe("done");
		expect(run).toHaveBeenCalledWith(context);
	});

	it("ignores a run without a slash context, as from the palette or a key", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const run = vi.fn();
		const handler = slashCommandHandler(run);

		handler(undefined);
		handler({ chatId: "ses_a" });

		expect(run).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(2);
	});
});
