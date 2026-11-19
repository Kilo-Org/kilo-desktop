import { describe, expect, it } from "vitest";

import type { BoardMessage, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";

import { EMPTY_FEED, mergeNewest, mergeOlder, type BoardFeed } from "./board-feed";

const message = (id: string): BoardMessage => ({
	id,
	timestamp: Number(id.slice(1)),
	from: "main",
	to: "ALL",
	type: "INFO",
	body: id,
});

const page = (ids: string[], patch: Partial<SwarmBoard> = {}): SwarmBoard => ({
	ownerChatId: "root",
	revision: 1,
	messages: ids.map(message),
	hasMore: false,
	...patch,
});

const ids = (feed: BoardFeed) => feed.messages.map((m) => m.id);

describe("board feed", () => {
	it("starts from the newest page with its cursor", () => {
		const feed = mergeNewest(EMPTY_FEED, page(["m2", "m3"], { hasMore: true, cursor: "m2" }));
		expect(ids(feed)).toEqual(["m2", "m3"]);
		expect(feed).toMatchObject({ revision: 1, hasMore: true, cursor: "m2", ownerChatId: "root" });
	});

	it("keeps older pages already read when the newest page is read again", () => {
		let feed = mergeNewest(EMPTY_FEED, page(["m3", "m4"], { hasMore: true, cursor: "m3" }));
		feed = mergeOlder(feed, page(["m1", "m2"], { hasMore: false }));
		feed = mergeNewest(feed, page(["m4", "m5"], { revision: 2, hasMore: true, cursor: "m4" }));

		expect(ids(feed)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
		expect(feed).toMatchObject({ revision: 2, hasMore: false });
	});

	it("starts over when the revision moved back to fewer messages (a reset elsewhere)", () => {
		let feed = mergeNewest(EMPTY_FEED, page(["m1", "m2"]));
		feed = mergeNewest(feed, page([], { revision: 2 }));
		expect(ids(feed)).toEqual([]);
	});

	it("starts over when the newest page doesn't overlap what it holds (a gap)", () => {
		let feed = mergeNewest(EMPTY_FEED, page(["m1", "m2"]));
		feed = mergeNewest(feed, page(["m8", "m9"], { revision: 9, hasMore: true, cursor: "m8" }));
		expect(ids(feed)).toEqual(["m8", "m9"]);
		expect(feed).toMatchObject({ hasMore: true, cursor: "m8" });
	});

	it("pages back from the oldest held message", () => {
		let feed = mergeNewest(EMPTY_FEED, page(["m5", "m6"], { hasMore: true, cursor: "m5" }));
		feed = mergeOlder(feed, page(["m3", "m4"], { hasMore: true, cursor: "m3" }));
		expect(ids(feed)).toEqual(["m3", "m4", "m5", "m6"]);
		expect(feed).toMatchObject({ hasMore: true, cursor: "m3" });
	});
});
