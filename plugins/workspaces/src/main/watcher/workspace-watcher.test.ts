import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { watcherIgnorePatterns } from "./default-excludes";
import { createTestWatcher } from "./test/test-helpers";

const PROJECT = "/work/project";

function change(path: string, type: "created" | "updated" | "deleted") {
	return { path, type };
}

describe("WorkspaceWatcher", () => {
	describe("event delivery", () => {
		it("delivers file change events to a subscriber of a watched directory", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: Array<Array<{ path: string; type: string }>> = [];
			watcher.watchDirectory(PROJECT);
			const unsubscribe = watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([
				change(`${PROJECT}/src/main.py`, "created"),
				change(`${PROJECT}/src/main.py`, "updated"),
			]);

			expect(received).toEqual([
				[
					{ path: `${PROJECT}/src/main.py`, type: "create" },
					{ path: `${PROJECT}/src/main.py`, type: "update" },
				],
			]);
			unsubscribe();
		});

		it("emits the unfiltered batch on the event bus", async () => {
			const emit = vi.fn();
			const { watcher, parcel, tick } = createTestWatcher({ emit });
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, {}, () => {});
			await tick();

			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "deleted")]);

			expect(emit).toHaveBeenCalledWith({
				root: PROJECT,
				changes: [{ path: `${PROJECT}/a.txt`, type: "delete" }],
			});
		});

		it("delivers events to several subscribers of the same directory", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const first: unknown[] = [];
			const second: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			const unsubFirst = watcher.subscribe(PROJECT, {}, (changes) => first.push(changes));
			watcher.subscribe(PROJECT, {}, (changes) => second.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);

			expect(first).toHaveLength(1);
			expect(second).toHaveLength(1);
			unsubFirst();
		});

		it("stops delivering after the subscriber unsubscribes", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			const unsubscribe = watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);
			unsubscribe();
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/b.txt`, "created")]);

			expect(received).toHaveLength(1);
		});

		it("rejects subscriptions for directories that are not registered workspaces", () => {
			const { watcher } = createTestWatcher();

			expect(() => watcher.subscribe("/nowhere", {}, () => {})).toThrow(/not a registered/);
		});
	});

	describe("subscriber filtering", () => {
		it("only delivers events matching include globs", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, { includes: ["**/*.py"] }, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([
				change(`${PROJECT}/src/main.py`, "created"),
				change(`${PROJECT}/src/main.ts`, "created"),
			]);

			expect(received).toEqual([[{ path: `${PROJECT}/src/main.py`, type: "create" }]]);
		});

		it("suppresses events matching exclude globs", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, { excludes: ["**/test/**"] }, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([
				change(`${PROJECT}/test/a.py`, "created"),
				change(`${PROJECT}/src/a.py`, "created"),
			]);

			expect(received).toEqual([[{ path: `${PROJECT}/src/a.py`, type: "create" }]]);
		});

		it("only delivers the requested event types", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, { types: ["create"] }, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([
				change(`${PROJECT}/a.py`, "created"),
				change(`${PROJECT}/a.py`, "updated"),
				change(`${PROJECT}/a.py`, "deleted"),
			]);

			expect(received).toEqual([[{ path: `${PROJECT}/a.py`, type: "create" }]]);
		});
	});

	describe("path normalization", () => {
		describe("normalizeWindowsRootPath gate", () => {
			const originalPlatform = process.platform;

			afterEach(() => {
				Object.defineProperty(process, "platform", { value: originalPlatform });
			});

			it("leaves a windows drive root unchanged when not on win32", async () => {
				Object.defineProperty(process, "platform", { value: "darwin" });
				const { watcher, parcel, tick } = createTestWatcher();
				const received: Array<Array<{ path: string }>> = [];
				watcher.watchDirectory("c:\\work");
				watcher.subscribe("c:\\work", {}, (changes) => received.push(changes));
				await tick();

				parcel.subscriptions[0]!.emit([{ path: "c:\\\\", type: "created" }]);

				expect(received).toEqual([[{ path: "c:\\\\", type: "create" }]]);
			});

			it("normalizes a windows drive root duplicate backslash on win32", async () => {
				Object.defineProperty(process, "platform", { value: "win32" });
				const { watcher, parcel, tick } = createTestWatcher();
				const received: Array<Array<{ path: string }>> = [];
				watcher.watchDirectory("c:\\work");
				watcher.subscribe("c:\\work", {}, (changes) => received.push(changes));
				await tick();

				parcel.subscriptions[0]!.emit([{ path: "c:\\\\", type: "created" }]);

				expect(received).toEqual([[{ path: "c:\\", type: "create" }]]);
			});
		});

		it("remaps event paths onto the registered prefix when the directory is a symlink", async () => {
			const { watcher, parcel, tick } = createTestWatcher({
				realpath: (path) => (path === "/link/project" ? "/real/project" : path),
			});
			const received: Array<Array<{ path: string }>> = [];
			watcher.watchDirectory("/link/project");
			watcher.subscribe("/link/project", {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.emit([change("/real/project/src/a.py", "created")]);

			expect(received).toEqual([[{ path: "/link/project/src/a.py", type: "create" }]]);
		});

		it("treats realpath as identity and proceeds to active when realpath rejects", async () => {
			const { watcher, parcel, tick } = createTestWatcher({
				realpath: () => Promise.reject(new Error("EACCES: permission denied")),
			});
			const received: Array<Array<{ path: string }>> = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("active");
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/src/a.py`, "created")]);
			expect(received).toEqual([[{ path: `${PROJECT}/src/a.py`, type: "create" }]]);
		});
	});

	describe("watch lifecycle", () => {
		it("reports starting until the native subscription resolves", async () => {
			let releaseSubscribe!: () => void;
			const { watcher, parcel, tick } = createTestWatcher({
				subscribeFn: (dir, onEvents, opts) =>
					new Promise<{ unsubscribe(): Promise<void> }>((resolve) => {
						releaseSubscribe = () => resolve(parcel.subscribe(dir, onEvents, opts));
					}),
			});

			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories).toEqual([
				{ path: PROJECT, state: "starting", subscriberCount: 0 },
			]);

			releaseSubscribe();
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("active");
			});
		});

		it("unwatchDirectory tears the native watcher down once no subscribers remain", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			const unsubscribe = watcher.subscribe(PROJECT, {}, () => {});
			await tick();

			unsubscribe();
			// The registered workspace still holds the native watcher.
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(false);

			watcher.unwatchDirectory(PROJECT);
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(true);
			expect(watcher.status().directories).toHaveLength(0);
		});

		it("keeps the native watcher alive while subscribers remain after unwatch", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			const unsubscribe = watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			watcher.unwatchDirectory(PROJECT);
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);

			expect(parcel.subscriptions[0]!.unsubscribed).toBe(false);
			expect(received).toHaveLength(1);
			unsubscribe();
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(true);
		});

		it("reports directory state and subscriber counts", async () => {
			const { watcher, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			watcher.watchDirectory("/work/other");
			const unsubscribe = watcher.subscribe(PROJECT, {}, () => {});
			await tick();

			const directories = watcher
				.status()
				.directories.filter((directory) => directory.path === PROJECT);
			expect(directories).toEqual([{ path: PROJECT, state: "active", subscriberCount: 1 }]);
			unsubscribe();
		});
	});

	describe("retry on failure", () => {
		it("moves to retrying and stops events when the subscription errors", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.fail(new Error("watched path was deleted"));
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);

			expect(watcher.status().directories[0]?.state).toBe("retrying");
			expect(received).toHaveLength(0);
		});

		it("recovers to active when a retry succeeds", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.fail(new Error("transient"));

			// Chained retry timers exceed a fixed tick budget at Windows' ~15.6ms
			// timer granularity, so poll instead of sleeping.
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("active");
			});
			expect(parcel.subscribeAttempts).toEqual([PROJECT, PROJECT]);
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/a.txt`, "created")]);
			expect(received).toHaveLength(1);
		});

		it("gives up to failed after exhausting retries", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5, maxRetries: 2 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.failNextSubscribes(PROJECT, 10, new Error("still gone"));
			parcel.subscriptions[0]!.fail(new Error("watched path was deleted"));

			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("failed");
			});
			// Initial attempt + 2 retries, then retrying stops.
			expect(parcel.subscribeAttempts).toHaveLength(3);
			await tick(20);
			expect(parcel.subscribeAttempts).toHaveLength(3);
		});

		it("fails immediately without retrying on ENOSPC (parcel realistic message)", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			parcel.failNextSubscribes(
				PROJECT,
				1,
				new Error(`inotify_add_watch on '${PROJECT}' failed: No space left on device`),
			);
			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("failed");
			expect(parcel.subscribeAttempts).toHaveLength(1);
			await tick(20);
			expect(parcel.subscribeAttempts).toHaveLength(1);
		});

		it("fails immediately without retrying on EMFILE (parcel realistic message)", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			parcel.failNextSubscribes(
				PROJECT,
				1,
				new Error("Unable to initialize inotify: Too many open files"),
			);
			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("failed");
			expect(parcel.subscribeAttempts).toHaveLength(1);
			await tick(20);
			expect(parcel.subscribeAttempts).toHaveLength(1);
		});

		it("fails immediately without retrying when error carries .code EMFILE (belt-and-braces)", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			parcel.failNextSubscribes(
				PROJECT,
				1,
				Object.assign(new Error("too many open files"), { code: "EMFILE" }),
			);
			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("failed");
			expect(parcel.subscribeAttempts).toHaveLength(1);
			await tick(20);
			expect(parcel.subscribeAttempts).toHaveLength(1);
		});

		it("resets a failed directory when watchDirectory is requested again", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5, maxRetries: 1 });
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.failNextSubscribes(PROJECT, 1, new Error("gone"));
			parcel.subscriptions[0]!.fail(new Error("watched path was deleted"));
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("failed");
			});

			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("active");
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/a.txt`, "created")]);
			watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/b.txt`, "created")]);
			expect(received).toHaveLength(1);
		});

		it("stops timers and callbacks after dispose", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			const received: unknown[] = [];
			watcher.watchDirectory(PROJECT);
			watcher.subscribe(PROJECT, {}, (changes) => received.push(changes));
			await tick();

			parcel.subscriptions[0]!.fail(new Error("transient"));
			await watcher.dispose();
			await tick(30);

			expect(parcel.subscribeAttempts).toHaveLength(1);
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/a.txt`, "created")]);
			expect(received).toHaveLength(0);
			expect(watcher.status().directories).toHaveLength(0);
		});
	});

	describe("dispose", () => {
		it("does not resolve until all parcel unsubscribes complete", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			watcher.watchDirectory("/work/other");
			await tick();

			parcel.holdUnsubscribes();
			let disposed = false;
			const disposePromise = watcher.dispose().then(() => {
				disposed = true;
			});
			await tick();
			expect(disposed).toBe(false);
			for (const subscription of parcel.subscriptions) {
				expect(subscription.unsubscribed).toBe(true);
			}

			parcel.releaseUnsubscribes();
			await disposePromise;
			expect(disposed).toBe(true);
		});

		it("waits for an in-flight subscribe to settle before resolving", async () => {
			const releaseGates: Array<() => void> = [];
			const { watcher, parcel, tick } = createTestWatcher({
				subscribeFn: (dir, onEvents, opts) =>
					new Promise<{ unsubscribe(): Promise<void> }>((resolve) => {
						releaseGates.push(() => {
							resolve(parcel.subscribe(dir, onEvents, opts));
						});
					}),
			});
			watcher.watchDirectory(PROJECT);
			await tick();
			expect(releaseGates).toHaveLength(1);

			let disposed = false;
			const disposePromise = watcher.dispose().then(() => {
				disposed = true;
			});
			await tick();
			expect(disposed).toBe(false);
			expect(parcel.subscribeAttempts).toHaveLength(0);

			releaseGates[0]!();
			await disposePromise;
			expect(parcel.subscribeAttempts).toEqual([PROJECT]);
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(true);
		});
	});

	describe("reconcileDirectories", () => {
		it("watches added folders and unwatches removed ones", async () => {
			const OLD = "/work/old";
			const NEW = "/work/new";
			const { watcher, parcel, tick } = createTestWatcher();
			watcher.watchDirectory(OLD);
			watcher.watchDirectory(PROJECT);
			await tick();

			watcher.reconcileDirectories(new Set([PROJECT, NEW]));
			await tick();

			expect(
				watcher
					.status()
					.directories.map(({ path }) => path)
					.sort(),
			).toEqual([PROJECT, NEW].sort());
			expect(parcel.subscriptions.find(({ directory }) => directory === OLD)!.unsubscribed).toBe(
				true,
			);
			expect(parcel.subscribeAttempts).toEqual([OLD, PROJECT, NEW]);
		});

		it("keeps retained folders subscribed without resubscribing", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			await tick();

			watcher.reconcileDirectories(new Set([PROJECT]));
			await tick();

			expect(parcel.subscribeAttempts).toEqual([PROJECT]);
			expect(parcel.subscriptions).toHaveLength(1);
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(false);
			expect(watcher.status().directories[0]?.state).toBe("active");
		});

		it("restarts the retry loop for a failed folder that remains in the union", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5, maxRetries: 1 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.failNextSubscribes(PROJECT, 1, new Error("gone"));
			parcel.subscriptions[0]!.fail(new Error("watched path was deleted"));
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("failed");
			});

			watcher.reconcileDirectories(new Set([PROJECT]));
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("active");
			// Initial attempt, the exhausted retry, and the reconcile restart.
			expect(parcel.subscribeAttempts).toHaveLength(3);
		});

		it("leaves a retrying folder undisturbed (in-flight retry loop owns resubscription)", async () => {
			const { watcher, parcel, tick } = createTestWatcher({ retryDelayMs: 5 });
			watcher.watchDirectory(PROJECT);
			await tick();

			// Drive into retrying; no queued failures so the retry will succeed.
			parcel.subscriptions[0]!.fail(new Error("transient"));
			expect(watcher.status().directories[0]?.state).toBe("retrying");
			expect(parcel.subscribeAttempts).toHaveLength(1);

			// Reconcile while the retry timer is pending — must be a no-op.
			watcher.reconcileDirectories(new Set([PROJECT]));
			// Still retrying; no additional subscribe attempt.
			expect(watcher.status().directories[0]?.state).toBe("retrying");
			expect(parcel.subscribeAttempts).toHaveLength(1);

			// The retry timer fires on its own schedule and recovers to active.
			// Chained timers exceed a fixed tick budget at Windows' ~15.6ms
			// timer granularity, so poll instead of sleeping.
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("active");
			});
			expect(parcel.subscribeAttempts).toHaveLength(2);
		});
	});
});

describe("watcherIgnorePatterns", () => {
	it("returns vscode's default watcher excludes for the platform", () => {
		const expected = [
			".git/objects/**",
			".git/subtree-cache/**",
			".hg/store/**",
			"*/.git/objects/**",
			"*/.git/subtree-cache/**",
			"*/.hg/store/**",
		];
		if (process.platform === "darwin") {
			expected.push(join(homedir(), "Library", "Containers"));
		}
		expect(watcherIgnorePatterns()).toEqual(expected);
	});
});
