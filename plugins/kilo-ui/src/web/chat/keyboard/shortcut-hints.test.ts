import { describe, expect, it } from "vitest";

import { shortcutHints } from "./shortcut-hints.js";

const META = { ctrl: false, alt: false, shift: false, meta: true };
const CTRL = { ctrl: true, alt: false, shift: false, meta: false };
const tabBindings = Object.fromEntries([
	...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`kilo-ui.tab-${n}`, [`Meta+Digit${n}`]]),
	["kilo-ui.tab-last", ["Meta+Digit9"]],
]);

describe("shortcutHints", () => {
	it("labels items while the series modifier is held, with 9 on the last item", () => {
		const ids = Array.from({ length: 10 }, (_, index) => `t${index}`);
		const hints = shortcutHints("tab", ids, tabBindings, META, "mac");
		expect(hints.get("t0")).toBe("⌘1");
		expect(hints.get("t7")).toBe("⌘8");
		expect(hints.has("t8")).toBe(false);
		expect(hints.get("t9")).toBe("⌘9");
	});

	it("keeps the positional number when the last item is within 1–8", () => {
		const hints = shortcutHints("tab", ["a", "b"], tabBindings, META, "mac");
		expect([...hints]).toEqual([
			["a", "⌘1"],
			["b", "⌘2"],
		]);
	});

	it("shows nothing for other modifiers, nothing held, or a series switched off", () => {
		expect(shortcutHints("tab", ["a"], tabBindings, CTRL, "mac").size).toBe(0);
		expect(shortcutHints("tab", ["a"], tabBindings, null, "mac").size).toBe(0);
		expect(shortcutHints("tab", ["a"], { "kilo-ui.tab-1": [] }, META, "mac").size).toBe(0);
	});

	it("spells keys out off macOS", () => {
		const hints = shortcutHints(
			"session",
			["s"],
			{ "kilo-ui.session-1": ["Alt+Digit1"] },
			{
				...CTRL,
				ctrl: false,
				alt: true,
			},
			"windows",
		);
		expect(hints.get("s")).toBe("Alt+1");
	});
});
