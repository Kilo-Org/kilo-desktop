import { describe, expect, it } from "vitest";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import { sequenceArrows, threadIds } from "./team-sequence";
import type { Timeline } from "./team-timeline";

const post = (
	id: string,
	from: string,
	to: string,
	patch: Partial<BoardMessage> = {},
): BoardMessage => ({
	id,
	from,
	to,
	timestamp: Number(id.slice(1)) * 10,
	type: "INFO",
	body: id,
	...patch,
});

const lane = (chatId: string) => ({
	chatId,
	title: chatId,
	state: "done" as const,
	start: 0,
	end: 1,
	ending: "known" as const,
	posts: [],
});

const timeline: Timeline = {
	from: 0,
	to: 100,
	lanes: [lane("root"), lane("a"), lane("b")],
	postCount: 0,
	live: false,
};

describe("sequenceArrows", () => {
	it("draws each post from its sender's lane to its recipient's, the root as `main`", () => {
		const arrows = sequenceArrows(
			timeline,
			[
				post("m1", "a", "main", { type: "RESULT" }),
				post("m2", "main", "b", { type: "ASK" }),
				post("m3", "b", "ALL"),
				post("m4", "a", "ses_gone", { replyTo: "m2" }),
				post("m5", "user", "a"),
				post("m6", "a", "a"),
				post("m99", "a", "main"),
			],
			"root",
		);
		expect(arrows.map(({ id, from, to, at }) => [id, from, to, at])).toEqual([
			["m1", 1, 0, 0.1],
			["m2", 0, 2, 0.2],
			["m3", 2, "all", 0.3],
			["m4", 1, null, 0.4],
			["m6", 1, null, 0.6],
		]);
		expect(arrows[3]?.replyTo).toBe("m2");
	});
});

describe("threadIds", () => {
	it("finds a post's whole thread, from any post in it", () => {
		const messages = [
			post("m1", "a", "main"),
			post("m2", "main", "a", { replyTo: "m1" }),
			post("m3", "a", "main", { replyTo: "m2" }),
			post("m4", "b", "main"),
		];
		expect([...threadIds(messages, "m3")].toSorted()).toEqual(["m1", "m2", "m3"]);
		expect([...threadIds(messages, "m4")]).toEqual(["m4"]);
	});
});
