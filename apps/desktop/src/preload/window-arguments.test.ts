import { describe, expect, it } from "vitest";

import { readWindowArguments, windowArguments } from "./window-arguments";

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
});
