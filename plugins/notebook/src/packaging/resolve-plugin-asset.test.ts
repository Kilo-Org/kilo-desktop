import path from "node:path";

import { describe, expect, it } from "vitest";

import { createNotebookResolveAsset } from "./resolve-plugin-asset.js";

describe("createNotebookResolveAsset", () => {
	it("maps the staged notebook bundle to packaged resources", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/Apps/Kilo.app/Contents/Resources",
		});
		expect(resolveAsset("build/notebook")).toBe(
			path.join("/Apps/Kilo.app/Contents/Resources", "notebook"),
		);
	});

	it("maps the nteract MCP bundle beneath packaged resources", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/Apps/Kilo.app/Contents/Resources",
		});
		expect(resolveAsset("resources/nteract-mcp/darwin-arm64/nteract-mcp")).toBe(
			path.join("/Apps/Kilo.app/Contents/Resources", "nteract-mcp/darwin-arm64/nteract-mcp"),
		);
	});

	it("maps the runtimed daemon beneath packaged resources", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: true,
			packagedResourcesPath: "/Apps/Kilo.app/Contents/Resources",
		});
		expect(resolveAsset("resources/runtimed/darwin-arm64/runtimed")).toBe(
			path.join("/Apps/Kilo.app/Contents/Resources", "runtimed/darwin-arm64/runtimed"),
		);
	});

	it("resolves development assets from the plugin package", () => {
		const resolveAsset = createNotebookResolveAsset({
			isPackaged: false,
			packagedResourcesPath: "/unused",
		});
		expect(resolveAsset("build/notebook")).toContain(
			path.join("plugins", "notebook", "build", "notebook"),
		);
		expect(resolveAsset("resources/nteract-mcp/linux-x64/nteract-mcp")).toContain(
			path.join("plugins", "notebook", "resources", "nteract-mcp", "linux-x64", "nteract-mcp"),
		);
	});
});
