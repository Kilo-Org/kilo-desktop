import { afterEach, describe, expect, it, vi } from "vitest";

import { PrStatusScheduler } from "./pr-status-scheduler.js";

const targets = [
	{ id: "a", directory: "/a", active: true },
	{ id: "b", directory: "/b", active: false },
];

afterEach(() => {
	vi.useRealTimers();
});

describe("PrStatusScheduler", () => {
	it("refreshes every visible target on start, then only active targets on the short interval", async () => {
		vi.useFakeTimers();
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async (directory) => {
				loaded.push(directory);
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		scheduler.start();
		await vi.waitFor(() => expect(loaded).toEqual(["/a", "/b"]));

		loaded.length = 0;
		await vi.advanceTimersByTimeAsync(15_000);
		expect(loaded).toEqual(["/a"]);
		scheduler.stop();
	});

	it("caps a full sync at three in-flight refreshes", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let inFlight = 0;
		let max = 0;
		const directories = ["/a", "/b", "/c", "/d", "/e"];
		const scheduler = new PrStatusScheduler({
			getTargets: () =>
				directories.map((directory) => ({ id: directory, directory, active: true })),
			load: async () => {
				inFlight += 1;
				max = Math.max(max, inFlight);
				await gate;
				inFlight -= 1;
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		scheduler.start();
		await vi.waitFor(() => expect(inFlight).toBe(3));
		expect(max).toBe(3);
		release();
		scheduler.stop();
	});

	it("skips a hidden refresh and catches up when the document becomes visible", async () => {
		let visible = false;
		let onVisible: () => void = () => undefined;
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async (directory) => {
				loaded.push(directory);
			},
			isVisible: () => visible,
			subscribeVisibility: (listener) => {
				onVisible = listener;
				return () => undefined;
			},
		});

		scheduler.start();
		await Promise.resolve();
		expect(loaded).toEqual([]);

		visible = true;
		onVisible();
		await vi.waitFor(() => expect(loaded).toEqual(["/a", "/b"]));
		scheduler.stop();
	});

	it("refreshes a target only when it is new or its directory changes", async () => {
		let current = targets;
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => current,
			load: async (directory) => {
				loaded.push(directory);
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		await scheduler.syncTargets(current);
		expect(loaded).toEqual(["/a", "/b"]);

		await scheduler.syncTargets(current);
		expect(loaded).toEqual(["/a", "/b"]);

		current = [{ id: "a", directory: "/moved", active: true }];
		await scheduler.syncTargets(current);
		expect(loaded).toEqual(["/a", "/b", "/moved"]);
	});

	it("loads only a target that first appears after an empty target list", async () => {
		let current: typeof targets = targets;
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => current,
			load: async (directory) => {
				loaded.push(directory);
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		await scheduler.syncTargets(current);
		current = [];
		await scheduler.syncTargets(current);
		current = [...targets, { id: "c", directory: "/c", active: false }];
		await scheduler.syncTargets(current);

		expect(loaded).toEqual(["/a", "/b", "/c"]);
	});

	it("quarantines a failed refresh unless the caller forces it", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-22T00:00:00Z"));
		let failures = 0;
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async () => {
				failures += 1;
				throw new Error("offline");
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
			now: () => Date.now(),
		});

		await scheduler.refresh("/a");
		await scheduler.refresh("/a");
		expect(failures).toBe(1);

		await scheduler.refresh("/a", true);
		expect(failures).toBe(2);
		scheduler.stop();
	});

	it("uses the document visibility listener when none is injected", async () => {
		const listeners = new Map<string, () => void>();
		const documentStub = {
			visibilityState: "visible",
			addEventListener: (type: string, listener: () => void) => {
				listeners.set(type, listener);
			},
			removeEventListener: (type: string) => {
				listeners.delete(type);
			},
		};
		vi.stubGlobal("document", documentStub);
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async (directory) => {
				loaded.push(directory);
			},
		});

		scheduler.start();
		await vi.waitFor(() => expect(loaded).toEqual(["/a", "/b"]));
		documentStub.visibilityState = "hidden";
		listeners.get("visibilitychange")?.();
		await Promise.resolve();
		expect(loaded).toEqual(["/a", "/b"]);
		scheduler.stop();
		expect(listeners.has("visibilitychange")).toBe(false);
		vi.unstubAllGlobals();
	});

	it("does not quarantine a capability failure and ignores an unknown directory", async () => {
		let calls = 0;
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async () => {
				calls += 1;
				return "unavailable";
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		await scheduler.refresh("/missing");
		await scheduler.refresh("/a");
		await scheduler.refresh("/a");
		expect(calls).toBe(2);
	});

	it("does not schedule follow-ups when a refresh should not settle", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async () => {
				calls += 1;
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		scheduler.consumeRefreshRequests({ "/a": { id: 1, settle: false } });
		await vi.waitFor(() => expect(calls).toBe(1));
		await vi.advanceTimersByTimeAsync(8_000);
		expect(calls).toBe(1);
		scheduler.stop();
	});

	it("settles a forced refresh once, then again after the follow-up delays", async () => {
		vi.useFakeTimers();
		const loaded: boolean[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async () => {
				loaded.push(true);
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		scheduler.consumeRefreshRequests({ "/a": { id: 1, settle: true } });
		await vi.waitFor(() => expect(loaded).toEqual([true]));

		await vi.advanceTimersByTimeAsync(2_000);
		expect(loaded).toEqual([true, true]);
		await vi.advanceTimersByTimeAsync(6_000);
		expect(loaded).toEqual([true, true, true]);

		scheduler.consumeRefreshRequests({ "/a": { id: 1, settle: true } });
		await Promise.resolve();
		expect(loaded).toEqual([true, true, true]);
		scheduler.stop();
	});

	it("joins an in-flight load, and a forced refresh reloads once it finishes", async () => {
		const releases: (() => void)[] = [];
		let calls = 0;
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async () => {
				calls += 1;
				await new Promise<void>((resolve) => {
					releases.push(resolve);
				});
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		const first = scheduler.refresh("/a");
		void scheduler.refresh("/a");
		void scheduler.refresh("/a", true);
		void scheduler.refresh("/a", true);
		await vi.waitFor(() => expect(calls).toBe(1));
		releases.shift()?.();
		await first;
		await vi.waitFor(() => expect(calls).toBe(2));
		releases.shift()?.();
		await Promise.resolve();
		expect(calls).toBe(2);
	});

	it("settles every queued load after stop", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const directories = ["/a", "/b", "/c", "/d", "/e"];
		let calls = 0;
		const scheduler = new PrStatusScheduler({
			getTargets: () =>
				directories.map((directory) => ({ id: directory, directory, active: true })),
			load: async () => {
				calls += 1;
				await gate;
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		const sync = scheduler.refreshAll();
		await vi.waitFor(() => expect(calls).toBe(3));
		scheduler.stop();
		release();
		await sync;
		expect(calls).toBe(3);
	});

	it("shares the concurrency limit between full syncs and explicit refreshes", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let inFlight = 0;
		let max = 0;
		const directories = ["/a", "/b", "/c", "/d", "/e"];
		const scheduler = new PrStatusScheduler({
			getTargets: () =>
				directories.map((directory) => ({ id: directory, directory, active: true })),
			load: async () => {
				inFlight += 1;
				max = Math.max(max, inFlight);
				await gate;
				inFlight -= 1;
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		void scheduler.refreshAll();
		scheduler.consumeRefreshRequests({ "/e": { id: 1, settle: false } });
		void scheduler.refresh("/d", true);
		await vi.waitFor(() => expect(inFlight).toBe(3));
		expect(max).toBe(3);
		release();
		scheduler.stop();
	});

	it("does not reload start-time targets when they are synced afterwards", async () => {
		const loaded: string[] = [];
		const scheduler = new PrStatusScheduler({
			getTargets: () => targets,
			load: async (directory) => {
				loaded.push(directory);
			},
			isVisible: () => true,
			subscribeVisibility: () => () => undefined,
		});

		scheduler.start();
		await scheduler.syncTargets(targets);
		await vi.waitFor(() => expect(loaded).toEqual(["/a", "/b"]));
		scheduler.stop();
	});

	describe("batched loads", () => {
		const three = [
			{ id: "a", directory: "/a", active: true },
			{ id: "b", directory: "/b", active: false },
			{ id: "c", directory: "/c", active: false },
		];

		function batchedScheduler(
			loadMany: (directories: readonly string[]) => Promise<ReadonlyMap<string, void>>,
		) {
			const loaded: string[] = [];
			const batches: string[][] = [];
			const scheduler = new PrStatusScheduler({
				getTargets: () => three,
				load: async (directory) => {
					loaded.push(directory);
				},
				loadMany: async (directories) => {
					batches.push([...directories]);
					return loadMany(directories);
				},
				isVisible: () => true,
				subscribeVisibility: () => () => undefined,
			});
			return { scheduler, loaded, batches };
		}

		it("syncs every target in one batch and loads only the unanswered ones individually", async () => {
			const { scheduler, loaded, batches } = batchedScheduler(
				async () =>
					new Map([
						["/a", undefined],
						["/c", undefined],
					]),
			);

			await scheduler.refreshAll();

			expect(batches).toEqual([["/a", "/b", "/c"]]);
			expect(loaded).toEqual(["/b"]);
		});

		it("falls back to individual loads when the batch fails", async () => {
			const { scheduler, loaded } = batchedScheduler(async () => {
				throw new Error("gh failed");
			});

			await scheduler.syncTargets(three);

			expect(loaded).toEqual(["/a", "/b", "/c"]);
		});

		it("keeps its known targets across a transient empty target list", async () => {
			const { scheduler, loaded, batches } = batchedScheduler(
				async (directories) => new Map(directories.map((directory) => [directory, undefined])),
			);

			await scheduler.syncTargets(three);
			await scheduler.syncTargets([]);
			await scheduler.syncTargets(three);

			expect(batches).toEqual([["/a", "/b", "/c"]]);
			expect(loaded).toEqual([]);
		});

		it("treats batched directories as in flight until the batch settles", async () => {
			let answer: (answers: ReadonlyMap<string, void>) => void = () => undefined;
			const { scheduler, loaded, batches } = batchedScheduler(
				() =>
					new Promise((resolve) => {
						answer = resolve;
					}),
			);

			const sync = scheduler.refreshAll();
			await vi.waitFor(() => expect(batches).toHaveLength(1));
			const joined = scheduler.refresh("/a");
			answer(new Map(three.map(({ directory }) => [directory, undefined])));
			await Promise.all([sync, joined]);

			expect(loaded).toEqual([]);
		});

		it("leaves backed-off directories out and loads a lone eligible one individually", async () => {
			const loaded: string[] = [];
			const batches: string[][] = [];
			const scheduler = new PrStatusScheduler({
				getTargets: () => three,
				load: async (directory) => {
					loaded.push(directory);
					if (directory !== "/a") throw new Error("offline");
				},
				loadMany: async (directories) => {
					batches.push([...directories]);
					return new Map();
				},
				isVisible: () => true,
				subscribeVisibility: () => () => undefined,
				now: () => 1_000_000,
			});

			await scheduler.refreshAll();
			loaded.length = 0;
			await scheduler.refreshAll();

			expect(batches).toEqual([["/a", "/b", "/c"]]);
			expect(loaded).toEqual(["/a"]);
		});
	});
});
