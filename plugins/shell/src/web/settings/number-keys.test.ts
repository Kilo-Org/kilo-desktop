import { describe, expect, it } from "vitest";

import { collectNumberKeySeries, planModifierChange, planTurnOn } from "./number-keys";

const slot = (prefix: string, category: string, digit: number, keybinding: unknown) => ({
	key: `acme/${prefix}-${digit}`,
	scoped: true,
	metadata: { category, keybinding: keybinding as string },
});

const MAC = ["meta", "ctrl", "alt"] as const;

const commands = [
	...[1, 2, 9].map((digit) => slot("tab", "Tabs", digit, `Mod+${digit}`)),
	...[1, 2, 9].map((digit) =>
		slot("session", "Sessions", digit, { mac: `Ctrl+${digit}`, default: `Alt+${digit}` }),
	),
	{ key: "acme/zoom", scoped: false, metadata: { category: "Tabs", keybinding: "Mod+Shift+1" } },
	{ key: "acme/lonely", scoped: false, metadata: { category: "Other", keybinding: "Mod+1" } },
];

describe("number-key series", () => {
	it("finds each category's 1–9 commands that share one modifier", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");

		expect(
			series.map(({ category, current, digits }) => [category, current, [...digits.keys()]]),
		).toEqual([
			["Tabs", "meta", ["acme/tab-1", "acme/tab-2", "acme/tab-9"]],
			["Sessions", "ctrl", ["acme/session-1", "acme/session-2", "acme/session-9"]],
		]);
		expect(collectNumberKeySeries(commands, {}, "windows").map((s) => s.current)).toEqual([
			"ctrl",
			"alt",
		]);
	});

	it("reads the modifier from overrides: off, moved, or customized per slot", () => {
		const read = (overrides: Record<string, string | null>) =>
			collectNumberKeySeries(commands, overrides, "mac")[0]!.current;

		expect(read({ "acme/tab-1": null, "acme/tab-2": null, "acme/tab-9": null })).toBe("none");
		expect(
			read({ "acme/tab-1": "Alt+Digit1", "acme/tab-2": "Alt+Digit2", "acme/tab-9": "Alt+Digit9" }),
		).toBe("alt");
		expect(read({ "acme/tab-1": "Meta+KeyJ" })).toBe("custom");
	});

	it("moves every slot to the new modifier, resetting slots that land on their default", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");

		expect(planModifierChange(series, "Tabs", "alt", MAC)).toEqual({
			"acme/tab-1": "Alt+Digit1",
			"acme/tab-2": "Alt+Digit2",
			"acme/tab-9": "Alt+Digit9",
		});
		expect(planModifierChange(series, "Tabs", "none", MAC)).toEqual({
			"acme/tab-1": null,
			"acme/tab-2": null,
			"acme/tab-9": null,
		});
		const moved = collectNumberKeySeries(
			commands,
			planModifierChange(series, "Tabs", "alt", MAC),
			"mac",
		);
		expect(planModifierChange(moved, "Tabs", "meta", MAC)).toStrictEqual({
			"acme/tab-1": undefined,
			"acme/tab-2": undefined,
			"acme/tab-9": undefined,
		});
	});

	it("swaps with the series that holds the modifier", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");

		expect(planModifierChange(series, "Tabs", "ctrl", MAC)).toStrictEqual({
			"acme/tab-1": "Ctrl+Digit1",
			"acme/tab-2": "Ctrl+Digit2",
			"acme/tab-9": "Ctrl+Digit9",
			"acme/session-1": "Meta+Digit1",
			"acme/session-2": "Meta+Digit2",
			"acme/session-9": "Meta+Digit9",
		});
	});

	it("moves the holder to a free modifier when the target has none to hand over", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");
		const tabsOff = collectNumberKeySeries(
			commands,
			planModifierChange(series, "Tabs", "none", MAC),
			"mac",
		);
		const tabsCustom = collectNumberKeySeries(commands, { "acme/tab-1": "Meta+KeyJ" }, "mac");

		for (const all of [tabsOff, tabsCustom]) {
			const plan = planModifierChange(all, "Tabs", "ctrl", MAC);
			expect(plan["acme/session-1"]).toBe("Meta+Digit1");
			expect(plan["acme/tab-1"]).toBe("Ctrl+Digit1");
		}
	});

	it("turning a set off leaves another set that is already off alone", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");
		const tabsOff = collectNumberKeySeries(
			commands,
			planModifierChange(series, "Tabs", "none", MAC),
			"mac",
		);

		expect(Object.keys(planModifierChange(tabsOff, "Sessions", "none", MAC))).toEqual([
			"acme/session-1",
			"acme/session-2",
			"acme/session-9",
		]);
	});

	it("counts the modifier a custom set's slots still hold as taken", () => {
		// Tabs on ⌃ except one hand-rebound slot; Sessions off.
		const all = collectNumberKeySeries(
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

		expect(planTurnOn(all, "Sessions", MAC)["acme/session-1"]).toBe("Meta+Digit1");
	});

	it("turns a series back on with its default modifier, or the first free one", () => {
		const series = collectNumberKeySeries(commands, {}, "mac");
		const tabsOff = collectNumberKeySeries(
			commands,
			planModifierChange(series, "Tabs", "none", MAC),
			"mac",
		);
		expect(planTurnOn(tabsOff, "Tabs", MAC)["acme/tab-1"]).toBeUndefined();

		const sessionsOnMeta = collectNumberKeySeries(
			commands,
			{
				...planModifierChange(series, "Tabs", "none", MAC),
				"acme/session-1": "Meta+Digit1",
				"acme/session-2": "Meta+Digit2",
				"acme/session-9": "Meta+Digit9",
			},
			"mac",
		);
		expect(planTurnOn(sessionsOnMeta, "Tabs", MAC)["acme/tab-1"]).toBe("Ctrl+Digit1");
	});
});
