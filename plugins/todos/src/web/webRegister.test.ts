import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { FEATURE_FLAG_KEY, webRegister } from "./index.js";

/**
 * Tests for the plugin-owned WebMCP tool registration (issue #74). The
 * `createFeatureSystem` boot loop calls `webRegister(sdk)` for every feature
 * with the entry defined; here we invoke it directly against a fake SDK to
 * verify the same effect: three tools registered under the "todos" feature
 * with external exposure opted in, handlers routing to `sdk.invoke`, and
 * boundary validation running before the handler.
 *
 * Additionally covers the LaunchDarkly `todo-feature` gate: no tools appear
 * until the flag flips on, and tools disappear again when the flag flips off,
 * so the LLM only sees the tools while the feature is enabled.
 */

/**
 * Fake `sdk.featureFlags` that records subscribers so tests can drive
 * `flag on`/`flag off` transitions and observe how `webRegister` reacts.
 */
function makeFlagsHost(initial: boolean) {
	let flags: Record<string, unknown> = { [FEATURE_FLAG_KEY]: initial };
	const subscribers = new Set<(flags: Record<string, unknown>) => void>();
	return {
		host: {
			getAllFlags: async () => flags,
			subscribe: (fn: (flags: Record<string, unknown>) => void) => {
				subscribers.add(fn);
				fn(flags);
				return () => {
					subscribers.delete(fn);
				};
			},
			peek: () => flags,
		},
		setFlag(value: boolean) {
			flags = { [FEATURE_FLAG_KEY]: value };
			for (const subscriber of subscribers) subscriber(flags);
		},
	};
}

function makeSystem(options: { flagEnabled?: boolean } = {}) {
	const invoke = vi.fn().mockResolvedValue([]);
	const flags = makeFlagsHost(options.flagEnabled ?? true);
	const sdk = createFakeSdk({
		featureId: "todos",
		invoke,
		featureFlags: flags.host,
	});
	const system = createFakeFeatureSystem({ sdks: { todos: sdk } });
	return { system, sdk, invoke, flags };
}

describe("todos plugin webRegister", () => {
	it("registers list/add/toggle tools with external exposure opted in when the flag is on", () => {
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

	describe("feature flag gate (todo-feature)", () => {
		it("registers no tools while the flag is off", () => {
			const { system, sdk } = makeSystem({ flagEnabled: false });
			webRegister(sdk);

			expect(system.services.toolRegistry.all()).toEqual([]);
		});

		it("installs the tools when the flag flips on and removes them when it flips back off", () => {
			const { system, sdk, flags } = makeSystem({ flagEnabled: false });
			webRegister(sdk);
			expect(system.services.toolRegistry.all()).toEqual([]);

			flags.setFlag(true);
			expect(
				system.services.toolRegistry
					.all()
					.map((tool) => tool.id)
					.sort(),
			).toEqual(["todos.add", "todos.list", "todos.toggle"]);

			flags.setFlag(false);
			expect(system.services.toolRegistry.all()).toEqual([]);
		});
	});
});
