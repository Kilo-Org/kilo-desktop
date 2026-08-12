import path from "node:path";

import { describe, expect, it } from "vitest";

import { createNotebookResolveAsset } from "./resolve-plugin-asset.js";

describe("createNotebookResolveAsset", () => {
	it("maps the staged notebook bundle to packaged resources", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/Apps/Agentic.app/Contents/Resources",
		});
		expect(resolveAsset("build/notebook")).toBe(
			path.join("/Apps/Agentic.app/Contents/Resources", "notebook"),
		);
	});

	it("resolves development assets from the plugin package", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});
		expect(resolveAsset("build/notebook")).toContain("/plugins/notebook/build/notebook");
	});
});
