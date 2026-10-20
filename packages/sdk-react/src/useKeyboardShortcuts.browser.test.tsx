import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFeatureSystem, SdkProvider } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { useCommand, useCommands, useEffectiveKeybindings } from "./useKeyboardShortcuts.js";

function setup() {
	const system = createFeatureSystem({ shellDelegates: createTestShellDelegates(), features: [] });
	const { stateBroker } = system.services;
	const keybindings = stateBroker.register<Record<string, readonly string[]>>(
		"shell",
		"keybindings",
		{},
	);
	return { system, keybindings };
}

function CommandProbe({ enabled, handler }: { enabled: boolean; handler: () => void }) {
	useCommand("todos", { id: "add", label: "Add", keybinding: "Mod+N", handler }, enabled);
	const ids = useCommands().map((command) => command.id);
	const chords = useEffectiveKeybindings()["todos.add"] ?? null;
	return <span data-testid="out">{JSON.stringify({ ids, chords })}</span>;
}

describe("useKeyboardShortcuts", () => {
	afterEach(cleanup);

	it("registers while enabled, runs the latest handler, and reads the effective keys", async () => {
		const { system, keybindings } = setup();
		const first = vi.fn();
		const latest = vi.fn();
		const view = (enabled: boolean, handler: () => void) => (
			<SdkProvider system={system}>
				<CommandProbe enabled={enabled} handler={handler} />
			</SdkProvider>
		);
		const { baseElement, rerender } = render(view(true, first));
		const out = () => JSON.parse(baseElement.querySelector('[data-testid="out"]')!.textContent!);

		await expect.poll(() => out().ids).toEqual(["todos.add"]);
		expect(out().chords).toBeNull();

		keybindings.set({ "todos.add": ["Meta+KeyN"] });
		await expect.poll(() => out().chords).toEqual(["Meta+KeyN"]);

		rerender(view(true, latest));
		await system.services.commandRegistry.execute("todos.add");
		expect(first).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledOnce();

		rerender(view(false, latest));
		await expect.poll(() => out().ids).toEqual([]);
	});

	it("keeps a focus-scoped command's `when` current across renders", async () => {
		const { system } = setup();
		function ScopedProbe({ focused }: { focused: boolean }) {
			useCommand("terminal", {
				id: "clear",
				label: "Clear",
				keybinding: "Mod+K",
				when: () => focused,
				handler: () => undefined,
			});
			return null;
		}
		const view = (focused: boolean) => (
			<SdkProvider system={system}>
				<ScopedProbe focused={focused} />
			</SdkProvider>
		);
		const { rerender } = render(view(false));
		const scoped = () =>
			system.services.commandRegistry.all().find((command) => command.id === "terminal.clear");

		await expect.poll(() => scoped()?.when?.()).toBe(false);
		rerender(view(true));
		expect(scoped()?.when?.()).toBe(true);
	});
});
