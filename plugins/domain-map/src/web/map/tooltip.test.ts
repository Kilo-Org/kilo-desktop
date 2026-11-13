import { describe, expect, it } from "vitest";

import { buildDomainMap } from "./model";
import { describePicked } from "./tooltip";

const map = buildDomainMap({
	plugins: [
		{ id: "kilo.sessions", name: "Sessions", main: true, web: false, requires: [] },
		{ id: "kilo.shell", name: "Shell", main: false, web: true, requires: [] },
		{ id: "kilo.git", name: "Git", main: true, web: false, requires: ["kilo.sessions/session"] },
		{
			id: "kilo.workbench",
			name: "Workbench",
			main: false,
			web: true,
			requires: ["kilo.sessions/session"],
		},
	],
	domains: [
		{ id: "kilo.sessions/session", owner: "kilo.sessions", home: "main", events: ["opened"] },
		{ id: "kilo.git/status", owner: "kilo.git", home: "main", events: [] },
	],
	points: [{ id: "kilo.shell/main", owner: "kilo.shell", process: "renderer" }],
	contributions: [{ pointId: "kilo.shell/main", pluginId: "kilo.workbench" }],
	isProvided: (id) => id !== "kilo.git/status",
	includeUnprovided: true,
	includePoints: true,
});

describe("describePicked", () => {
	it("tells who owns a domain object, where it lives, its events and who declares they use it", () => {
		const session = map.domains.find((d) => d.id === "kilo.sessions/session")!;

		expect(describePicked(map, { kind: "domain", domain: session })).toEqual({
			title: "kilo.sessions/session",
			rows: {
				"Owned by": "kilo.sessions",
				"Lives in": "main process",
				Events: "opened",
				"Used by (declared)": "kilo.git, kilo.workbench",
			},
		});
	});

	it("says when a domain object isn't provided and nobody uses it", () => {
		const status = map.domains.find((d) => d.id === "kilo.git/status")!;

		expect(describePicked(map, { kind: "domain", domain: status })?.rows).toMatchObject({
			Events: "none",
			"Used by (declared)": "nobody",
			Status: "not provided",
		});
	});

	it("explains a mirror", () => {
		expect(describePicked(map, { kind: "mirror", mirror: map.mirrors[0]! })?.title).toBe(
			"Mirror of kilo.sessions/session",
		);
	});

	it("tells who offers a point and who contributes to it, from the point or a feed", () => {
		const fromPoint = describePicked(map, { kind: "point", point: map.points[0]! });
		const fromFeed = describePicked(map, { kind: "feed", feed: map.feeds[0]! });

		expect(fromPoint).toEqual({
			title: "kilo.shell/main (extension point)",
			rows: {
				"Offered by": "kilo.shell",
				"Contributed to by": "kilo.workbench",
				In: "this window",
			},
		});
		expect(fromFeed).toEqual(fromPoint);
	});

	it("counts a plugin's domain objects and uses, and the mirrors the window's kernel holds", () => {
		const git = map.plugins.find((p) => p.key === "main:kilo.git")!;
		const kernel = map.plugins.find((p) => p.key === "window:kernel")!;

		expect(describePicked(map, { kind: "plugin", plugin: git })?.rows).toEqual({
			Plugin: "kilo.git",
			"Runs in": "main process",
			"Domain objects": 1,
			"Uses (declared)": 1,
		});
		expect(describePicked(map, { kind: "plugin", plugin: kernel })?.rows).toMatchObject({
			"Mirrors held": 1,
		});
	});

	it("names a use, and says when it goes through the mirror", () => {
		const direct = map.uses.find((u) => u.user === "kilo.git")!;
		const viaMirror = map.uses.find((u) => u.user === "kilo.workbench")!;

		expect(describePicked(map, { kind: "use", use: direct })?.title).toBe(
			"kilo.git uses kilo.sessions/session",
		);
		expect(describePicked(map, { kind: "use", use: viaMirror })?.title).toBe(
			"kilo.workbench uses kilo.sessions/session (its mirror)",
		);
	});

	it("says nothing about a feed whose point is gone", () => {
		expect(
			describePicked(map, { kind: "feed", feed: { key: "x", from: "window:a", point: "none" } }),
		).toBeNull();
	});
});
