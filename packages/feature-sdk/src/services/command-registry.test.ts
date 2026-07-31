import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "./command-registry.js";
import { noop } from "./test-helpers.js";

describe("CommandRegistry", () => {
	it("register returns an unregister function", () => {
		const registry = new CommandRegistry();
		const unregister = registry.register("todos", { id: "add", label: "Add", handler: noop });
		expect(registry.all()).toHaveLength(1);
		unregister();
		expect(registry.all()).toEqual([]);
	});

	it("warns on duplicate registration and replaces the handler", async () => {
		const registry = new CommandRegistry();
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			let which = "";
			registry.register("todos", {
				id: "add",
				label: "Add",
				handler: () => {
					which = "first";
				},
			});
			registry.register("todos", {
				id: "add",
				label: "Add again",
				handler: () => {
					which = "second";
				},
			});
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Command "todos.add" registered twice'),
			);
			await registry.execute("todos.add");
			expect(which).toBe("second");
		} finally {
			warn.mockRestore();
		}
	});

	it("execute throws when the command is missing", async () => {
		const registry = new CommandRegistry();
		await expect(registry.execute("todos.missing")).rejects.toThrow(/Command not found/);
	});

	it("removeFeature drops only that feature's commands", () => {
		const registry = new CommandRegistry();
		registry.register("todos", { id: "add", label: "Add", handler: noop });
		registry.register("other", { id: "go", label: "Go", handler: noop });
		registry.removeFeature("todos");
		expect(registry.all().map((c) => c.id)).toEqual(["other.go"]);
	});
});
