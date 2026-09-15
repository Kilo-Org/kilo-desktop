import { describe, expect, it } from "vitest";

import { workspaceFolderName } from "./default-workspace-files-pane.js";

describe("workspaceFolderName", () => {
	it("returns the last component of a workspace folder path", () => {
		expect(workspaceFolderName("/projects/workspace-1")).toBe("workspace-1");
		expect(workspaceFolderName("/projects/workspace-1/")).toBe("workspace-1");
		expect(workspaceFolderName("C:\\projects\\alpha")).toBe("alpha");
	});

	it("returns undefined when there is no path", () => {
		expect(workspaceFolderName(undefined)).toBeUndefined();
		expect(workspaceFolderName("")).toBeUndefined();
	});
});
