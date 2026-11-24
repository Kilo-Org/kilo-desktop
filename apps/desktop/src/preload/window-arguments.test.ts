import { describe, expect, it } from "vitest";

import {
	readExternalPluginsArgument,
	readWindowArguments,
	windowArguments,
} from "./window-arguments";

describe("window arguments", () => {
	it("round-trips a secondary window's identity, view and params", () => {
		const window = {
			id: "w-3",
			role: "secondary" as const,
			view: "acme.board/board",
			params: { workspace: "a b&c" },
		};

		expect(readWindowArguments(["electron", ...windowArguments(window)])).toEqual(window);
	});

	it("defaults to the main window when no arguments were passed", () => {
		expect(readWindowArguments(["electron"])).toEqual({ id: "main", role: "main", params: {} });
	});

	it("ignores malformed params", () => {
		expect(readWindowArguments(["--kilo-window-params=%7Bnot-json"]).params).toEqual({});
	});

	it("tells the window whether main loaded local plugins", () => {
		const window = { id: "main", role: "main" as const, params: {} };

		expect(readExternalPluginsArgument(windowArguments(window, { externalPlugins: true }))).toBe(
			true,
		);
		expect(readExternalPluginsArgument(windowArguments(window))).toBe(false);
	});
});
