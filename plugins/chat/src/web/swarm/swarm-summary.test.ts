import { describe, expect, it } from "vitest";

import type { BackgroundJob, BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import {
	firstLine,
	needsYouSummary,
	summarizeSwarm,
	workCounts,
	type BoardPage,
} from "./swarm-summary";
import type { TeamMember } from "./swarm-team";

const member = (chatId: string, patch: Partial<TeamMember> = {}): TeamMember => ({
	chatId,
	title: chatId,
	main: false,
	state: "done",
	needsYou: false,
	...patch,
});

const post = (id: string, timestamp: number, from = "ses_w1"): BoardMessage => ({
	id,
	timestamp,
	from,
	to: "main",
	type: "INFO",
	body: id,
});

const MAIN = member("ses_root", { main: true, state: "idle" });
const COLORS = new Map<string, string>();

function summary(
	team: readonly TeamMember[],
	{
		page = null,
		seenAt,
		jobs = [],
	}: { page?: BoardPage | null; seenAt?: number; jobs?: readonly BackgroundJob[] } = {},
) {
	return summarizeSwarm({ team, colors: COLORS, jobs, page, seenAt });
}

describe("summarizeSwarm", () => {
	it("counts the workers working and done, and who waits on the person", () => {
		const waiting = member("ses_w2", { state: "working", needsYou: true, attention: ["question"] });
		const result = summary([
			MAIN,
			member("ses_w1", { state: "working" }),
			waiting,
			member("ses_w3"),
		]);

		expect(result).toMatchObject({ working: 2, done: 1, live: true });
		expect(result.needsYou).toEqual([waiting]);
		expect(result.finishedAt).toBeUndefined();
	});

	it("leaves the main agent's own question to the composer", () => {
		const result = summary([{ ...MAIN, needsYou: true }, member("ses_w1")]);

		expect(result.needsYou).toEqual([]);
	});

	it("takes the post count from the revision and the latest from the page's end", () => {
		const result = summary([MAIN], {
			page: { revision: 7, messages: [post("m6", 6), post("m7", 7)] },
		});

		expect(result.posts).toBe(7);
		expect(result.latest?.id).toBe("m7");
	});

	it("counts agents' posts newer than the newest seen, never the person's", () => {
		const page = { revision: 3, messages: [post("m1", 1), post("m2", 2), post("m3", 3, "user")] };

		expect(summary([MAIN], { page, seenAt: 1 }).newCount).toBe(1);
		expect(summary([MAIN], { page }).newCount).toBe(2);
		expect(summary([MAIN]).newCount).toBe(0);
	});

	it("says when the last worker stopped once nobody works", () => {
		const team = [
			MAIN,
			member("ses_w1", { completedAt: 10 }),
			member("ses_w2", { completedAt: 30 }),
		];

		expect(summary(team).finishedAt).toBe(30);
		const running: BackgroundJob = { id: "j", type: "task", status: "running", startedAt: 1 };
		expect(summary(team, { jobs: [running] })).toMatchObject({ live: true });
		expect(summary(team, { jobs: [running] }).finishedAt).toBeUndefined();
	});
});

describe("shelf wording", () => {
	it("previews a post by its first non-empty line", () => {
		expect(firstLine("\n  Schema is ready  \nDetails follow")).toBe("Schema is ready");
		expect(firstLine("")).toBe("");
	});

	it("says what a worker waits on the person for", () => {
		expect(needsYouSummary({ attention: ["question"] })).toBe("has a question");
		expect(needsYouSummary({ attention: ["permission"] })).toBe("needs permission");
		expect(needsYouSummary({ attention: ["permission", "question"] })).toBe(
			"has a question and needs permission",
		);
		expect(needsYouSummary({})).toBe("needs you");
	});

	it("counts work, leaving out zeros", () => {
		expect(workCounts(3, 1)).toBe("3 working · 1 done");
		expect(workCounts(0, 2)).toBe("2 done");
		expect(workCounts(0, 0)).toBe("No agents yet");
	});
});
