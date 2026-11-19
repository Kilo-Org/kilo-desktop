import { describe, expect, it } from "vitest";

import { KernelKeybindings } from "@kilo-desktop/kernel";
import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import { bootWorkSessions, type MemoryStorage } from "../test-boot";
import { LEGACY_COMMAND_KEYS } from "./index";

function keybindingsHost(initial: Record<string, string | null>) {
	let saved: Readonly<Record<string, string | null>> = initial;
	return {
		host: {
			keybindings: {
				load: () => saved,
				save: (overrides: Readonly<Record<string, string | null>>) => {
					saved = overrides;
				},
			},
		},
		saved: () => saved,
	};
}

async function boot(overrides: Record<string, string | null>, storage?: MemoryStorage) {
	const { host, saved } = keybindingsHost(overrides);
	const booted = await bootWorkSessions({
		core: false,
		host,
		...(storage ? { storage } : {}),
	});
	return { ...booted, saved };
}

describe("moving keyboard shortcuts", () => {
	it("maps every command of kilo.workbench and kilo.workspaces to a command this plugin declares", () => {
		const declared = new Set(
			manifest.contributes.extensions["kernel/command"].map(({ id }) => `kilo.work-sessions/${id}`),
		);

		expect(Object.keys(LEGACY_COMMAND_KEYS)).toHaveLength(38);
		for (const command of Object.values(LEGACY_COMMAND_KEYS)) expect(declared).toContain(command);
	});

	it("moves overrides from the old command keys to the new ones, unbindings included", async () => {
		const { saved } = await boot({
			"kilo.workbench/new-session": "Mod+Shift+N",
			"kilo.workbench/close-pane": null,
			"kilo.workspaces/add": "Mod+Alt+W",
			"kilo.shell/toggle-sidebar": "Mod+B",
		});

		expect(saved()).toEqual({
			"kilo.work-sessions/new-work-session": "Mod+Shift+N",
			"kilo.work-sessions/close-pane": null,
			"kilo.work-sessions/add-workspace": "Mod+Alt+W",
			"kilo.shell/toggle-sidebar": "Mod+B",
		});
	});

	it("keeps an override already set on the new key", async () => {
		const { saved } = await boot({
			"kilo.workbench/search": "Mod+P",
			"kilo.work-sessions/search-work-sessions": "Mod+J",
		});

		expect(saved()).toEqual({ "kilo.work-sessions/search-work-sessions": "Mod+J" });
	});

	it("moves them once", async () => {
		const storage = createMemoryStorage("/data/kilo.work-sessions");
		await boot({}, storage);

		const { kernel } = await boot({ "kilo.workbench/new-pane": "Mod+Y" }, storage);

		expect(kernel.kernelSdk.domainObjects.get(KernelKeybindings)!.getState().overrides).toEqual({
			"kilo.workbench/new-pane": "Mod+Y",
		});
	});
});

describe("number shortcuts changed one at a time", () => {
	const pane = (slot: string) => `kilo.work-sessions/pane-${slot}`;

	it("resets a series changed one number at a time, keeping other overrides", async () => {
		const { saved } = await boot({
			[pane("3")]: "Ctrl+Alt+KeyK",
			"kilo.shell/toggle-sidebar": "Mod+B",
		});

		expect(saved()).toEqual({ "kilo.shell/toggle-sidebar": "Mod+B" });
	});

	it("checks numbers moved from the old command keys too", async () => {
		const { saved } = await boot({ "kilo.workbench/session-2": null });

		expect(saved()).toEqual({});
	});

	it("keeps a series moved to new modifiers as a whole", async () => {
		const uniform = Object.fromEntries(
			["1", "2", "3", "4", "5", "6", "7", "8"]
				.map((slot) => [pane(slot), `Ctrl+Alt+Digit${slot}`])
				.concat([[pane("last"), "Ctrl+Alt+Digit9"]]),
		);
		const { saved } = await boot(uniform);

		expect(saved()).toEqual(uniform);
	});

	it("resets them once, so later changes to a series keep the overrides", async () => {
		const storage = createMemoryStorage("/data/kilo.work-sessions");
		await boot({}, storage);

		const { saved } = await boot({ [pane("3")]: "Ctrl+Alt+KeyK" }, storage);

		expect(saved()).toEqual({ [pane("3")]: "Ctrl+Alt+KeyK" });
	});
});
