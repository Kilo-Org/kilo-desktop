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

function renderProvider(handlers: {
	repositoryType: () => GitRepositoryType | Promise<GitRepositoryType>;
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

	it("ignores .git updates like checkouts touching .git/HEAD", async () => {
		const repositoryType = vi.fn(() => ({ kind: "missing" }) as const);
		const { workspaceMainSdk } = renderProvider({ repositoryType });

		await expect.element(page.getByTestId("git-repository-kind")).toHaveTextContent("missing");

		emitWorkspaceFileChange(workspaceMainSdk, [
			{ path: "/repo/project/.git/HEAD", type: "update" },
		]);

		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(repositoryType).toHaveBeenCalledTimes(1);
	});
});
