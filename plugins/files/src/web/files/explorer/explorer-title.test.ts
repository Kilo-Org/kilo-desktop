import { describe, expect, it } from "vitest";

import { explorerRootTitle, folderName } from "./explorer-title.js";

describe("folderName", () => {
	it("returns the last path segment", () => {
		expect(folderName("/Users/me/Work/Repos/agentic-desktop")).toBe("agentic-desktop");
	});

	it("ignores trailing separators", () => {
		expect(folderName("/workspace/project/")).toBe("project");
		expect(folderName("C:\\Users\\me\\project\\")).toBe("project");
	});
});

describe("explorerRootTitle", () => {
	it("falls back to Files when there is no workspace root", () => {
		expect(explorerRootTitle(undefined)).toBe("Files");
		expect(explorerRootTitle("")).toBe("Files");
	});

	it("uses the folder name of the active root", () => {
		expect(explorerRootTitle("/projects/workspace-1")).toBe("workspace-1");
	});

	it("uses the full path when two workspace folders share a name", () => {
		expect(
			explorerRootTitle("/projects/alpha/src", [
				{ path: "/projects/alpha/src" },
				{ path: "/projects/beta/src" },
			]),
		).toBe("/projects/alpha/src");
	});

	it("keeps the folder name when the active root is unique", () => {
		expect(
			explorerRootTitle("/projects/workspace-1", [
				{ path: "/projects/workspace-1" },
				{ path: "/projects/reference" },
			]),
		).toBe("workspace-1");
	});
});
