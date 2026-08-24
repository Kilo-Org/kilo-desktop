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
		// Sub-issue 4 wired `conda.envs.list`; sub-issue 6 layers the first
		// two mutating tools (`create`, `delete`) on top. Later slices add
		// packages / channels / jobs.cancel; each addition shows up here as
		// a diff, so the surface stays visible and reviewable before shipping.
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"conda.envs.create",
			"conda.envs.delete",
			"conda.envs.list",
		]);
		const listTool = tools.find((tool) => tool.name === "conda.envs.list");
		expect(listTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(listTool?.exposeToModelContext).toBe(true);

		// `create` is a mutating op but not destructive (it adds state).
		const createTool = tools.find((tool) => tool.name === "conda.envs.create");
		expect(createTool?.annotations?.destructiveHint).toBeUndefined();
		expect(createTool?.exposeToModelContext).toBe(true);

		// `delete` MUST advertise `destructiveHint: true` so MCP hosts
		// surface a confirmation prompt before invocation.
		const deleteTool = tools.find((tool) => tool.name === "conda.envs.delete");
		expect(deleteTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(deleteTool?.exposeToModelContext).toBe(true);
	});
});
