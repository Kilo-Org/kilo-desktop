import { describe, expect, it } from "vitest";

import { DEFAULT_MAP_PREFERENCES, MapPreferences } from "./preferences";

describe("MapPreferences", () => {
	it("starts live, showing state changes", () => {
		expect(new MapPreferences().current).toEqual(DEFAULT_MAP_PREFERENCES);
		expect(DEFAULT_MAP_PREFERENCES).toMatchObject({ live: true, showState: true, rotate: false });
	});

	it("changes one preference at a time, telling listeners", () => {
		const preferences = new MapPreferences();
		const seen: boolean[] = [];
		const stop = preferences.subscribe(() => void seen.push(preferences.current.live));

		preferences.set({ live: false });
		preferences.set({ rotate: true });
		stop();
		preferences.set({ live: true });

		expect(seen).toEqual([false, false]);
		expect(preferences.current).toMatchObject({ live: true, rotate: true });
	});

	it("keeps the same snapshot when nothing changed, so React doesn't re-render", () => {
		const preferences = new MapPreferences();
		const before = preferences.current;
		let changes = 0;
		preferences.subscribe(() => void (changes += 1));

		preferences.set({ live: true });

		expect(preferences.current).toBe(before);
		expect(changes).toBe(0);
	});

	it("resets", () => {
		const preferences = new MapPreferences();
		preferences.set({ rotate: true, showState: false });

		preferences.reset();

		expect(preferences.current).toEqual(DEFAULT_MAP_PREFERENCES);
	});
});
