import { describe, expect, it } from "vitest";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import type { TeamMember } from "./swarm-team";
import { relativeTime } from "./swarm-time";
import { teamRuns } from "./team-timeline";

const MINUTE = 60_000;

const member = (chatId: string, patch: Partial<TeamMember> = {}): TeamMember => ({
	chatId,
	title: chatId,
	main: false,
	state: "done",
	needsYou: false,
	background: true,
	...patch,
});

const post = (id: string, from: string, timestamp: number): BoardMessage => ({
	id,
	from,
	to: "main",
	timestamp,
	type: "RESULT",
	body: id,
});

describe("teamRuns", () => {
	it("splits the work at long quiet stretches, each run with only the agents in it", () => {
		const runs = teamRuns(
			[
				member("root", { main: true, state: "idle", startedAt: 0 }),
				member("quick", { startedAt: 0, completedAt: 2 * MINUTE }),
				member("deep", { startedAt: MINUTE, completedAt: 6 * MINUTE }),
				member("architect", { startedAt: 20 * MINUTE, completedAt: 22 * MINUTE }),
			],
			[post("p1", "quick", 2 * MINUTE), post("p2", "main", 21 * MINUTE)],
			30 * MINUTE,
			"root",
		);

		expect(runs.map((run) => [run.from, run.to])).toEqual([
			[0, 6 * MINUTE],
			[20 * MINUTE, 22 * MINUTE],
		]);
		expect(runs[0]!.lanes.map((lane) => lane.chatId)).toEqual(["root", "quick", "deep"]);
		expect(runs[1]!.lanes.map((lane) => lane.chatId)).toEqual(["root", "architect"]);
		expect(runs[1]!.lanes[0]).toMatchObject({ title: "Main agent", start: 0, end: 0.5 });
		expect(runs[0]!.lanes[1]).toMatchObject({ start: 0, end: 2 / 6, ending: "known" });
		expect(runs.map((run) => run.postCount)).toEqual([1, 1]);
	});

	it("runs to now while someone works, and draws an unknown end to the last known moment", () => {
		const runs = teamRuns(
			[
				member("root", { main: true, state: "idle", startedAt: 0 }),
				member("busy", { state: "working", startedAt: 10 }),
				member("lost", { state: "unknown", startedAt: 0 }),
				member("undated", { state: "unknown" }),
			],
			[post("p1", "lost", 40)],
			100,
			"root",
		);
		expect(runs).toHaveLength(1);
		const lanes = Object.fromEntries(runs[0]!.lanes.map((lane) => [lane.chatId, lane]));
		expect(runs[0]).toMatchObject({ from: 0, to: 100, live: true });
		expect(lanes.busy).toMatchObject({ start: 0.1, end: 1, ending: "running" });
		expect(lanes.lost).toMatchObject({ end: 0.4, ending: "unknown" });
		expect(lanes.lost?.posts).toEqual([{ id: "p1", at: 0.4, type: "RESULT" }]);
		expect(lanes.undated).toBeUndefined();
	});

	it("is empty when nothing is dated", () => {
		expect(teamRuns([member("a")], [], 0, "root")).toEqual([]);
	});
});

describe("relativeTime", () => {
	it("says how long ago, coarsely", () => {
		const now = 10_000_000;
		expect(relativeTime(now - 10_000, now)).toBe("just now");
		expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
		expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
	});
});
