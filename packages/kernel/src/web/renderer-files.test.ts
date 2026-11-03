import { describe, expect, it } from "vitest";

import { createLinkedTransports } from "../transport";
import { createRendererKernel } from "./renderer-kernel";

function renderer(pathForFile?: (file: File) => string | null) {
	return createRendererKernel({
		windowId: "main",
		platform: "mac",
		transport: createLinkedTransports().connectRenderer("main"),
		registrations: [],
		...(pathForFile ? { pathForFile } : {}),
	});
}

describe("renderer kernel: dropped files", () => {
	it("gives the path of a dropped file where the host can tell", () => {
		const file = new File(["x"], "project");

		expect(renderer(() => "/Users/me/project").pathForFile(file)).toBe("/Users/me/project");
	});

	it("knows no paths without a host (browser mode)", () => {
		expect(renderer().pathForFile(new File(["x"], "project"))).toBeNull();
	});
});
