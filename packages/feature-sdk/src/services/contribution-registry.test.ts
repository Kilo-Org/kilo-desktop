import { describe, expect, it, vi } from "vitest";

import { ContributionRegistry } from "./contribution-registry.js";
import { noop } from "./test-helpers.js";

describe("ContributionRegistry", () => {
	it("register returns an unregister function that only removes that contribution", () => {
		const registry = new ContributionRegistry();
		const unregister = registry.register("todos", "status-bar", {
			id: "a",
			component: null,
			label: "A",
		});
		registry.register("todos", "status-bar", { id: "b", component: null, label: "B" });
		unregister();
		expect(registry.getForZone("status-bar").map((c) => c.label)).toEqual(["B"]);
	});

	it("stores size and sorts a zone by priority descending", () => {
		const registry = new ContributionRegistry();
		registry.register("a", "panel", {
			id: "low",
			component: null,
			label: "low",
			priority: 1,
		});
		registry.register("b", "panel", {
			id: "high",
			component: null,
			label: "high",
			priority: 10,
			size: "lg",
		});
		expect(registry.getForZone("panel").map((c) => c.label)).toEqual(["high", "low"]);
		expect(registry.getForZone("panel")[0]?.size).toBe("lg");
	});

	it("preserves stable ids and optional display metadata", () => {
		const registry = new ContributionRegistry();
		const icon = {};
		registry.register("notebook", "chat-right-panel", {
			id: "notebook",
			component: null,
			label: "Notebook",
			description: "Scratch notebook",
			icon,
		});
		expect(registry.getForZone("chat-right-panel")[0]).toMatchObject({
			featureId: "notebook",
			id: "notebook",
			description: "Scratch notebook",
			icon,
		});
	});

	it("rejects duplicate stable ids from the same feature and zone", () => {
		const registry = new ContributionRegistry();
		registry.register("notebook", "chat-right-panel", {
			id: "notebook",
			component: null,
			label: "Notebook",
		});
		expect(() =>
			registry.register("notebook", "chat-right-panel", {
				id: "notebook",
				component: null,
				label: "Duplicate",
			}),
		).toThrow(/already contributed/);
	});

	it("rejects empty contribution ids", () => {
		const registry = new ContributionRegistry();
		expect(() =>
			registry.register("notebook", "chat-right-panel", {
				id: " ",
				component: null,
				label: "Notebook",
			}),
		).toThrow(/empty id/);
	});

	it("onChange notifies listeners and isolates throwers", () => {
		const registry = new ContributionRegistry();
		const warn = vi.spyOn(console, "warn").mockImplementation(noop);
		try {
			let calls = 0;
			const unsub = registry.onChange(() => {
				calls += 1;
			});
			registry.onChange(() => {
				throw new Error("listener boom");
			});
			registry.register("todos", "status-bar", {
				id: "a",
				component: null,
				label: "A",
			});
			expect(calls).toBe(1);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("onChange handler threw:"),
				expect.any(Error),
			);
			unsub();
			registry.register("todos", "status-bar", {
				id: "b",
				component: null,
				label: "B",
			});
			expect(calls).toBe(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("unregister is idempotent when the contribution is already gone", () => {
		const registry = new ContributionRegistry();
		const unregister = registry.register("todos", "status-bar", {
			id: "a",
			component: null,
			label: "A",
		});
		unregister();
		expect(() => unregister()).not.toThrow();
		expect(registry.getForZone("status-bar")).toEqual([]);
	});
});
