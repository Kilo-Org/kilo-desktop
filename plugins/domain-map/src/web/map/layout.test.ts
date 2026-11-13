import { describe, expect, it } from "vitest";

import { layoutDomainMap, type Vec3 } from "./layout";
import { buildDomainMap } from "./model";

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const map = buildDomainMap({
	plugins: [
		{ id: "kilo.a", name: "a", main: true, web: true, requires: [] },
		{ id: "kilo.b", name: "b", main: true, web: false, requires: ["kilo.a/one"] },
		{ id: "kilo.w", name: "w", main: false, web: true, requires: ["kilo.a/one", "kilo.a/point"] },
	],
	domains: [
		...Array.from({ length: 12 }, (_, i) => ({
			id: `kernel/d${i}`,
			owner: "kernel",
			home: "main" as const,
			events: [],
		})),
		{ id: "kilo.a/one", owner: "kilo.a", home: "main", events: [] },
		{ id: "kilo.a/two", owner: "kilo.a", home: "main", events: [] },
		{ id: "kilo.w/view", owner: "kilo.w", home: "renderer", events: [] },
	],
	points: [{ id: "kilo.a/point", owner: "kilo.a", process: "renderer" }],
	contributions: [{ pointId: "kilo.a/point", pluginId: "kilo.w" }],
	isProvided: () => true,
	includeUnprovided: false,
	includePoints: true,
});

describe("layoutDomainMap", () => {
	const layout = layoutDomainMap(map);

	it("stacks main above the window", () => {
		const [main, window] = layout.planes;
		expect(main.y).toBeGreaterThan(window.y);
	});

	it("centres the kernel and rings the other plugins round it without overlapping", () => {
		const kernel = layout.plugins.get("main:kernel")!;
		expect([kernel.position[0], kernel.position[2]]).toEqual([0, 0]);
		const placed = map.plugins
			.filter((p) => p.process === "main")
			.map((p) => layout.plugins.get(p.key)!);
		for (const [index, a] of placed.entries()) {
			for (const b of placed.slice(index + 1)) {
				expect(flat(a.position, b.position)).toBeGreaterThan(a.radius + b.radius);
			}
		}
	});

	it("keeps domain objects over their platform, and points round its edge below them", () => {
		const a = layout.plugins.get("main:kilo.a")!;
		const one = layout.domains.get("kilo.a/one")!;
		expect(flat(one, a.position)).toBeLessThan(a.radius);
		expect(one[1]).toBeGreaterThan(a.position[1]);

		const shell = layout.plugins.get("window:kilo.a")!;
		const point = layout.points.get("window:point:kilo.a/point")!;
		expect(flat(point, shell.position)).toBeLessThan(shell.radius);
	});

	it("runs a use from the domain object (or its mirror) to its user, and a feed from contributor to point", () => {
		const direct = layout.links.get("use:main:kilo.b<kilo.a/one")!;
		expect(distance(direct[0], layout.domains.get("kilo.a/one")!)).toBe(0);
		expect(flat(direct[2], layout.plugins.get("main:kilo.b")!.position)).toBe(0);
		expect(direct[1][1]).toBeGreaterThan(Math.max(direct[0][1], direct[2][1]));

		const viaMirror = layout.links.get("use:window:kilo.w<kilo.a/one")!;
		expect(distance(viaMirror[0], layout.domains.get("mirror:kilo.a/one")!)).toBe(0);

		const feed = layout.links.get("feed:window:kilo.w>window:point:kilo.a/point")!;
		expect(distance(feed[2], layout.points.get("window:point:kilo.a/point")!)).toBe(0);
	});

	it("lays out an empty map", () => {
		const empty = layoutDomainMap({
			domains: [],
			plugins: [],
			mirrors: [],
			uses: [],
			points: [],
			feeds: [],
		});
		expect(empty.plugins.size).toBe(0);
	});
});
