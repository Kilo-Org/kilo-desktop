import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelError, type DomainObjectProvider } from "@kilo-desktop/kernel";
import { createTestKernelPair, type TestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	Swarm,
	type BackgroundJob,
	type SwarmBoard,
	type SwarmTeam,
} from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../../plugin.json";
import { CHAT_DEFINITIONS } from "../../contracts";
import { EMPTY_ENTRY } from "../../test/kernel-harness";
import { useSwarmBoard } from "./use-swarm-board";

const hosts: TestKernelPair[] = [];
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
afterEach(async () => {
	cleanup();
	for (const host of hosts.splice(0)) {
		await host.renderer.deactivate();
		await host.main.stop();
	}
});

const board = (revision = 1, ids = ["newest"]): SwarmBoard => ({
	ownerChatId: "root",
	revision,
	messages: ids.map((id, timestamp) => ({
		id,
		timestamp,
		from: "worker",
		to: "main",
		type: "RESULT",
		body: id,
	})),
	hasMore: false,
});

async function mountBoard() {
	let swarm!: DomainObjectProvider<typeof Swarm>;
	const methods = {
		board: vi.fn(async (_input: { chatId: string; before?: string | undefined }) => board()),
		jobs: vi.fn(async (): Promise<BackgroundJob[]> => []),
		team: vi.fn(async (): Promise<SwarmTeam | null> => null),
		reset: vi.fn(async (_input: { chatId: string; revision: number }) => board(1, [])),
		cancelJob: vi.fn(async () => undefined),
		setEnabled: vi.fn(async () => undefined),
		usage: vi.fn(async () => null),
	};
	const host = await createTestKernelPair({
		main: [
			{
				manifest: coreManifest,
				definitions: CORE_DEFINITIONS,
				entry: {
					activate(sdk) {
						swarm = sdk.domainObjects.provide(Swarm, {
							initialState: { boardEvents: true, team: true, enabled: true },
							methods,
						});
					},
				},
			},
			{ manifest, definitions: CHAT_DEFINITIONS, entry: EMPTY_ENTRY },
		],
		renderer: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest, definitions: CHAT_DEFINITIONS, entry: EMPTY_ENTRY },
		],
	});
	hosts.push(host);
	const hook = renderHook(({ chatId }) => useSwarmBoard(chatId), {
		initialProps: { chatId: "root" },
		wrapper: ({ children }: { children: ReactNode }) => (
			<KernelProvider kernel={host.renderer} as={manifest.id}>
				{children}
			</KernelProvider>
		),
	});
	await vi.waitFor(() => expect(hook.result.current.loading).toBe(false));
	return {
		...hook,
		methods,
		announce: (cleared: number) =>
			swarm.emit("board-updated", { chatId: "root", revision: cleared, cleared }),
	};
}

describe("Swarm Board reads", () => {
	it("resets the reviewed revision, not a newer revision read while confirmation is open", async () => {
		const { result, methods } = await mountBoard();
		const reviewedRevision = result.current.feed.revision!;
		methods.board.mockResolvedValue(board(2, ["newest", "arrived-during-confirmation"]));
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.revision).toBe(2));
		methods.reset.mockImplementation(async ({ revision }) => {
			if (revision !== 2) throw new KernelError("CONFLICT", "The board changed.");
			return board(2, []);
		});

		await act(async () => {
			expect(await result.current.reset(reviewedRevision)).toBe("changed");
		});

		expect(methods.reset.mock.calls[0]?.[0]).toEqual({ chatId: "root", revision: 1 });
		expect(result.current.feed.messages.map((message) => message.id)).toEqual([
			"newest",
			"arrived-during-confirmation",
		]);
	});

	it("awaits older pages without reinserting a response from before a reset", async () => {
		const { result, methods } = await mountBoard();
		methods.board.mockResolvedValue({
			...board(1, ["page-end"]),
			cursor: "page-end",
			hasMore: true,
		});
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.hasMore).toBe(true));
		const older = deferred<SwarmBoard>();
		methods.board.mockImplementation(async ({ before }) => (before ? older.promise : board()));
		let loading: Promise<void> | undefined;
		act(() => {
			loading = result.current.loadOlder();
		});
		await vi.waitFor(() => expect(result.current.loadingOlder).toBe(true));
		await act(async () => {
			expect(await result.current.reset(1)).toBe("cleared");
		});
		expect(result.current.feed.messages).toEqual([]);

		await act(async () => {
			older.resolve(board(1, ["old-history"]));
			await loading;
		});
		await vi.waitFor(() => expect(result.current.loadingOlder).toBe(false));
		expect(result.current.feed.messages).toEqual([]);
		expect(loading).toBeInstanceOf(Promise);
	});

	it("keeps the last good roster and jobs independently when a partial refresh fails", async () => {
		const { result, methods } = await mountBoard();
		const roster: SwarmTeam = {
			truncated: false,
			members: [
				{
					chatId: "restored-worker",
					parentChatId: "root",
					title: "Restored worker",
					directory: "/projects/app",
					state: "busy",
					live: true,
					attention: [],
					startedAt: 1,
				},
			],
		};
		const jobs: BackgroundJob[] = [{ id: "job", type: "task", status: "running", startedAt: 1 }];
		methods.team.mockResolvedValue(roster);
		methods.jobs.mockResolvedValue(jobs);
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.team).toHaveLength(1));

		methods.team.mockRejectedValue(new KernelError("UNAVAILABLE", "Roster offline"));
		methods.jobs.mockResolvedValue([]);
		methods.board.mockResolvedValue(board(2, ["new-post"]));
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.revision).toBe(2));
		expect(result.current.team.map((member) => member.chatId)).toEqual(["restored-worker"]);
		expect(result.current.jobs).toEqual([]);
		expect(result.current.error).toContain("Roster offline");

		methods.team.mockResolvedValue({
			...roster,
			members: [{ ...roster.members[0]!, title: "Updated worker" }],
		});
		methods.jobs.mockRejectedValue(new KernelError("UNAVAILABLE", "Jobs offline"));
		methods.board.mockRejectedValue(new KernelError("UNAVAILABLE", "Board offline"));
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.team[0]?.title).toBe("Updated worker"));
		expect(result.current.feed.revision).toBe(2);
		expect(result.current.jobs).toEqual([]);
		expect(result.current.error).toContain("Jobs offline");
		expect(result.current.error).toContain("Board offline");

		methods.board.mockResolvedValue(board(3));
		methods.jobs.mockResolvedValue(jobs);
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.revision).toBe(3));
		expect(result.current.jobs).toEqual(jobs);
		expect(result.current.error).toBeNull();

		methods.jobs.mockRejectedValue(new KernelError("UNAVAILABLE", "Jobs offline again"));
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.error).toContain("Jobs offline again"));
		expect(result.current.jobs).toEqual(jobs);
	});

	it("shares an awaitable older-page read across callers without losing it to a live refresh", async () => {
		const { result, methods } = await mountBoard();
		methods.board.mockResolvedValue({
			...board(2, ["page-end"]),
			cursor: "page-end",
			hasMore: true,
		});
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.hasMore).toBe(true));
		const older = deferred<SwarmBoard>();
		methods.board.mockImplementation(async ({ before }) =>
			before ? older.promise : board(3, ["page-end", "live-post"]),
		);
		let loading: Promise<void> | undefined;
		act(() => {
			loading = result.current.loadOlder();
			expect(result.current.loadOlder()).toBe(loading);
			result.current.refresh();
		});
		await vi.waitFor(() => expect(result.current.feed.revision).toBe(3));
		expect(result.current.loadingOlder).toBe(true);

		await act(async () => {
			older.resolve(board(2, ["old-history"]));
			await loading;
		});
		expect(result.current.loadingOlder).toBe(false);
		expect(result.current.feed.revision).toBe(3);
		expect(result.current.feed.messages.map((message) => message.id)).toEqual([
			"old-history",
			"page-end",
			"live-post",
		]);
		expect(methods.board.mock.calls.filter(([input]) => input.before)).toHaveLength(1);
	});

	it("does not let an old chat's pending reset or older page replace a newly selected board", async () => {
		const { result, methods, rerender } = await mountBoard();
		methods.board.mockResolvedValue({
			...board(1, ["page-end"]),
			cursor: "page-end",
			hasMore: true,
		});
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.hasMore).toBe(true));
		const older = deferred<SwarmBoard>();
		const reset = deferred<SwarmBoard>();
		methods.board.mockImplementation(async ({ before }) =>
			before ? older.promise : { ...board(5, ["other-post"]), ownerChatId: "other" },
		);
		methods.reset.mockImplementation(() => reset.promise);
		let loading: Promise<void> | undefined;
		let clearing: ReturnType<typeof result.current.reset> | undefined;
		act(() => {
			loading = result.current.loadOlder();
			clearing = result.current.reset(1);
		});
		rerender({ chatId: "other" });
		await vi.waitFor(() => expect(result.current.feed.ownerChatId).toBe("other"));

		await act(async () => {
			older.resolve(board(1, ["old-history"]));
			reset.resolve(board(1, []));
			await loading;
			expect(await clearing).toBe("failed");
		});
		expect(result.current.feed.ownerChatId).toBe("other");
		expect(result.current.feed.messages.map((message) => message.id)).toEqual(["other-post"]);
		expect(result.current.loadingOlder).toBe(false);
	});

	it("invalidates a pending older read when another client announces a board reset", async () => {
		const { result, methods, announce } = await mountBoard();
		methods.board.mockResolvedValue({
			...board(2, ["page-end"]),
			cursor: "page-end",
			hasMore: true,
		});
		act(() => result.current.refresh());
		await vi.waitFor(() => expect(result.current.feed.hasMore).toBe(true));
		const older = deferred<SwarmBoard>();
		const newest = deferred<SwarmBoard>();
		methods.board.mockImplementation(async ({ before }) =>
			before ? older.promise : newest.promise,
		);
		let loading: Promise<void> | undefined;
		act(() => {
			loading = result.current.loadOlder();
		});
		await act(async () => {
			announce(2);
		});
		await act(async () => {
			older.resolve(board(2, ["cleared-history"]));
			await loading;
		});
		expect(result.current.feed.messages.map((message) => message.id)).toEqual(["page-end"]);
		await act(async () => {
			newest.resolve(board(2, []));
		});
		await vi.waitFor(() => expect(result.current.feed.messages).toEqual([]));
	});
});
