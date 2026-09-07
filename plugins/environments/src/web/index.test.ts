import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { EnvironmentsNavIcon, EnvironmentsPage, webRegister } from "./index.js";

/**
 * The manifest (`plugin.json`) names three exports the shell resolves from
 * this barrel at boot: `routes[0].component` -> `EnvironmentsPage`,
 * `nav[0].icon` -> `EnvironmentsNavIcon`, and `webRegister` if the plugin
 * has renderer-side setup. A broken barrel would make the shell render an
 * unavailable state for `/environments` or crash boot; the checks below
 * catch that at test time.
 */
describe("environments plugin web entry", () => {
	it("exports the components named by plugin.json", () => {
		expect(EnvironmentsPage).toBeDefined();
		expect(typeof EnvironmentsPage).toBe("function");
		expect(EnvironmentsNavIcon).toBeDefined();
	});

	it("webRegister registers the conda provider's tools", () => {
		const sdk = createFakeSdk({ featureId: "environments" });
		expect(() => webRegister(sdk)).not.toThrow();

		const tools = sdk.services.toolRegistry.all();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"conda.channels.list",
			"conda.envs.clone",
			"conda.envs.create",
			"conda.envs.createFromFile",
			"conda.envs.delete",
			"conda.envs.list",
			"conda.packages.install",
			"conda.packages.remove",
			"conda.repodata.find",
		]);
		const listTool = tools.find((tool) => tool.name === "conda.envs.list");
		expect(listTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(listTool?.exposeToModelContext).toBe(true);

		const channelsTool = tools.find((tool) => tool.name === "conda.channels.list");
		expect(channelsTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(channelsTool?.exposeToModelContext).toBe(true);

		// `create` is a mutating op but not destructive (it adds state).
		const createTool = tools.find((tool) => tool.name === "conda.envs.create");
		expect(createTool?.annotations?.destructiveHint).toBeUndefined();
		expect(createTool?.exposeToModelContext).toBe(true);

		// `delete` MUST advertise `destructiveHint: true` so MCP hosts
		// surface a confirmation prompt before invocation.
		const deleteTool = tools.find((tool) => tool.name === "conda.envs.delete");
		expect(deleteTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(deleteTool?.exposeToModelContext).toBe(true);

		// `repodata.find` is a read-only lookup over the channel index, backed by
		// the bridge's `repodata.find` method (present since payload 0.1.4).
		const repodataTool = tools.find((tool) => tool.name === "conda.repodata.find");
		expect(repodataTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(repodataTool?.exposeToModelContext).toBe(true);

		// `packages.install` adds state into an existing env — mutating but NOT
		// destructive, and exposed to the model so a prompt can install packages.
		const installTool = tools.find((tool) => tool.name === "conda.packages.install");
		expect(installTool?.annotations?.destructiveHint).toBeUndefined();
		expect(installTool?.exposeToModelContext).toBe(true);

		// Regression guard: the published input schema must be a single flat
		// object, NOT an `allOf` intersection. An intersection lowers to two
		// objects each with `additionalProperties: false`, which is
		// unsatisfiable and makes every tool call fail host-side validation.
		const installSchema = installTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			required?: string[];
			properties?: Record<string, { type?: string }>;
		};
		expect(installSchema.allOf).toBeUndefined();
		expect(installSchema.type).toBe("object");
		expect(installSchema.required).toContain("packages");
		expect(installSchema.properties?.packages?.type).toBe("array");
		expect(installSchema.properties?.name?.type).toBe("string");
		expect(installSchema.properties?.prefix?.type).toBe("string");

		// `packages.remove` uninstalls packages — MUST advertise `destructiveHint`
		// so MCP hosts prompt for confirmation. Same flat-schema guard as install.
		const removeTool = tools.find((tool) => tool.name === "conda.packages.remove");
		expect(removeTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(removeTool?.exposeToModelContext).toBe(true);
		const removeSchema = removeTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			required?: string[];
			properties?: Record<string, { type?: string }>;
		};
		expect(removeSchema.allOf).toBeUndefined();
		expect(removeSchema.type).toBe("object");
		expect(removeSchema.required).toContain("packages");
		expect(removeSchema.properties?.packages?.type).toBe("array");
	});
});
