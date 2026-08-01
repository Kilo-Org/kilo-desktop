import { describe, expect, it } from "vitest";

import { createStaticNavigation } from "./navigation.js";

describe("createStaticNavigation", () => {
	it("pins the location and fires subscribe synchronously (SdkLocation contract)", () => {
		const navigation = createStaticNavigation({ path: "/todos", search: { filter: "open" } });

		expect(navigation.peek()).toEqual({ path: "/todos", search: { filter: "open" } });

		const seen: unknown[] = [];
		const unsub = navigation.subscribe((location) => seen.push(location));
		expect(seen).toEqual([{ path: "/todos", search: { filter: "open" } }]);
		expect(() => unsub()).not.toThrow();
	});

	it("defaults to the home location and ignores navigate calls", () => {
		const navigation = createStaticNavigation();
		expect(() => navigation.navigate("/anywhere")).not.toThrow();
		expect(navigation.peek()).toEqual({ path: "/", search: {} });
	});
});
