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
				requiresSignIn: false,
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

	it("passes caller context to each concurrent invocation", async () => {
		const registry = new ToolRegistry();
		registry.register("notebook", {
			name: "open",
			description: "Open notebook",
			handler: async (_args, context) => {
				await Promise.resolve();
				return context;
			},
		});

		await expect(
			Promise.all([
				registry.invoke(
					"notebook",
					"open",
					{},
					{ kiloSessionId: "session-a", kiloCallId: "call-a" },
				),
				registry.invoke(
					"notebook",
					"open",
					{},
					{ kiloSessionId: "session-b", kiloCallId: "call-b" },
				),
			]),
		).resolves.toEqual([
			{ kiloSessionId: "session-a", kiloCallId: "call-a" },
			{ kiloSessionId: "session-b", kiloCallId: "call-b" },
		]);
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

	it("stale unregister from a replaced registration does not evict the current owner", () => {
		// register-twice warns-and-replaces (the older registration is expected
		// to be dead). If the returned unregister closure deleted by id-only, it
		// would silently tear down whichever entry now occupies the id — killing
		// the replacement instead of a no-opping the stale caller.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const registry = new ToolRegistry();
		const unregisterA = registry.register("todos", { ...base, handler: () => "A" });
		const unregisterB = registry.register("todos", { ...base, handler: () => "B" });
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/registered twice — replacing/));

		// The stale unregister for the replaced registration must be a no-op:
		// B is still the active owner of `todos.greet` and must remain listed.
		unregisterA();
		expect(registry.all().map((tool) => tool.id)).toEqual(["todos.greet"]);

		// B's unregister still works — it holds the identity for the current entry.
		unregisterB();
		expect(registry.all()).toEqual([]);

		// A follow-up call on either stale closure is also a no-op.
		unregisterA();
		unregisterB();
		expect(registry.all()).toEqual([]);
		warnSpy.mockRestore();
	});

	it("double unregister is a no-op and does not double-fire subscribers", () => {
		const registry = new ToolRegistry();
		const listener = vi.fn();
		registry.subscribe(listener);
		const unregister = registry.register("todos", base);
		expect(listener).toHaveBeenCalledTimes(1); // register

		unregister();
		expect(listener).toHaveBeenCalledTimes(2); // unregister
		unregister();
		expect(listener).toHaveBeenCalledTimes(2); // second call: no-op, no notify
	});

	it("unregister after removeFeature is a no-op (the entry is already gone)", () => {
		const registry = new ToolRegistry();
		const listener = vi.fn();
		const unregister = registry.register("todos", base);
		registry.removeFeature("todos");
		registry.subscribe(listener);
		unregister();
		expect(listener).not.toHaveBeenCalled();
	});

	it("marks requiresSignIn when a tool opts in", () => {
		const registry = new ToolRegistry();
		registry.register("todos", { ...base, requiresSignIn: true });
		expect(registry.all()[0]).toMatchObject({ requiresSignIn: true });
		expect(registry.all()[0]).not.toHaveProperty("signInPrompt");
	});

	it("keeps the sign-in prompt a tool supplies", () => {
		const registry = new ToolRegistry();
		const signInPrompt = { title: "Sign in?", body: "Needs an account.", toolsLabel: "Todo tools" };
		registry.register("todos", { ...base, requiresSignIn: signInPrompt });
		expect(registry.all()[0]).toMatchObject({ requiresSignIn: true, signInPrompt });
	});
});
