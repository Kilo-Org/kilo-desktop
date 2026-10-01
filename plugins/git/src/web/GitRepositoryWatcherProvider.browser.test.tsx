import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider, sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import {
	gitContract,
	type GitRepositoryType,
	type GitServiceContract,
} from "../contracts/schemas.js";
import { GitRepositoryWatcherProvider } from "./GitRepositoryWatcherProvider.js";

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: "/repo/project",
	gitDir: "/repo/project/.git",
};

/**
 * The observable end of the invalidation: a mounted `repositoryType`
 * subscriber whose rendered text flips when the query refetches.
 */
function RepositoryTypeProbe() {
	const sdk = useSdk<GitServiceContract>("git");
	const query = useQuery(
		sdkQueryOptions(sdk, "repositoryType", { workingDirectory: "/repo/project" }),
	);
	return <span data-qa-id="git-repository-kind">{query.data?.kind ?? "pending"}</span>;
}

function StatusProbe({ status }: { readonly status: () => string | Promise<string> }) {
	const query = useQuery({ queryKey: ["git", "status", "/repo/project"], queryFn: status });
	return <span data-qa-id="git-status-probe">{query.data ?? "pending"}</span>;
}

function renderProvider(handlers: {
	repositoryType: () => GitRepositoryType | Promise<GitRepositoryType>;
	status?: () => string | Promise<string>;
}) {
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		repositoryType: () => handlers.repositoryType(),
		status: () => {
			throw new Error("unused in this test");
		},
		branches: () => {
			throw new Error("unused in this test");
		},
		checkout: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		init: () => {
			throw new Error("unused in this test");
		},
		defaultBranch: () => {
			throw new Error("unused in this test");
		},
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	// The workspace feature emits real `workspace.file-change` batches on the
	// same bus the hook subscribes to.
	const workspaceMainSdk = createFakeMainSdk({ featureId: "workspace", services: sdk.services });

	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<GitRepositoryWatcherProvider>
					<RepositoryTypeProbe />
					{handlers.status ? <StatusProbe status={handlers.status} /> : null}
				</GitRepositoryWatcherProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, workspaceMainSdk };
}

function emitWorkspaceFileChange(
	workspaceMainSdk: ReturnType<typeof createFakeMainSdk>,
	changes: ReadonlyArray<{ path: string; type: "create" | "update" | "delete" }>,
): void {
	workspaceMainSdk.events.emit("file-change", { root: "/repo/project", changes: [...changes] });
}

/** A handler result the test settles by hand, holding the query in flight until then. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

/** Longer than the provider's 75 ms debounce, so each batch gets its own flush. */
function settle(ms = 150): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
	cleanup();
});

describe("GitRepositoryWatcherProvider", () => {
	it("refetches the seeded repositoryType query when .git contents appear externally", async () => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		missing = false;
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/.git/HEAD", type: "create" },
		]);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});

	it("refetches when the .git directory itself appears", async () => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		missing = false;
		emitWorkspaceFileChange(workspaceMainSdk, [{ path: "/repo/project/.git", type: "create" }]);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});

	it("recognizes Windows .git paths", async () => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");
		missing = false;
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: String.raw`C:\repo\project\.git\HEAD`, type: "create" },
		]);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});

	it("retains .git invalidation when an ordinary file event follows during the debounce", async () => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");
		missing = false;
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/.git/HEAD", type: "create" },
		]);
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/src/index.ts", type: "update" },
		]);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});

	it("ignores file changes outside .git", async () => {
		const repositoryType = vi.fn(() => ({ kind: "missing" }) as const);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/README.md", type: "create" },
		]);

		// Give the (filtered-out) batch a beat before asserting no refetch.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(repositoryType).toHaveBeenCalledTimes(1);
	});

	it("refetches git status after an ordinary workspace file update", async () => {
		const repositoryType = vi.fn(() => regularRepositoryType);
		let statusValue = "clean";
		const status = vi.fn(() => statusValue);
		const { workspaceMainSdk } = renderProvider({ repositoryType, status });

		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("clean");
		statusValue = "modified";
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/src/index.ts", type: "update" },
		]);

		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("modified");
		expect(status).toHaveBeenCalledTimes(2);
	});

	it("refetches when existing .git metadata is updated", async () => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		missing = false;
		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/.git/HEAD", type: "update" },
		]);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});

	it("refetches an in-flight status query once after it settles instead of stacking fetches", async () => {
		const repositoryType = vi.fn(() => regularRepositoryType);
		const inFlight = deferred<string>();
		const status = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise)
			.mockReturnValue("latest");
		const { workspaceMainSdk } = renderProvider({ repositoryType, status });
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("clean");

		emitWorkspaceFileChange(workspaceMainSdk, [{ path: "/repo/project/src/a.ts", type: "update" }]);
		await expect.poll(() => status.mock.calls.length).toBe(2);
		for (const name of ["b", "c", "d"]) {
			emitWorkspaceFileChange(workspaceMainSdk, [
				{ path: `/repo/project/src/${name}.ts`, type: "update" },
			]);
			await settle();
		}
		expect(status).toHaveBeenCalledTimes(2);

		inFlight.resolve("stale");
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("latest");
		await settle();
		expect(status).toHaveBeenCalledTimes(3);
	});

	// VS Code's `_throttle` never runs its trailing call when the in-flight
	// promise rejects; this provider must.
	it("still runs the trailing refetch when the in-flight fetch fails", async () => {
		const repositoryType = vi.fn(() => regularRepositoryType);
		const inFlight = deferred<string>();
		const status = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise)
			.mockReturnValue("recovered");
		const { workspaceMainSdk } = renderProvider({ repositoryType, status });
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("clean");

		emitWorkspaceFileChange(workspaceMainSdk, [{ path: "/repo/project/src/a.ts", type: "update" }]);
		await expect.poll(() => status.mock.calls.length).toBe(2);
		emitWorkspaceFileChange(workspaceMainSdk, [{ path: "/repo/project/src/b.ts", type: "update" }]);
		await settle();
		expect(status).toHaveBeenCalledTimes(2);

		inFlight.reject(new Error("git exited 128"));
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("recovered");
		expect(status).toHaveBeenCalledTimes(3);
	});

	it("does not refetch when no change arrived while the query was in flight", async () => {
		const repositoryType = vi.fn(() => regularRepositoryType);
		const inFlight = deferred<string>();
		const status = vi
			.fn<() => string | Promise<string>>()
			.mockReturnValueOnce("clean")
			.mockReturnValueOnce(inFlight.promise);
		const { workspaceMainSdk } = renderProvider({ repositoryType, status });
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("clean");

		emitWorkspaceFileChange(workspaceMainSdk, [{ path: "/repo/project/src/a.ts", type: "update" }]);
		await expect.poll(() => status.mock.calls.length).toBe(2);
		inFlight.resolve("modified");
		await expect.element(page.getByTestId("git-status-probe")).toHaveTextContent("modified");
		await settle();
		expect(status).toHaveBeenCalledTimes(2);
	});

	it.each([
		"/repo/project/.git/index.lock",
		"/repo/project/.git/refs/heads/main.lock",
		"/repo/project/.git/objects/ab/cdef0123456789",
		"/repo/project/.git/logs/HEAD",
		"/repo/project/.git/logs/refs/heads/main",
		"/repo/project/.git/worktrees/wt/logs/HEAD",
		"/repo/project/.git/worktrees/wt/index.lock",
		"/repo/project/.git/FETCH_HEAD",
		"/repo/project/.git/ORIG_HEAD",
		"/repo/project/.git/COMMIT_EDITMSG",
		"/repo/project/.git/fsmonitor--daemon/cookies/1-2",
		"/repo/project/.git/lfs/objects/ab/cd/abcdef",
		"/repo/project/.git/subtree-cache/1/x",
		"/repo/project/.git/.watchman-cookie-host-1-2",
		String.raw`C:\repo\project\.git\index.lock`,
	])("ignores .git noise: %s", async (path) => {
		const repositoryType = vi.fn(() => regularRepositoryType);
		const { workspaceMainSdk } = renderProvider({ repositoryType });
		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");

		emitWorkspaceFileChange(workspaceMainSdk, [{ path, type: "update" }]);

		await settle();
		expect(repositoryType).toHaveBeenCalledTimes(1);
	});

	it.each([
		[["/repo/project/.git/index"]],
		[["/repo/project/.git/refs/heads/feature"]],
		[["/repo/project/.git/packed-refs"]],
		[["/repo/project/.git/worktrees/wt/HEAD"]],
		[["/repo/project/.git/index.lock", "/repo/project/.git/index"]],
	])("still refreshes metadata for %j", async (paths) => {
		let missing = true;
		const repositoryType = vi.fn((): GitRepositoryType =>
			missing ? { kind: "missing" } : regularRepositoryType,
		);
		const { workspaceMainSdk } = renderProvider({ repositoryType });
		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		missing = false;
		emitWorkspaceFileChange(
			workspaceMainSdk,
			paths.map((path) => ({ path, type: "update" as const })),
		);

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("regular");
		expect(repositoryType).toHaveBeenCalledTimes(2);
	});
});
