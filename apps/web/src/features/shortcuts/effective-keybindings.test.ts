import { describe, expect, it } from "vitest";

import type { Command } from "@kilo-desktop/feature-sdk";

import { commandForTrigger, computeEffectiveKeybindings } from "./effective-keybindings";

const noop = () => undefined;

function command(id: string, extra: Partial<Command> = {}): Command {
	return { id, featureId: id.split(".")[0]!, label: id, handler: noop, ...extra };
}

describe("computeEffectiveKeybindings", () => {
	it("captures defaults but only documents locally handled keys", () => {
		const result = computeEffectiveKeybindings(
			[
				command("kilo-ui.tab-1", { keybinding: "Mod+1" }),
				command("kilo-ui.send", { keybinding: "Enter", handledLocally: true }),
			],
			{},
			"mac",
		);
		expect(result.byCommand["kilo-ui.send"]).toEqual(["Enter"]);
		expect(result.bindings).toEqual([{ chord: "Meta+Digit1", commandId: "kilo-ui.tab-1" }]);
	});

	it("applies rebinds and disables, and a rebind beats another command's default", () => {
		const result = computeEffectiveKeybindings(
			[
				command("a.search", { keybinding: "Mod+K" }),
				command("b.close", { keybinding: "Mod+W" }),
				command("c.other", { keybinding: "Mod+J" }),
			],
			{ "b.close": { disabled: true }, "c.other": { chords: ["Meta+KeyK"] } },
			"mac",
		);
		expect(result.byCommand).toEqual({ "a.search": [], "b.close": [], "c.other": ["Meta+KeyK"] });
		expect(result.conflicts).toEqual([{ chord: "Meta+KeyK", commandIds: ["c.other", "a.search"] }]);
	});

	it("lets a focus-scoped command share a chord without conflicting, and bind free ones", () => {
		const result = computeEffectiveKeybindings(
			[
				command("a.search", { keybinding: "Mod+K" }),
				command("t.clear", { keybinding: "Mod+K", when: () => true }),
				command("t.find", { keybinding: "Mod+F", when: () => true }),
			],
			{},
			"mac",
		);
		expect(result.conflicts).toEqual([]);
		expect(result.byCommand["t.clear"]).toEqual(["Meta+KeyK"]);
		expect(result.bindings).toEqual([
			{ chord: "Meta+KeyK", commandId: "a.search" },
			{ chord: "Meta+KeyF", commandId: "t.find" },
		]);
	});

	it("moves a whole numbered series to the chosen modifier", () => {
		const series = { id: "tab-number", label: "Go to tab 1–9", modifierChoice: true };
		const result = computeEffectiveKeybindings(
			[
				command("kilo-ui.tab-1", { keybinding: "Mod+1", configurable: false, series }),
				command("kilo-ui.tab-last", { keybinding: "Mod+9", configurable: false, series }),
			],
			{ "series:tab-number": { modifier: "ctrl" } },
			"mac",
		);
		expect(result.byCommand).toEqual({
			"kilo-ui.tab-1": ["Ctrl+Digit1"],
			"kilo-ui.tab-last": ["Ctrl+Digit9"],
		});
	});
});

describe("commandForTrigger", () => {
	let terminalFocused = false;
	const commands = [
		command("a.search", { keybinding: "Mod+K" }),
		command("t.clear", { keybinding: "Mod+K", when: () => terminalFocused }),
		command("t.find", { keybinding: "Mod+F", when: () => terminalFocused }),
	];
	const { byCommand } = computeEffectiveKeybindings(commands, {}, "mac");
	const run = (commandId: string, chord: string, modalOpen = false) =>
		commandForTrigger(commands, byCommand, { commandId, chord }, modalOpen);

	it("hands the chord to the focused pane's command, else to the owner", () => {
		terminalFocused = true;
		expect(run("a.search", "Meta+KeyK")).toBe("t.clear");
		terminalFocused = false;
		expect(run("a.search", "Meta+KeyK")).toBe("a.search");
	});

	it("runs nothing for an unfocused scoped binding or behind a modal dialog", () => {
		terminalFocused = false;
		expect(run("t.find", "Meta+KeyF")).toBeNull();
		expect(run("a.search", "Meta+KeyK", true)).toBeNull();
	});
});
