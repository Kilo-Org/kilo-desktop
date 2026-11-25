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
			{ action: "external_directory", resource: "/lib", effect: "allow" },
			{ action: "external_directory", resource: "/lib/*", effect: "allow" },
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
			{ action: "desktop_terminal_open", resource: "*", effect: "ask" },
			{ action: "desktop_acme_deploy_run", resource: "*", effect: "ask" },
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
			{ action: "external_directory", resource: "/lib", effect: "allow" },
			{ action: "external_directory", resource: "/lib/*", effect: "allow" },
			{ action: "desktop_notebook_open", resource: "*", effect: "deny" },
			{ action: "desktop_terminal_open", resource: "*", effect: "deny" },
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
			{ action: "external_directory", resource: "/lib", effect: "allow" },
			{ action: "external_directory", resource: "/lib/*", effect: "allow" },
			{ action: "shell", resource: "*conda install*", effect: "ask" },
			{ action: "desktop_environments_conda_envs_create", resource: "*", effect: "allow" },
			{ action: "desktop_environments_conda_envs_create", resource: "*", effect: "ask" },
			{ action: "desktop_terminal_open", resource: "*", effect: "deny" },
		]);
	});
});
