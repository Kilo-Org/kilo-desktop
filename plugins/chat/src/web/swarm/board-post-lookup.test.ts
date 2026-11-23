import { describe, expect, it, vi } from "vitest";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { BoardMessage, Swarm, SwarmBoard } from "@kilo-desktop/plugin-core/contracts";

import { findBoardPost, postNumberIn } from "./board-post-lookup";

const post = (id: string): BoardMessage => ({
	id,
	timestamp: 1,
	from: "main",
	to: "ALL",
	type: "INFO",
	body: id,
});

const board = (ids: string[], revision: number): SwarmBoard => ({
	ownerChatId: "root",
	revision,
	messages: ids.map(post),
	hasMore: false,
});

function swarmReading(read: () => Promise<SwarmBoard>) {
	const boardMethod = vi.fn(read);
	const swarm = { methods: { board: boardMethod } } as unknown as DomainObjectHandle<typeof Swarm>;
	return { swarm, boardMethod };
}

describe("postNumberIn", () => {
	it("counts back from the revision over the newest page", () => {
		const page = board(["a", "b", "c"], 12);
		expect(postNumberIn(page, "c")).toBe(12);
		expect(postNumberIn(page, "a")).toBe(10);
	});

	it("knows no number for a post off the page", () => {
		expect(postNumberIn(board(["a"], 4), "z")).toBeUndefined();
	});
});

describe("findBoardPost", () => {
	it("shares one read between the posts asking at once, and remembers a numbered post", async () => {
		const { swarm, boardMethod } = swarmReading(async () => board(["p1", "p2"], 5));

		const [first, second] = await Promise.all([
			findBoardPost(swarm, "worker", "p1"),
			findBoardPost(swarm, "worker", "p2"),
		]);

		expect(first).toEqual({ rootChatId: "root", number: 4 });
		expect(second).toEqual({ rootChatId: "root", number: 5 });
		expect(boardMethod).toHaveBeenCalledTimes(1);
		expect(boardMethod).toHaveBeenCalledWith({ chatId: "worker", limit: 50 });

		await findBoardPost(swarm, "worker", "p1");
		expect(boardMethod).toHaveBeenCalledTimes(1);
	});

	it("gives the root without a number when the post is older than the page", async () => {
		const { swarm } = swarmReading(async () => board(["n1"], 80));

		await expect(findBoardPost(swarm, "worker", "ancient")).resolves.toEqual({
			rootChatId: "root",
		});
	});

	it("gives nothing when the board can't be read, and reads again next time", async () => {
		const { swarm, boardMethod } = swarmReading(async () => {
			throw new Error("offline");
		});

		await expect(findBoardPost(swarm, "lost", "x1")).resolves.toBeNull();
		await expect(findBoardPost(swarm, "lost", "x1")).resolves.toBeNull();
		expect(boardMethod).toHaveBeenCalledTimes(2);
	});
});
