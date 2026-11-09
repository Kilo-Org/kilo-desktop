import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileChangeEvent } from "@kilo-desktop/plugin-workspaces/contracts";

import { watchRepositoryQueries, type FileChangeSource } from "./repository-watcher.js";

const WAIT = { timeout: 5_000 };

class FakeFiles implements FileChangeSource {
	readonly listeners = new Set<(event: FileChangeEvent) => void>();
	on(_event: "changed", listener: (event: FileChangeEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(...paths: string[]) {
		for (const listener of this.listeners) {
			listener({ root: "/repo/project", changes: paths.map((path) => ({ path, type: "update" })) });
		}
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

/** Longer than the 75 ms debounce, so each batch gets its own flush. */
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/** A window cache with live `repositoryType` and `status` reads of `/repo/project`. */
function watch(reads: {
	repositoryType?: () => string | Promise<string>;
	status?: () => string | Promise<string>;
}) {
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const files = new FakeFiles();
	const observe = (method: string, read: () => string | Promise<string>) => {
		const observer = new QueryObserver(queries, {
			queryKey: ["git", method, { directory: "/repo/project" }],
			queryFn: read,
		});
		stops.push(observer.subscribe(() => undefined));
		return () => observer.getCurrentResult().data;
	};
	const repositoryType = observe("repositoryType", reads.repositoryType ?? (() => "regular"));
	const status = observe("status", reads.status ?? (() => "clean"));
	stops.push(watchRepositoryQueries(files, queries));
	return { files, repositoryType, status };
}

describe("keeping repository reads current from file changes", () => {
	it.each([
		["/repo/project/.git/HEAD"],
		["/repo/project/.git"],
		[String.raw`C:\repo\project\.git\HEAD`],
		["/repo/project/.git/index"],
		["/repo/project/.git/refs/heads/feature"],
		["/repo/project/.git/packed-refs"],
		["/repo/project/.git/worktrees/wt/HEAD"],
	])("refreshes repository metadata when %s changes", async (path) => {
		let kind = "missing";
		const read = vi.fn(() => kind);
		const { files, repositoryType } = watch({ repositoryType: read });
		await vi.waitFor(() => expect(repositoryType()).toBe("missing"), WAIT);

		kind = "regular";
		files.emit(path);

		await vi.waitFor(() => expect(repositoryType()).toBe("regular"), WAIT);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("keeps a .git refresh when an ordinary change follows within the debounce", async () => {
		let kind = "missing";
		const read = vi.fn(() => kind);
		const { files, repositoryType } = watch({ repositoryType: read });
		await vi.waitFor(() => expect(repositoryType()).toBe("missing"), WAIT);

		kind = "regular";
		files.emit("/repo/project/.git/HEAD");
		files.emit("/repo/project/src/index.ts");

		await vi.waitFor(() => expect(repositoryType()).toBe("regular"), WAIT);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("refreshes only the working tree's status for ordinary changes in its folder", async () => {
		let value = "clean";
		const readType = vi.fn(() => "regular");
		const readStatus = vi.fn(() => value);
		const { files, status } = watch({ repositoryType: readType, status: readStatus });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		value = "modified";
		files.emit("/repo/project/src/index.ts");
		await vi.waitFor(() => expect(status()).toBe("modified"), WAIT);

		files.emit("/elsewhere/file.ts");
		await settle();
		expect(readStatus).toHaveBeenCalledTimes(2);
		expect(readType).toHaveBeenCalledTimes(1);
	});

	it.each([
		"/repo/project/.git/index.lock",
		"/repo/project/.git/refs/heads/main.lock",
		"/repo/project/.git/objects/ab/cdef0123456789",
		"/repo/project/.git/logs/HEAD",
		"/repo/project/.git/worktrees/wt/logs/HEAD",
		"/repo/project/.git/FETCH_HEAD",
		"/repo/project/.git/ORIG_HEAD",
		"/repo/project/.git/COMMIT_EDITMSG",
		"/repo/project/.git/fsmonitor--daemon/cookies/1-2",
		"/repo/project/.git/lfs/objects/ab/cd/abcdef",
		"/repo/project/.git/subtree-cache/1/x",
		"/repo/project/.git/.watchman-cookie-host-1-2",
		"/repo/project/node_modules/x/index.js",
		String.raw`C:\repo\project\.git\index.lock`,
	])("ignores noise: %s", async (path) => {
		const readType = vi.fn(() => "regular");
		const readStatus = vi.fn(() => "clean");
		const { files, status } = watch({ repositoryType: readType, status: readStatus });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		files.emit(path);

		await settle();
		expect(readType).toHaveBeenCalledTimes(1);
		expect(readStatus).toHaveBeenCalledTimes(1);
	});

	it("refetches an in-flight read once after it settles instead of stacking fetches", async () => {
		const inFlight = deferred<string>();
		const read = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise)
			.mockReturnValue("latest");
		const { files, status } = watch({ status: read });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		files.emit("/repo/project/src/a.ts");
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), WAIT);
		for (const name of ["b", "c", "d"]) {
			files.emit(`/repo/project/src/${name}.ts`);
			await settle();
		}
		expect(read).toHaveBeenCalledTimes(2);

		inFlight.resolve("stale");
		await vi.waitFor(() => expect(status()).toBe("latest"), WAIT);
		await settle();
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("still refetches after an in-flight read fails", async () => {
		const inFlight = deferred<string>();
		const read = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise)
			.mockReturnValue("recovered");
		const { files, status } = watch({ status: read });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		files.emit("/repo/project/src/a.ts");
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), WAIT);
		files.emit("/repo/project/src/b.ts");
		await settle();

		inFlight.reject(new Error("git exited 128"));
		await vi.waitFor(() => expect(status()).toBe("recovered"), WAIT);
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("does not refetch when nothing changed while a read was in flight", async () => {
		const inFlight = deferred<string>();
		const read = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise);
		const { files, status } = watch({ status: read });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		files.emit("/repo/project/src/a.ts");
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), WAIT);
		inFlight.resolve("modified");
		await vi.waitFor(() => expect(status()).toBe("modified"), WAIT);
		await settle();
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("stops listening when stopped", async () => {
		const read = vi.fn(() => "clean");
		const { files, status } = watch({ status: read });
		await vi.waitFor(() => expect(status()).toBe("clean"), WAIT);

		for (const stop of stops.splice(0)) stop();
		files.emit("/repo/project/src/a.ts");

		await settle();
		expect(files.listeners.size).toBe(0);
		expect(read).toHaveBeenCalledTimes(1);
	});
});
