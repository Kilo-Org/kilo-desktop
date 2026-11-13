import { describe, expect, it } from "vitest";

import { buildDomainMap, deliveryOf, type DomainMapInput } from "./model";

const sessions = {
	id: "kilo.sessions/session",
	owner: "kilo.sessions",
	home: "main" as const,
	events: ["opened"],
};
const theme = {
	id: "kilo.shell/theme",
	owner: "kilo.shell",
	home: "renderer" as const,
	events: [],
};
const idle = { id: "kilo.git/status", owner: "kilo.git", home: "main" as const, events: [] };

const plugin = (id: string, main: boolean, web: boolean, requires: string[] = []) => ({
	id,
	name: id.replace("kilo.", ""),
	main,
	web,
	requires,
});

function input(overrides: Partial<DomainMapInput> = {}): DomainMapInput {
	return {
		plugins: [
			plugin("kilo.sessions", true, true),
			plugin("kilo.shell", true, true),
			plugin("kilo.git", true, true, ["kilo.sessions/session"]),
			plugin("kilo.workbench", false, true, [
				"kilo.sessions/session",
				"kilo.shell/theme",
				"kilo.shell/main",
			]),
			plugin("kilo.chat", false, true, ["kilo.shell/main"]),
		],
		domains: [sessions, theme, idle],
		points: [{ id: "kilo.shell/main", owner: "kilo.shell", process: "renderer" }],
		contributions: [{ pointId: "kilo.shell/main", pluginId: "kilo.workbench" }],
		isProvided: (id) => id !== idle.id,
		includeUnprovided: false,
		includePoints: true,
		...overrides,
	};
}

describe("buildDomainMap", () => {
	it("puts each provided domain object on its owner, in its home process", () => {
		const map = buildDomainMap(input());

		expect(map.domains.map((d) => [d.id, d.process])).toEqual([
			["kilo.sessions/session", "main"],
			["kilo.shell/theme", "window"],
		]);
	});

	it("keeps domain objects nobody provides only when asked", () => {
		expect(buildDomainMap(input({ includeUnprovided: true })).domains.map((d) => d.id)).toContain(
			idle.id,
		);
	});

	it("joins a domain object to each plugin that requires it, where that plugin runs", () => {
		const map = buildDomainMap(input());

		expect(map.uses.map((use) => [use.domainId, use.user, use.process, use.source])).toEqual([
			["kilo.sessions/session", "kilo.git", "main", "kilo.sessions/session"],
			["kilo.sessions/session", "kilo.workbench", "window", "mirror:kilo.sessions/session"],
			["kilo.shell/theme", "kilo.workbench", "window", "kilo.shell/theme"],
		]);
	});

	it("mirrors a main domain object into the window when a window-only plugin uses it", () => {
		const map = buildDomainMap(input());

		expect(map.mirrors).toEqual([{ key: "mirror:kilo.sessions/session", domainId: sessions.id }]);
		expect(map.plugins.map((p) => p.key)).toContain("window:kernel");
	});

	it("shows only plugins with something on them or joined to something", () => {
		const map = buildDomainMap(input({ includePoints: false }));

		expect(map.plugins.map((p) => p.key)).toEqual([
			"main:kilo.git",
			"main:kilo.sessions",
			"window:kernel",
			"window:kilo.shell",
			"window:kilo.workbench",
		]);
	});

	it("draws extension points on their owner, with a line from each contributor", () => {
		const map = buildDomainMap(input());

		expect(map.points).toEqual([
			{
				key: "window:point:kilo.shell/main",
				pointId: "kilo.shell/main",
				owner: "kilo.shell",
				process: "window",
			},
		]);
		expect(map.feeds).toEqual([
			{
				key: "feed:window:kilo.workbench>window:point:kilo.shell/main",
				from: "window:kilo.workbench",
				point: "window:point:kilo.shell/main",
			},
		]);
	});

	it("leaves the kernel's own points out, and points when asked", () => {
		const withKernel = buildDomainMap(
			input({
				points: [{ id: "kernel/command", owner: "kernel", process: "any" }],
				contributions: [{ pointId: "kernel/command", pluginId: "kilo.chat" }],
			}),
		);
		expect(withKernel.points).toEqual([]);
		expect(buildDomainMap(input({ includePoints: false })).feeds).toEqual([]);
	});
});

describe("deliveryOf", () => {
	const map = buildDomainMap(input());

	it("goes straight to main's users, and to the window's through the mirror", () => {
		const delivery = deliveryOf(map, sessions.id);

		expect(delivery.direct.map((use) => use.user)).toEqual(["kilo.git"]);
		expect(delivery.mirror?.domainId).toBe(sessions.id);
		expect(delivery.relayed.map((use) => use.user)).toEqual(["kilo.workbench"]);
	});

	it("has no mirror for a window domain object", () => {
		const delivery = deliveryOf(map, theme.id);

		expect(delivery.mirror).toBeNull();
		expect(delivery.direct.map((use) => use.user)).toEqual(["kilo.workbench"]);
	});
});
