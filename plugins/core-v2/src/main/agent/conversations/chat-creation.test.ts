import { describe, expect, it } from "vitest";

import { buildWorkspacePermissionRules, chatPermissionRules } from "./chat-creation";

const tool = (key: string, approval = "auto") => ({ key, metadata: { approval } });

describe("a new chat's permission rules", () => {
	it("allow the workspace's other folders", () => {
		expect(
			buildWorkspacePermissionRules([
				{ path: "/repo", isPrimary: true },
				{ path: "/lib", isPrimary: false },
			]),
		).toEqual([
			{ permission: "external_directory", pattern: "/lib", action: "allow" },
			{ permission: "external_directory", pattern: "/lib/*", action: "allow" },
		]);
	});

	it("ask before tools that ask, or that tool-approval says to ask about", () => {
		expect(
			chatPermissionRules({
				workspaceFolders: [],
				tools: [tool("kilo.terminal/open", "ask"), tool("acme.deploy/run"), tool("acme.x/list")],
				approvals: new Map([
					["acme.deploy/run", "ask"],
					["acme.x/list", "proceed"],
				]),
				disableTools: [],
			}),
		).toEqual([
			{ permission: "desktop_terminal_open", pattern: "*", action: "ask" },
			{ permission: "desktop_acme_deploy_run", pattern: "*", action: "ask" },
		]);
	});

	it("deny tools tool-approval rejects or session config turns off, after everything else", () => {
		expect(
			chatPermissionRules({
				workspaceFolders: [{ path: "/lib", isPrimary: false }],
				tools: [tool("kilo.terminal/open", "ask"), tool("acme.deploy/run")],
				approvals: new Map([["kilo.terminal/open", "reject"]]),
				disableTools: ["desktop_notebook_open", "desktop_terminal_open"],
			}),
		).toEqual([
			{ permission: "external_directory", pattern: "/lib", action: "allow" },
			{ permission: "external_directory", pattern: "/lib/*", action: "allow" },
			{ permission: "desktop_notebook_open", pattern: "*", action: "deny" },
			{ permission: "desktop_terminal_open", pattern: "*", action: "deny" },
		]);
	});

	it("add session config's rules after the folders and before the tools' ask and deny rules", () => {
		expect(
			chatPermissionRules({
				workspaceFolders: [{ path: "/lib", isPrimary: false }],
				tools: [tool("kilo.environments/conda.envs.create", "ask"), tool("kilo.terminal/open")],
				approvals: new Map([["kilo.terminal/open", "reject"]]),
				disableTools: [],
				chatPermissions: [
					{ permission: "shell", pattern: "*conda install*", action: "ask" },
					{ permission: "desktop_environments_conda_envs_create", pattern: "*", action: "allow" },
				],
			}),
		).toEqual([
			{ permission: "external_directory", pattern: "/lib", action: "allow" },
			{ permission: "external_directory", pattern: "/lib/*", action: "allow" },
			{ permission: "shell", pattern: "*conda install*", action: "ask" },
			{ permission: "desktop_environments_conda_envs_create", pattern: "*", action: "allow" },
			{ permission: "desktop_environments_conda_envs_create", pattern: "*", action: "ask" },
			{ permission: "desktop_terminal_open", pattern: "*", action: "deny" },
		]);
	});
});
