import { describe, expect, it } from "vitest";

import {
	FILES_PANE_DEFINITION_ID,
	shouldOpenDefaultFilesExplorer,
	workspaceFolderName,
} from "./default-workspace-files-pane.js";

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

describe("shouldOpenDefaultFilesExplorer", () => {
	it("opens the files explorer when a new workspace chat leaves the empty draft", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: true,
				hasWorkspace: true,
				filesAvailable: true,
				tabs: [],
			}),
		).toBe(true);
	});

	it("does not open files for an unscoped chat", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: true,
				hasWorkspace: false,
				filesAvailable: true,
				tabs: [],
			}),
		).toBe(false);
	});

	it("does not open files when the files contribution is missing", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: true,
				hasWorkspace: true,
				filesAvailable: false,
				tabs: [],
			}),
		).toBe(false);
	});

	it("does not open files when revisiting an existing session", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: false,
				hasWorkspace: true,
				filesAvailable: true,
				tabs: [],
			}),
		).toBe(false);
	});

	it("does not open a second explorer if one is already in the session", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: true,
				hasWorkspace: true,
				filesAvailable: true,
				tabs: [
					{
						definitionId: FILES_PANE_DEFINITION_ID,
					},
				],
			}),
		).toBe(false);
	});

	it("still opens the explorer when only a file editor pane is present", () => {
		expect(
			shouldOpenDefaultFilesExplorer({
				submitted: true,
				hasWorkspace: true,
				filesAvailable: true,
				tabs: [
					{
						definitionId: FILES_PANE_DEFINITION_ID,
						metadata: { relativePath: "readme.md" },
					},
				],
			}),
		).toBe(true);
	});
});
