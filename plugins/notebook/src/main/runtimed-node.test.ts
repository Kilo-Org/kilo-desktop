import { describe, expect, it } from "vitest";

import { translateAsarToUnpackedPath } from "./runtimed-node.js";

describe("translateAsarToUnpackedPath", () => {
	it("points into the unpacked copy beside app.asar", () => {
		expect(
			translateAsarToUnpackedPath(
				"/App/Resources/app.asar/node_modules/@runtimed/node/index.cjs",
				"/",
			),
		).toBe("/App/Resources/app.asar.unpacked/node_modules/@runtimed/node/index.cjs");
	});

	it("leaves paths outside app.asar alone", () => {
		expect(translateAsarToUnpackedPath("/repo/node_modules/@runtimed/node/index.cjs", "/")).toBe(
			"/repo/node_modules/@runtimed/node/index.cjs",
		);
	});
});
