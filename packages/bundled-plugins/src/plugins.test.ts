import { describe, expect, it } from "vitest";

import {
	discoverPlugins,
	KERNEL_CONTEXT_KEYS,
	KERNEL_DEFINITIONS,
	manifestSchema,
} from "@kilo-desktop/kernel";

import { BUNDLED_PLUGINS } from "./plugins";
import { withEntries } from "./registrations";
import { pluginRemovals } from "./removal";

describe("BUNDLED_PLUGINS", () => {
	it("discovers together with the kernel without issues", () => {
		const result = discoverPlugins(withEntries({}, BUNDLED_PLUGINS), {
			kernelDefinitions: KERNEL_DEFINITIONS,
			kernelContextKeys: KERNEL_CONTEXT_KEYS,
		});

		expect(result.issues).toEqual([]);
	});

	it("flags exactly the plugins whose manifest has no web entry as main-only", () => {
		for (const plugin of BUNDLED_PLUGINS) {
			const manifest = manifestSchema.parse(plugin.manifest);

			expect({ id: manifest.id, mainOnly: plugin.mainOnly === true }).toEqual({
				id: manifest.id,
				mainOnly: manifest.web === undefined,
			});
		}
	});

	it("keeps the window (kilo.shell) when kilo.core is removed, and kilo.core without the window", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.core"]).toEqual(["kilo.core"]);
		expect(removedWith["kilo.shell"]).toEqual(["kilo.shell"]);
	});

	it("removes kilo.work-sessions alone, and keeps it without kilo.core or kilo.shell", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.work-sessions"]).toEqual(["kilo.work-sessions"]);
		expect(removedWith["kilo.core"]).not.toContain("kilo.work-sessions");
		expect(removedWith["kilo.shell"]).not.toContain("kilo.work-sessions");
	});

	it("removes kilo.chat alone, and keeps it without kilo.core, kilo.shell or kilo.work-sessions", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.chat"]).toEqual(["kilo.chat"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions"]) {
			expect(removedWith[host]).not.toContain("kilo.chat");
		}
	});

	it("removes kilo.git alone, and keeps it without kilo.core, kilo.shell, kilo.work-sessions or kilo.chat", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.git"]).toEqual(["kilo.git"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions", "kilo.chat"]) {
			expect(removedWith[host]).not.toContain("kilo.git");
		}
	});

	it("removes kilo.files alone, and keeps it without kilo.core, kilo.shell, kilo.work-sessions or kilo.chat", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.files"]).toEqual(["kilo.files"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions", "kilo.chat"]) {
			expect(removedWith[host]).not.toContain("kilo.files");
		}
	});

	it("removes kilo.terminal alone, and keeps it without kilo.core, kilo.shell or kilo.work-sessions", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.terminal"]).toEqual(["kilo.terminal"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions"]) {
			expect(removedWith[host]).not.toContain("kilo.terminal");
		}
	});

	it("removes kilo.browser alone, and keeps it without kilo.core, kilo.shell, kilo.work-sessions or kilo.chat", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.browser"]).toEqual(["kilo.browser"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions", "kilo.chat"]) {
			expect(removedWith[host]).not.toContain("kilo.browser");
		}
	});

	it("removes kilo.notebook alone, and keeps it without kilo.core, kilo.shell or kilo.work-sessions", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.notebook"]).toEqual(["kilo.notebook"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions"]) {
			expect(removedWith[host]).not.toContain("kilo.notebook");
		}
	});

	it("removes kilo.marketplace alone, and keeps it without kilo.core, kilo.shell, kilo.work-sessions or kilo.chat", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.marketplace"]).toEqual(["kilo.marketplace"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions", "kilo.chat"]) {
			expect(removedWith[host]).not.toContain("kilo.marketplace");
		}
	});

	it("removes kilo.local-inference alone, and keeps it without kilo.core, kilo.shell, kilo.work-sessions or kilo.chat", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.local-inference"]).toEqual(["kilo.local-inference"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.work-sessions", "kilo.chat"]) {
			expect(removedWith[host]).not.toContain("kilo.local-inference");
		}
	});

	it("removes kilo.environments alone, and keeps it without kilo.core, kilo.shell, kilo.chat or kilo.local-inference", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.environments"]).toEqual(["kilo.environments"]);
		for (const host of ["kilo.core", "kilo.shell", "kilo.chat", "kilo.local-inference"]) {
			expect(removedWith[host]).not.toContain("kilo.environments");
		}
	});

	it("removes kilo.anaconda alone, and keeps it without kilo.shell or kilo.local-inference", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.anaconda"]).toEqual(["kilo.anaconda"]);
		for (const host of ["kilo.shell", "kilo.local-inference"]) {
			expect(removedWith[host]).not.toContain("kilo.anaconda");
		}
	});

	it("removes kilo.workspace-board alone, and keeps it without kilo.shell or kilo.work-sessions", () => {
		const removedWith = Object.fromEntries(
			pluginRemovals(BUNDLED_PLUGINS).map((removal) => [removal.removed, removal.removedIds]),
		);

		expect(removedWith["kilo.workspace-board"]).toEqual(["kilo.workspace-board"]);
		for (const host of ["kilo.shell", "kilo.work-sessions"]) {
			expect(removedWith[host]).not.toContain("kilo.workspace-board");
		}
	});
});
