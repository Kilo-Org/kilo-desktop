import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	defineTool,
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	signInRequiredToolMessage,
	toolPermissionRules,
	toolWireName,
} from "./index";

describe("toolWireName", () => {
	it("names a tool as Kilo sees it, without the kilo. publisher", () => {
		expect(toolWireName("kilo.terminal/open")).toBe("desktop_terminal_open");
		expect(toolWireName("acme.todos/list-all")).toBe("desktop_acme_todos_list_all");
	});
});

describe("toolPermissionRules", () => {
	it("makes chats ask before tools contributed with approval: ask", () => {
		expect(
			toolPermissionRules([
				{ key: "kilo.environments/conda-install", metadata: { approval: "ask" } },
				{ key: "kilo.terminal/list", metadata: { approval: "auto" } },
				{ key: "acme.deploy/run", metadata: { approval: "ask" } },
			]),
		).toEqual([
			{ permission: "desktop_environments_conda_install", pattern: "*", action: "ask" },
			{ permission: "desktop_acme_deploy_run", pattern: "*", action: "ask" },
		]);
	});

	it("has no rules when no tool asks", () => {
		expect(toolPermissionRules([])).toEqual([]);
	});
});

describe("signInRequiredToolMessage", () => {
	it("marks both refusals so the chat can recognise them", () => {
		expect(signInRequiredToolMessage("kilo")).toMatch(/^\[desktop:sign-in-required\] The user/);
		expect(signInRequiredToolMessage("external")).toContain("sign in to Kilo in Kilo Desktop");
		expect(signInRequiredToolMessage("external").startsWith(SIGN_IN_REQUIRED_TOOL_ERROR_CODE)).toBe(
			true,
		);
	});
});

describe("SIGN_IN_DECLINED_TOOL_MESSAGE", () => {
	it("tells the agent the tools are off until sign-in, without asking the person again", () => {
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE.startsWith(SIGN_IN_DECLINED_TOOL_ERROR_CODE)).toBe(true);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).toMatch(/until they sign in/);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).toMatch(/reappear in your tool list/);
		expect(SIGN_IN_DECLINED_TOOL_MESSAGE).not.toContain(SIGN_IN_REQUIRED_TOOL_ERROR_CODE);
	});
});

describe("defineTool", () => {
	it("returns the tool unchanged", () => {
		const tool = { description: "x", input: z.object({}), run: () => null };

		expect(defineTool(tool)).toBe(tool);
	});
});
