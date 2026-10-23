import { describe, expect, it } from "vitest";

import { canExpandPane } from "./pane-expand.js";

describe("canExpandPane", () => {
	it("offers expand only when the layout contains multiple panes", () => {
		expect(canExpandPane(2)).toBe(true);
		expect(canExpandPane(3)).toBe(true);
		expect(canExpandPane(1)).toBe(false);
		expect(canExpandPane(0)).toBe(false);
	});
});
