import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { watcherIgnorePatterns } from "./default-excludes";
import { createTestWatcher, noopLogger } from "./test/test-helpers";

const PROJECT = "/work/project";

function change(path: string, type: "created" | "updated" | "deleted") {
	return { path, type };
}

describe("WorkspaceWatcher", () => {
	describe("event delivery", () => {
		it("emits each normalized batch, with its root, on the event bus", async () => {
			const emit = vi.fn();
			const { watcher, parcel, tick } = createTestWatcher({ emit });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.subscriptions[0]!.emit([
				change(`${PROJECT}/src/main.py`, "created"),
				change(`${PROJECT}/src/main.py`, "updated"),
			]);

			expect(emit).toHaveBeenCalledExactlyOnceWith({
				root: PROJECT,
				changes: [
					{ path: `${PROJECT}/src/main.py`, type: "create" },
					{ path: `${PROJECT}/src/main.py`, type: "update" },
				],
			});
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
				const { watcher, parcel, tick, batches } = createTestWatcher();
				watcher.watchDirectory("c:\\work");
				await tick();

				parcel.subscriptions[0]!.emit([{ path: "c:\\\\", type: "created" }]);

				expect(batches).toEqual([[{ path: "c:\\\\", type: "create" }]]);
			});

			it("normalizes a windows drive root duplicate backslash on win32", async () => {
				Object.defineProperty(process, "platform", { value: "win32" });
				const { watcher, parcel, tick, batches } = createTestWatcher();
				watcher.watchDirectory("c:\\work");
				await tick();

				parcel.subscriptions[0]!.emit([{ path: "c:\\\\", type: "created" }]);

				expect(batches).toEqual([[{ path: "c:\\", type: "create" }]]);
			});
		});

		it("remaps event paths onto the registered prefix when the directory is a symlink", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({
				realpath: (path) => (path === "/link/project" ? "/real/project" : path),
			});
			watcher.watchDirectory("/link/project");
			await tick();

			parcel.subscriptions[0]!.emit([change("/real/project/src/a.py", "created")]);

			expect(batches).toEqual([[{ path: "/link/project/src/a.py", type: "create" }]]);
		});

		it("treats realpath as identity and proceeds to active when realpath rejects", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({
				realpath: () => Promise.reject(new Error("EACCES: permission denied")),
			});
			watcher.watchDirectory(PROJECT);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("active");
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/src/a.py`, "created")]);
			expect(batches).toEqual([[{ path: `${PROJECT}/src/a.py`, type: "create" }]]);
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

			expect(watcher.status().directories).toEqual([{ path: PROJECT, state: "starting" }]);

			releaseSubscribe();
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("active");
			});
		});

		it("unwatchDirectory tears the native watcher down", async () => {
			const { watcher, parcel, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			await tick();
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(false);

			watcher.unwatchDirectory(PROJECT);
			expect(parcel.subscriptions[0]!.unsubscribed).toBe(true);
			expect(watcher.status().directories).toHaveLength(0);
		});

		it("reports each directory's state", async () => {
			const { watcher, tick } = createTestWatcher();
			watcher.watchDirectory(PROJECT);
			watcher.watchDirectory("/work/other");
			await tick();

			const directories = watcher
				.status()
				.directories.filter((directory) => directory.path === PROJECT);
			expect(directories).toEqual([{ path: PROJECT, state: "active" }]);
		});
	});

	describe("retry on failure", () => {
		it("moves to retrying and stops events when the subscription errors", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({ retryDelayMs: 5 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.subscriptions[0]!.fail(new Error("watched path was deleted"));
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);

			expect(watcher.status().directories[0]?.state).toBe("retrying");
			expect(batches).toHaveLength(0);
		});

		it("keeps watching when the OS drops events under a burst of changes", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({ retryDelayMs: 5 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.subscriptions[0]!.fail(
				new Error("Events were dropped by the FSEvents client. File system must be re-scanned."),
			);
			parcel.subscriptions[0]!.emit([change(`${PROJECT}/a.txt`, "created")]);
			await tick();

			expect(watcher.status().directories[0]?.state).toBe("active");
			expect(batches).toHaveLength(1);
			expect(parcel.subscribeAttempts).toEqual([PROJECT]);
		});

		it("recovers to active when a retry succeeds", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({ retryDelayMs: 5 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.subscriptions[0]!.fail(new Error("transient"));

			// Chained retry timers exceed a fixed tick budget at Windows' ~15.6ms
			// timer granularity, so poll instead of sleeping.
			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("active");
			});
			expect(parcel.subscribeAttempts).toEqual([PROJECT, PROJECT]);
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/a.txt`, "created")]);
			expect(batches).toHaveLength(1);
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

		// Repro for the WSL (\\wsl.localhost) report: real @parcel/watcher on a
		// 9P UNC path *resolves* subscribe(), then ~1ms later delivers
		// "Failed to read changes" through the event callback — on every attempt.
		it("gives up to failed when every subscription resolves and then errors (WSL UNC path)", async () => {
			const { watcher, parcel, tick } = createTestWatcher({
				retryDelayMs: 5,
				maxRetries: 2,
				subscribeFn: async (dir, onEvents, opts) => {
					const sub = await parcel.subscribe(dir, onEvents, opts);
					setTimeout(() => onEvents(new Error("Failed to read changes"), []), 1);
					return sub;
				},
			});
			watcher.watchDirectory(PROJECT);

			await tick(200);

			expect(watcher.status().directories[0]?.state).toBe("failed");
			// Initial attempt + 2 retries, then retrying stops.
			expect(parcel.subscribeAttempts).toHaveLength(3);
		});

		it.each([
			["\\\\wsl.localhost\\Ubuntu\\home\\user\\project", true],
			["\\\\WSL$\\Ubuntu\\home\\user\\project", true],
			[PROJECT, false],
		])("explains WSL paths when %s gives up (WSL hint: %s)", async (dir, expectsWslHint) => {
			const errors: string[] = [];
			const { watcher, parcel } = createTestWatcher({
				retryDelayMs: 5,
				maxRetries: 1,
				logger: { ...noopLogger, error: (message) => errors.push(message) },
			});
			parcel.failNextSubscribes(dir, 10, new Error("Failed to read changes"));
			watcher.watchDirectory(dir);

			await vi.waitFor(() => {
				expect(watcher.status().directories[0]?.state).toBe("failed");
			});

			expect(errors).toHaveLength(1);
			const wslHint = "WSL folders do not support Windows file-change notifications";
			if (expectsWslHint) expect(errors[0]).toContain(wslHint);
			else expect(errors[0]).not.toContain(wslHint);
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
			const { watcher, parcel, tick, batches } = createTestWatcher({
				retryDelayMs: 5,
				maxRetries: 1,
			});
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
			expect(batches).toHaveLength(1);
		});

		it("stops timers and callbacks after dispose", async () => {
			const { watcher, parcel, tick, batches } = createTestWatcher({ retryDelayMs: 5 });
			watcher.watchDirectory(PROJECT);
			await tick();

			parcel.subscriptions[0]!.fail(new Error("transient"));
			await watcher.dispose();
			await tick(30);

			expect(parcel.subscribeAttempts).toHaveLength(1);
			parcel.subscriptions.at(-1)!.emit([change(`${PROJECT}/a.txt`, "created")]);
			expect(batches).toHaveLength(0);
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
