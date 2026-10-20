import { describe, expect, it } from "vitest";

import { planModifierChange, planTurnOn, type NumberKeySeries } from "./number-keys";

const series: NumberKeySeries[] = [
	{ id: "tab-number", label: "Tabs", current: "meta", defaultModifier: "meta" },
	{ id: "session-number", label: "Sessions", current: "ctrl", defaultModifier: "ctrl" },
];

describe("planModifierChange", () => {
	it("clears the override when a series goes back to its default", () => {
		const moved: NumberKeySeries[] = [{ ...series[0]!, current: "alt" }, series[1]!];
		expect(planModifierChange(moved, "tab-number", "meta")).toEqual({
			changes: { "series:tab-number": null },
		});
	});

	it("never passes 'off' to the other series, whether turning off or taking its modifier", () => {
		expect(planModifierChange(series, "session-number", "none")).toEqual({
			changes: { "series:session-number": { modifier: "none" } },
		});
		const tabsOff: NumberKeySeries[] = [
			{ ...series[0]!, current: "none" },
			{ ...series[1]!, current: "meta" },
		];
		expect(planModifierChange(tabsOff, "tab-number", "meta").changes).not.toHaveProperty(
			"series:session-number",
		);
	});
});

describe("planTurnOn", () => {
	const choices = ["meta", "ctrl", "alt"] as const;

	it("brings a series back on its default modifier when it is free", () => {
		const tabsOff: NumberKeySeries[] = [{ ...series[0]!, current: "none" }, series[1]!];
		expect(planTurnOn(tabsOff, "tab-number", choices)).toEqual({
			changes: { "series:tab-number": null },
		});
	});

	it("takes the first free modifier instead of turning the other series off", () => {
		const tabsOff: NumberKeySeries[] = [
			{ ...series[0]!, current: "none" },
			{ ...series[1]!, current: "meta" },
		];
		expect(planTurnOn(tabsOff, "tab-number", choices)).toEqual({
			changes: { "series:tab-number": { modifier: "ctrl" } },
		});
	});
});
