import { describe, expect, it } from "vitest";

import {
	buildWorkspacePermissionRules,
	buildWorkspaceSystemPrompt,
} from "./workspace-session-context.js";

const folders = [
	{ path: "/workspace/main", isPrimary: true },
	{ path: "/workspace/reference-a", isPrimary: false },
	{ path: "/workspace/reference-b", isPrimary: false },
];

describe("workspace session context", () => {
	it("allows the reference folders without adding a redundant primary-folder rule", () => {
		expect(buildWorkspacePermissionRules(folders)).toEqual([
			{
				permission: "external_directory",
				pattern: "/workspace/reference-a",
				action: "allow",
			},
			{
				permission: "external_directory",
				pattern: "/workspace/reference-a/*",
				action: "allow",
			},
			{
				permission: "external_directory",
				pattern: "/workspace/reference-b",
				action: "allow",
			},
			{
				permission: "external_directory",
				pattern: "/workspace/reference-b/*",
				action: "allow",
			},
		]);
	});

	it("tells the agent every folder is writable and identifies the default directory", () => {
		expect(buildWorkspaceSystemPrompt(folders)).toBe(
			[
				"Workspace context for this session:",
				'- Primary folder (default working directory): "/workspace/main"',
				'- Additional workspace folder: "/workspace/reference-a"',
				'- Additional workspace folder: "/workspace/reference-b"',
				"All listed workspace folders are in scope and may be read from and written to.",
				"Use the primary folder as the default working directory, but consider every listed folder when locating or changing relevant files.",
			].join("\n"),
		);
		expect(buildWorkspaceSystemPrompt([])).toBeUndefined();
	});
});
