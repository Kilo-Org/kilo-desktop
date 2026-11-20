import { describe, expect, it } from "vitest";

import manifest from "../../../plugin.json";
import {
	collectNumberKeySeries,
	listRows,
	NUMBER_SETS,
	planModifierChange,
	planTurnOn,
	type NumberSetDefinition,
	type OverridePlan,
} from "./number-sets";

const slot = (prefix: string, digit: number, keybinding: unknown) => ({
	key: `acme/${prefix}-${digit}`,
	scoped: true,
	metadata: { keybinding: keybinding as string },
});

const MAC = ["meta", "ctrl", "alt"] as const;

const commands = [
	...[1, 2, 9].map((digit) => slot("tab", digit, `Mod+${digit}`)),
	...[1, 2, 9].map((digit) =>
		slot("session", digit, { mac: `Ctrl+${digit}`, default: `Alt+${digit}` }),
	),
	{ key: "acme/zoom", scoped: false, metadata: { keybinding: "Mod+Shift+1" } },
	{ key: "acme/lonely", scoped: false, metadata: { keybinding: "Mod+1" } },
];

const SETS: readonly NumberSetDefinition[] = [
	{
		id: "tabs",
		title: "Tabs",
		listTitle: "Go to tab 1–9",
		commands: ["acme/tab-1", "acme/tab-2", "acme/tab-9"],
	},
	{
		id: "sessions",
		title: "Sessions",
		listTitle: "Go to session 1–9",
		commands: ["acme/session-1", "acme/session-2", "acme/session-9"],
	},
];

const collect = (overrides: OverridePlan, platform: "mac" | "windows" = "mac") =>
	collectNumberKeySeries(SETS, commands, overrides, platform);

describe("App Navigation's sets", () => {
	it("claims exactly the commands of its sets, which are the plugin's numbered commands", () => {
		const panel = manifest.contributes.extensions["kilo.shell/shortcuts-panel"][0]!;
		const own = manifest.contributes.extensions["kernel/command"].map((command) => ({
			key: `kilo.work-sessions/${command.id}`,
			scoped: false,
			metadata: command,
		}));

		expect(panel.commands).toEqual(NUMBER_SETS.flatMap((set) => set.commands));
		expect(
			collectNumberKeySeries(NUMBER_SETS, own, {}, "mac").map((set) => [
				set.definition.id,
				set.current,
				set.digits.size,
			]),
		).toEqual([
			["tabs", "meta", 9],
			["sessions", "ctrl", 9],
		]);
	});
});

describe("number-key series", () => {
	it("reads only the listed commands of each set, in the set's order", () => {
		const series = collect({});

		expect(
			series.map(({ definition, current, digits }) => [definition.id, current, [...digits.keys()]]),
		).toEqual([
			["tabs", "meta", ["acme/tab-1", "acme/tab-2", "acme/tab-9"]],
			["sessions", "ctrl", ["acme/session-1", "acme/session-2", "acme/session-9"]],
		]);
		expect(collect({}, "windows").map((s) => s.current)).toEqual(["ctrl", "alt"]);
	});

	it("leaves out a listed slot whose default isn't one modifier plus a digit", () => {
		const odd = [
			{ id: "odd", title: "Odd", listTitle: "Odd", commands: ["acme/zoom", "acme/tab-1"] },
		];

		expect(collectNumberKeySeries(odd, commands, {}, "mac")).toEqual([]);
	});

	it("lists one row per set on one modifier, and none for an off or custom set", () => {
		const titles = new Map([["acme/tab-9", "Go to last tab"]]);

		expect(listRows(collect({}), titles, "mac")).toEqual([
			{
				title: "Go to tab 1–9",
				labels: ["⌘1–9"],
				commands: ["acme/tab-1", "acme/tab-2", "acme/tab-9"],
				searchText: "  Go to last tab",
			},
			{
				title: "Go to session 1–9",
				labels: ["⌃1–9"],
				commands: ["acme/session-1", "acme/session-2", "acme/session-9"],
				searchText: "  ",
			},
		]);
		expect(listRows(collect({}, "windows"), titles, "windows").map((row) => row.labels)).toEqual([
			["Ctrl+1–9"],
			["Alt+1–9"],
		]);
		const offAndCustom = collect({
			"acme/tab-1": "Meta+KeyJ",
			"acme/session-1": null,
			"acme/session-2": null,
			"acme/session-9": null,
		});
		expect(listRows(offAndCustom, titles, "mac")).toEqual([]);
	});

	it("reads the modifier from overrides: off, moved, or customized per slot", () => {
		const read = (overrides: Record<string, string | null>) =>
			collect(overrides, "mac")[0]!.current;

		expect(read({ "acme/tab-1": null, "acme/tab-2": null, "acme/tab-9": null })).toBe("none");
		expect(
			read({ "acme/tab-1": "Alt+Digit1", "acme/tab-2": "Alt+Digit2", "acme/tab-9": "Alt+Digit9" }),
		).toBe("alt");
		expect(read({ "acme/tab-1": "Meta+KeyJ" })).toBe("custom");
	});

	it("moves every slot to the new modifier, resetting slots that land on their default", () => {
		const series = collect({}, "mac");

		expect(planModifierChange(series, "tabs", "alt", MAC)).toEqual({
			"acme/tab-1": "Alt+Digit1",
			"acme/tab-2": "Alt+Digit2",
			"acme/tab-9": "Alt+Digit9",
		});
		expect(planModifierChange(series, "tabs", "none", MAC)).toEqual({
			"acme/tab-1": null,
			"acme/tab-2": null,
			"acme/tab-9": null,
		});
		const moved = collectNumberKeySeries(
			SETS,
			commands,
			planModifierChange(series, "tabs", "alt", MAC),
			"mac",
		);
		expect(planModifierChange(moved, "tabs", "meta", MAC)).toStrictEqual({
			"acme/tab-1": undefined,
			"acme/tab-2": undefined,
			"acme/tab-9": undefined,
		});
	});

	it("swaps with the series that holds the modifier", () => {
		const series = collect({}, "mac");

		expect(planModifierChange(series, "tabs", "ctrl", MAC)).toStrictEqual({
			"acme/tab-1": "Ctrl+Digit1",
			"acme/tab-2": "Ctrl+Digit2",
			"acme/tab-9": "Ctrl+Digit9",
			"acme/session-1": "Meta+Digit1",
			"acme/session-2": "Meta+Digit2",
			"acme/session-9": "Meta+Digit9",
		});
	});

	it("moves the holder to a free modifier when the target has none to hand over", () => {
		const series = collect({}, "mac");
		const tabsOff = collectNumberKeySeries(
			SETS,
			commands,
			planModifierChange(series, "tabs", "none", MAC),
			"mac",
		);
		const tabsCustom = collect({ "acme/tab-1": "Meta+KeyJ" }, "mac");

		for (const all of [tabsOff, tabsCustom]) {
			const plan = planModifierChange(all, "tabs", "ctrl", MAC);
			expect(plan["acme/session-1"]).toBe("Meta+Digit1");
			expect(plan["acme/tab-1"]).toBe("Ctrl+Digit1");
		}
	});

	it("turning a set off leaves another set that is already off alone", () => {
		const series = collect({}, "mac");
		const tabsOff = collectNumberKeySeries(
			SETS,
			commands,
			planModifierChange(series, "tabs", "none", MAC),
			"mac",
		);

		expect(Object.keys(planModifierChange(tabsOff, "sessions", "none", MAC))).toEqual([
			"acme/session-1",
			"acme/session-2",
			"acme/session-9",
		]);
	});

	it("counts the modifier a custom set's slots still hold as taken", () => {
		// Tabs on ⌃ except one hand-rebound slot; Sessions off.
		const all = collectNumberKeySeries(
			SETS,
			commands,
			{
				"acme/tab-1": "Meta+KeyJ",
				"acme/tab-2": "Ctrl+Digit2",
				"acme/tab-9": "Ctrl+Digit9",
				"acme/session-1": null,
				"acme/session-2": null,
				"acme/session-9": null,
			},
			"mac",
		);

		expect(planTurnOn(all, "sessions", MAC)["acme/session-1"]).toBe("Meta+Digit1");
	});

	it("turns a series back on with its default modifier, or the first free one", () => {
		const series = collect({}, "mac");
		const tabsOff = collectNumberKeySeries(
			SETS,
			commands,
			planModifierChange(series, "tabs", "none", MAC),
			"mac",
		);
		expect(planTurnOn(tabsOff, "tabs", MAC)["acme/tab-1"]).toBeUndefined();

		const sessionsOnMeta = collectNumberKeySeries(
			SETS,
			commands,
			{
				...planModifierChange(series, "tabs", "none", MAC),
				"acme/session-1": "Meta+Digit1",
				"acme/session-2": "Meta+Digit2",
				"acme/session-9": "Meta+Digit9",
			},
			"mac",
		);
		expect(planTurnOn(sessionsOnMeta, "tabs", MAC)["acme/tab-1"]).toBe("Ctrl+Digit1");
	});
});
