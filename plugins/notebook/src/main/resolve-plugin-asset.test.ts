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

	it("maps a platform daemon beneath packaged resources", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/Apps/Agentic.app/Contents/Resources",
		});
		expect(resolveAsset("resources/runtimed/darwin-arm64/runtimed-nightly")).toBe(
			path.join("/Apps/Agentic.app/Contents/Resources", "runtimed/darwin-arm64/runtimed-nightly"),
		);
		expect(resolveAsset("resources/runt/darwin-arm64/runt-nightly")).toBe(
			path.join("/Apps/Agentic.app/Contents/Resources", "runt/darwin-arm64/runt-nightly"),
		);
	});

	it("resolves development assets from the plugin package", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});
		expect(resolveAsset("build/notebook")).toContain("/plugins/notebook/build/notebook");
		expect(resolveAsset("resources/runtimed/linux-x64/runtimed-nightly")).toContain(
			"/plugins/notebook/resources/runtimed/linux-x64/runtimed-nightly",
		);
		expect(resolveAsset("resources/runt/linux-x64/runt-nightly")).toContain(
			"/plugins/notebook/resources/runt/linux-x64/runt-nightly",
		);
	});
});
