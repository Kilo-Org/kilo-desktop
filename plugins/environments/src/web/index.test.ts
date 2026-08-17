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

	it("webRegister registers the conda provider's read-only tools", () => {
		const sdk = createFakeSdk({ featureId: "environments" });
		expect(() => webRegister(sdk)).not.toThrow();

		const tools = sdk.services.toolRegistry.all();
		// Sub-issue 4 wires `conda.envs.list` only. Adding tools in later
		// slices (create/install/channels/jobs.cancel) shows up here as
		// diff — if that surface changes surface-visibly, this test flags
		// it before shipping.
		expect(tools.map((tool) => tool.name)).toEqual(["conda.envs.list"]);
		const listTool = tools.find((tool) => tool.name === "conda.envs.list");
		expect(listTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(listTool?.exposeToModelContext).toBe(true);
	});
});
