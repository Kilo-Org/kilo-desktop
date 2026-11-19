import { describe, expect, it } from "vitest";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import {
	boardMarkdown,
	EMPTY_FILTER,
	filterMessages,
	isFiltering,
	latestResults,
	openQuestions,
	threadsOf,
	typeCounts,
	unreadCount,
} from "./board-insights";

const post = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: Number(id.replace(/\D/g, "")),
	from: "ses_a",
	to: "main",
	type: "INFO",
	body: `body ${id}`,
	...patch,
});

describe("openQuestions", () => {
	it("is every ASK, HOLD or VETO nothing has replied to yet", () => {
		const messages = [
			post("m1", { type: "ASK" }),
			post("m2", { type: "ASK" }),
			post("m3", { type: "INFO", replyTo: "m2" }),
			post("m4", { type: "HOLD" }),
			post("m5", { type: "VETO", from: "ses_b" }),
			post("m6", { type: "RESULT", replyTo: "m5" }),
			post("m7", { type: "INFO" }),
		];
		expect([...openQuestions(messages)]).toEqual(["m1", "m4"]);
	});
});

describe("latestResults", () => {
	it("keeps each sender's newest RESULT, oldest sender first", () => {
		const messages = [
			post("m1", { type: "RESULT", from: "ses_b" }),
			post("m2", { type: "RESULT", from: "ses_a" }),
			post("m3", { type: "RESULT", from: "ses_b", body: "newer" }),
			post("m4", { type: "INFO", from: "ses_c" }),
			post("m5", { type: "RESULT", from: "user" }),
		];
		expect(latestResults(messages).map((message) => message.id)).toEqual(["m3", "m2"]);
	});
});

describe("filterMessages", () => {
	const messages = [
		post("m1", { from: "ses_a", to: "main", type: "RESULT", body: "Bridge exposes count_envs" }),
		post("m2", { from: "main", to: "ses_a", type: "ASK", body: "Which schema?" }),
		post("m3", { from: "ses_b", to: "ALL", type: "INFO", body: "UI is wired" }),
	];
	const ids = (list: readonly BoardMessage[]) => list.map((message) => message.id);

	it("passes everything without a filter", () => {
		expect(isFiltering(EMPTY_FILTER)).toBe(false);
		expect(ids(filterMessages(messages, EMPTY_FILTER))).toEqual(["m1", "m2", "m3"]);
	});

	it("filters by agent, from, to or both; the main agent is `main` however it is named", () => {
		const agents = new Set(["ses_a"]);
		expect(ids(filterMessages(messages, { ...EMPTY_FILTER, agents, direction: "both" }))).toEqual([
			"m1",
			"m2",
		]);
		expect(ids(filterMessages(messages, { ...EMPTY_FILTER, agents, direction: "from" }))).toEqual([
			"m1",
		]);
		expect(ids(filterMessages(messages, { ...EMPTY_FILTER, agents, direction: "to" }))).toEqual([
			"m2",
		]);
		expect(
			ids(
				filterMessages(messages, { ...EMPTY_FILTER, agents: new Set(["main"]), direction: "from" }),
			),
		).toEqual(["m2"]);
	});

	it("filters by type, open questions and text (any case), combined", () => {
		expect(
			ids(filterMessages(messages, { ...EMPTY_FILTER, types: new Set(["RESULT", "INFO"]) })),
		).toEqual(["m1", "m3"]);
		expect(ids(filterMessages(messages, { ...EMPTY_FILTER, openOnly: true }))).toEqual(["m2"]);
		expect(ids(filterMessages(messages, { ...EMPTY_FILTER, query: "SCHEMA" }))).toEqual(["m2"]);
		expect(
			ids(filterMessages(messages, { ...EMPTY_FILTER, query: "e", types: new Set(["INFO"]) })),
		).toEqual(["m3"]);
	});
});

describe("typeCounts", () => {
	it("counts each type", () => {
		const counts = typeCounts([
			post("m1", { type: "ASK" }),
			post("m2", { type: "ASK" }),
			post("m3"),
		]);
		expect(counts).toEqual({ INFO: 1, ASK: 2, RESULT: 0, HOLD: 0, VETO: 0 });
	});
});

describe("threadsOf", () => {
	it("nests replies (and replies to replies) under the post they answer, in time order", () => {
		const messages = [
			post("m1"),
			post("m2", { replyTo: "m1" }),
			post("m3"),
			post("m4", { replyTo: "m2" }),
			post("m5", { replyTo: "gone" }),
		];
		const threads = threadsOf(messages);
		expect(
			threads.map((thread) => [thread.root.id, thread.replies.map((reply) => reply.id)]),
		).toEqual([
			["m1", ["m2", "m4"]],
			["m3", []],
			["m5", []],
		]);
		expect(threads[2]?.orphan).toBe(true);
	});
});

describe("unreadCount", () => {
	it("counts agents' posts after the person last looked (all, if never), not their own", () => {
		const messages = [post("m1"), post("m5"), post("m9", { from: "user" })];
		expect(unreadCount(messages, 3)).toBe(1);
		expect(unreadCount(messages, undefined)).toBe(2);
	});
});

describe("boardMarkdown", () => {
	it("writes posts as markdown with who, to whom, type and time", () => {
		const text = boardMarkdown([post("m1", { type: "ASK", body: "Which schema?" })], (id) =>
			id === "main" ? "Main agent" : "Bridge RPC",
		);
		expect(text).toMatch(/^\*\*Bridge RPC → Main agent\*\* · ASK · .+\n\nWhich schema\?$/);
	});
});

describe("preview", () => {
	it("is the first line without markdown marks, keeping identifiers' underscores", async () => {
		const { preview } = await import("./board-posts");
		expect(preview("\n## **Bridge** exposes `count_envs` and _really_ works\nmore")).toBe(
			"Bridge exposes count_envs and really works",
		);
	});
});
