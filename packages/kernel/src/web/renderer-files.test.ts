import { describe, expect, it } from "vitest";

import { createLinkedTransports } from "../transport";
import { createRendererKernel } from "./renderer-kernel";

function renderer() {
	return createRendererKernel({
		windowId: "main",
		platform: "mac",
		transport: createLinkedTransports().connectRenderer("main"),
		registrations: [],
	});
}

describe("renderer kernel: dropped files", () => {
	it("knows no paths without a host (browser mode)", () => {
		expect(renderer().pathForFile(new File(["x"], "project"))).toBeNull();
	});
});
