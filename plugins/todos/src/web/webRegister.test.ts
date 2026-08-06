import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { webRegister } from "./index.js";

/**
 * Tests for the plugin-owned WebMCP tool registration (issue #74). The
 * `createFeatureSystem` boot loop calls `webRegister(sdk)` for every feature
 * with the entry defined; here we invoke it directly against a fake SDK to
 * verify the same effect: three tools registered under the "todos" feature
 * with external exposure opted in, handlers routing to `sdk.invoke`, and
 * boundary validation running before the handler.
 */
function makeSystem() {
	const invoke = vi.fn().mockResolvedValue([]);
	const sdk = createFakeSdk({ featureId: "todos", invoke });
	const system = createFakeFeatureSystem({ sdks: { todos: sdk } });
	return { system, sdk, invoke };
}

describe("todos plugin webRegister", () => {
	it("registers list/add/toggle tools with external exposure opted in", () => {
		const { system, sdk } = makeSystem();
		webRegister(sdk);

		const tools = system.services.toolRegistry.all();
		expect(tools.map((tool) => tool.id).sort()).toEqual([
			"todos.add",
			"todos.list",
			"todos.toggle",
		]);
		expect(tools.every((tool) => tool.exposeToModelContext)).toBe(true);
	});

	it("advertises input schemas derived from the plugin contract", () => {
		const { system, sdk } = makeSystem();
		webRegister(sdk);

		const add = system.services.toolRegistry.all().find((tool) => tool.name === "add");
		expect(add?.inputSchema).toMatchObject({
			type: "object",
			properties: { title: { type: "string" } },
			required: ["title"],
		});
	});

	it("invokes the feature handler via sdk.invoke and validates args at the boundary", async () => {
		const { system, sdk, invoke } = makeSystem();
		webRegister(sdk);

		await system.services.toolRegistry.invoke("todos", "list", {});
		expect(invoke).toHaveBeenCalledWith("list");

		await system.services.toolRegistry.invoke("todos", "add", { title: "Buy milk" });
		expect(invoke).toHaveBeenCalledWith("add", { title: "Buy milk" });

		await system.services.toolRegistry.invoke("todos", "toggle", { id: "t-1" });
		expect(invoke).toHaveBeenCalledWith("toggle", { id: "t-1" });

		// Boundary validation rejects invalid args before hitting the handler.
		await expect(
			system.services.toolRegistry.invoke("todos", "add", { title: 42 }),
		).rejects.toThrow();
	});
});
