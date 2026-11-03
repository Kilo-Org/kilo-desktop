import { describe, expect, it } from "vitest";

import { HTML_RENDER_SYSTEM_PROMPT } from "../../contracts";
import { chatSystemPrompt, sessionFolders, workspaceSystemPrompt } from "./system-prompt";

const FOLDERS = [
	{ path: "/projects/app", isPrimary: true },
	{ path: "/projects/lib", isPrimary: false },
];

describe("chat system prompts", () => {
	it("lists the workspace folders, the primary first", () => {
		const prompt = workspaceSystemPrompt(FOLDERS)!;
		expect(prompt).toContain('Primary folder (default working directory): "/projects/app"');
		expect(prompt).toContain('Additional workspace folder: "/projects/lib"');
	});

	it("has no workspace context without a primary folder", () => {
		expect(workspaceSystemPrompt([])).toBeUndefined();
		expect(chatSystemPrompt([], [" "])).toBe(HTML_RENDER_SYSTEM_PROMPT);
	});

	it("joins the context, when to show visuals and session instructions", () => {
		expect(chatSystemPrompt([], ["One", "Two"])).toBe(`${HTML_RENDER_SYSTEM_PROMPT}\n\nOne\n\nTwo`);
		expect(chatSystemPrompt(FOLDERS, [])).toContain("desktop_chat_html_render");
	});

	it("puts a worktree in place of the primary folder", () => {
		expect(sessionFolders(FOLDERS, "/wt")).toEqual([
			{ path: "/wt", isPrimary: true },
			{ path: "/projects/lib", isPrimary: false },
		]);
		expect(sessionFolders(FOLDERS, null)).toEqual(FOLDERS);
	});
});
