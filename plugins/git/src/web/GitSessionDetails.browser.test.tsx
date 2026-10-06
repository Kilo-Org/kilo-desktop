import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import {
	gitContract,
	type GitBranchesResult,
	type GitRepositoryType,
} from "../contracts/schemas.js";
import { GitSessionDetailsBranch } from "./GitSessionDetails.js";
import { useGitPrStatusStore } from "./git-pr-status-store.js";

const DIRECTORY = "/repo/project";
const STATUS_ID = "workspace:worktree:kilo/thing";

const branchesResult: GitBranchesResult = {
	currentBranch: "feature",
	defaultBranch: "main",
	recentBranches: [],
	branches: [],
};

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: DIRECTORY,
	gitDir: `${DIRECTORY}/.git`,
};

function renderBranch(
	handlers: {
		repositoryType?: () => GitRepositoryType | Promise<GitRepositoryType>;
		branches: () => GitBranchesResult | null | Promise<GitBranchesResult | null>;
	},
	options?: { worktreeBranch?: string },
) {
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		repositoryType: () => handlers.repositoryType?.() ?? regularRepositoryType,
		branches: () => handlers.branches(),
		checkout: async () => undefined,
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		init: async () => undefined,
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
		defaultBranch: () => {
			throw new Error("unused in this test");
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<GitSessionDetailsBranch
					statusId={STATUS_ID}
					directory={DIRECTORY}
					{...(options?.worktreeBranch === undefined
						? {}
						: { worktreeBranch: options.worktreeBranch })}
				/>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

afterEach(() => {
	cleanup();
	useGitPrStatusStore.setState({ targets: [], snapshots: {} });
});

it("shows the probed current branch for a regular repository", async () => {
	const branches = vi.fn(() => branchesResult);
	const screen = renderBranch({ branches });

	await expect
		.element(screen.getByTestId("git-session-details-branch"))
		.toHaveTextContent("feature");
	expect(branches).toHaveBeenCalled();
});

it("never probes branches for a non-repository and falls back to the stamped worktree branch", async () => {
	const branches = vi.fn(() => branchesResult);
	const screen = renderBranch(
		{ repositoryType: () => ({ kind: "missing" }), branches },
		{ worktreeBranch: "kilo/thing" },
	);

	await expect
		.element(screen.getByTestId("git-session-details-branch"))
		.toHaveTextContent("kilo/thing");
	expect(branches).not.toHaveBeenCalled();
});

it("never probes branches for a bare repository and renders nothing without a known branch", async () => {
	const branches = vi.fn(() => branchesResult);
	const screen = renderBranch({ repositoryType: () => ({ kind: "bare" }), branches });

	await expect.element(screen.getByTestId("git-session-details-branch")).not.toBeInTheDocument();
	expect(branches).not.toHaveBeenCalled();
});
