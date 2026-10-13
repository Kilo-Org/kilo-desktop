import { describe, expect, it } from "vitest";

import { agentToolName } from "./agent-tool-name.js";

describe("agentToolName", () => {
	it("joins the feature id and tool name with only MCP-safe characters", () => {
		expect(agentToolName({ featureId: "environments", name: "conda.envs.list" })).toBe(
			"environments_conda_envs_list",
		);
		expect(agentToolName({ featureId: "my-plugin", name: "do it" })).toBe("my_plugin_do_it");
	});
});
