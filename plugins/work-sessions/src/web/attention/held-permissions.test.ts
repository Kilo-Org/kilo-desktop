import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import { createHeldPermissions, withoutHeldPermissions } from "./held-permissions";
import type { ChatsById } from "./session-chats";

const REVEAL_AFTER_MS = 3_000;

function chat(id: string, pendingPermissionIds: string[]): ChatSummary {
	return {
		id,
		title: id,
		directory: null,
		parentId: null,
		workspaceId: null,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: 1,
		updatedAt: 2,
		activity: { status: "busy", pendingPermissionIds, pendingQuestionIds: [] },
	};
}

const byId = (...chats: ChatSummary[]): ChatsById =>
	Object.fromEntries(chats.map((summary) => [summary.id, summary]));

const pendingOf = (chats: ChatsById, held: ReturnType<typeof createHeldPermissions>) =>
	Object.fromEntries(
		Object.values(withoutHeldPermissions(chats, held.shown())).map((summary) => [
			summary.id,
			summary.activity.pendingPermissionIds,
		]),
	);

describe("held permissions", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("shows a request no plugin answers as soon as that is known", async () => {
		const held = createHeldPermissions({
			answeredForPerson: async () => false,
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const chats = byId(chat("c1", ["p1"]));
		held.sync(chats);
		expect(pendingOf(chats, held)).toEqual({ c1: [] });

		await vi.advanceTimersByTimeAsync(0);
		expect(pendingOf(chats, held)).toEqual({ c1: ["p1"] });
	});

	it("shows a request at once when the answer is known at once", () => {
		const held = createHeldPermissions({
			answeredForPerson: () => false,
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const chats = byId(chat("c1", ["p1"]));
		held.sync(chats);
		expect(pendingOf(chats, held)).toEqual({ c1: ["p1"] });
	});

	it("holds a request a plugin answers until the reveal timeout, then shows it", async () => {
		const held = createHeldPermissions({
			answeredForPerson: async (_chatId, permissionId) => permissionId === "auto",
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const listener = vi.fn();
		held.subscribe(listener);
		const chats = byId(chat("c1", ["auto", "manual"]));
		held.sync(chats);
		await vi.advanceTimersByTimeAsync(0);
		expect(pendingOf(chats, held)).toEqual({ c1: ["manual"] });

		await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS);
		expect(pendingOf(chats, held)).toEqual({ c1: ["auto", "manual"] });
		expect(listener).toHaveBeenCalled();
	});

	it("shows a request when asking about it fails", async () => {
		const held = createHeldPermissions({
			answeredForPerson: async () => {
				throw new Error("gone");
			},
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const chats = byId(chat("c1", ["p1"]));
		held.sync(chats);
		await vi.advanceTimersByTimeAsync(0);
		expect(pendingOf(chats, held)).toEqual({ c1: ["p1"] });
	});

	it("forgets a request once it is no longer pending", async () => {
		const answeredForPerson = vi.fn(async () => true);
		const held = createHeldPermissions({ answeredForPerson, revealAfterMs: REVEAL_AFTER_MS });
		held.sync(byId(chat("c1", ["p1"])));
		await vi.advanceTimersByTimeAsync(0);
		held.sync(byId(chat("c1", [])));
		await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS);
		expect(held.shown().size).toBe(0);

		const again = byId(chat("c1", ["p1"]));
		held.sync(again);
		expect(answeredForPerson).toHaveBeenCalledTimes(2);
		expect(pendingOf(again, held)).toEqual({ c1: [] });
	});

	it("keeps chats unchanged when nothing is held", () => {
		const held = createHeldPermissions({
			answeredForPerson: () => false,
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const chats = byId(chat("c1", ["p1"]), chat("c2", []));
		held.sync(chats);
		expect(withoutHeldPermissions(chats, held.shown())).toBe(chats);
	});

	it("stops its timers when disposed", async () => {
		const held = createHeldPermissions({
			answeredForPerson: async () => true,
			revealAfterMs: REVEAL_AFTER_MS,
		});
		const listener = vi.fn();
		held.subscribe(listener);
		held.sync(byId(chat("c1", ["p1"])));
		held.dispose();
		await vi.advanceTimersByTimeAsync(REVEAL_AFTER_MS);
		expect(listener).not.toHaveBeenCalled();
	});
});
