import { describe, expect, it, vi } from "vitest";

import { ToolRegistry } from "./tool-registry.js";

const base = {
	name: "greet",
	description: "Greet someone",
	handler: (args: unknown) => args,
};

describe("ToolRegistry", () => {
	it("registers, namespaces, lists, and unregisters tools", () => {
		const registry = new ToolRegistry();
		const unregister = registry.register("todos", base);
		expect(registry.all()).toEqual([
			{
				featureId: "todos",
				id: "todos.greet",
				name: "greet",
				description: "Greet someone",
				exposeToModelContext: false,
			},
		]);
		unregister();
		expect(registry.all()).toEqual([]);
	});

	it("marks exposeToModelContext when a tool opts in", () => {
		const registry = new ToolRegistry();
		registry.register("todos", { ...base, exposeToModelContext: true });
		expect(registry.all()[0]?.exposeToModelContext).toBe(true);
	});

	it("validates required fields", () => {
		const registry = new ToolRegistry();
		expect(() => registry.register("f", { ...base, name: "" })).toThrow(/name/);
		expect(() => registry.register("f", { ...base, description: "" })).toThrow(/description/);
		expect(() =>
			registry.register("f", { name: "x", description: "y", handler: undefined as never }),
		).toThrow(/handler/);
	});

	it("invoke validates args through the tool's schema then calls the handler", async () => {
		const registry = new ToolRegistry();
		registry.register("todos", {
			name: "add",
			description: "Add",
			validate: { parse: (input) => ({ title: String((input as { title: unknown }).title) }) },
			handler: (args) => ({ created: args }),
		});
		await expect(registry.invoke("todos", "add", { title: 42 })).resolves.toEqual({
			created: { title: "42" },
		});
	});

	it("invoke throws for unknown tools", async () => {
		const registry = new ToolRegistry();
		await expect(registry.invoke("todos", "missing", {})).rejects.toThrow(/Tool not found/);
	});

	it("notifies subscribers on register and removeFeature", () => {
		const registry = new ToolRegistry();
		const listener = vi.fn();
		const unsubscribe = registry.subscribe(listener);
		registry.register("todos", base);
		expect(listener).toHaveBeenCalledTimes(1);
		registry.removeFeature("todos");
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
		registry.register("todos", base);
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
