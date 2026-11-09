import { describe, expect, it } from "vitest";

import { stagedExecuteBitsAreCurrent } from "./stage-pinned-binary.js";

describe("stagedExecuteBitsAreCurrent", () => {
	it("does not require Unix execute bits for Windows artifacts", () => {
		expect(stagedExecuteBitsAreCurrent(0, "win32")).toBe(true);
	});

	it("requires Unix execute bits only on hosts that can persist them", () => {
		expect(stagedExecuteBitsAreCurrent(0o755, "darwin")).toBe(true);
		expect(stagedExecuteBitsAreCurrent(0o644, "darwin")).toBe(process.platform === "win32");
	});
});
