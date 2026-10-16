import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { FC } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider, type SdkChannelResult } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { gitContract, type GitServiceContract } from "../contracts/schemas.js";
import { GitSessionDetailsPullRequest } from "./GitSessionDetails.js";
import { useGitPrStatusStore, type GitPrSnapshot } from "./git-pr-status-store.js";
import { GitSessionRowMetadata, type GitSessionRowMetadataProps } from "./GitSessionRowMetadata.js";

const WORKTREE = "/repo/.kilo/worktrees/aback-aardvark";
const STAMPED_BRANCH = "kilo/aback-aardvark";
const PR_BRANCH = "fix/e2e-lazy-runtimed";
const STATUS_ID = `workspace:worktree:${STAMPED_BRANCH}`;
const SURFACES = [
	["session row", GitSessionRowMetadata],
	["session hover card", GitSessionDetailsPullRequest],
] as const;

const status = vi.fn();
let queryClient: QueryClient;

function snapshotOn(branch: string): GitPrSnapshot {
	return {
		identity: `origin/${branch}|abc`,
		branch,
		repository: "acme/repo",
		parentRepository: null,
		githubStatus: "ready",
		pullRequest: {
			number: 649,
			url: "https://github.com/acme/repo/pull/649",
			title: "Lazy runtimed",
			baseBranch: "main",
			headBranch: branch,
			state: "open",
			isDraft: false,
		},
	};
}

/** Seeds the status the header's repository actions would have loaded. */
function cacheHeaderStatus(currentBranch: string, updatedAt: number) {
	const data: SdkChannelResult<GitServiceContract, "status"> = {
		exists: true,
		doConflictedFilesExist: false,
		currentBranch,
		currentUpstreamBranch: `origin/${currentBranch}`,
		branchAheadBehind: { ahead: 0, behind: 0 },
		workingDirectory: { files: [] },
	};
	queryClient.setQueryData(["git", "status", { workingDirectory: WORKTREE }], data, { updatedAt });
}

function lastLookupAt() {
	return useGitPrStatusStore.getState().snapshots[STATUS_ID]!.updatedAt;
}

function renderSessionPullRequest(
	Component: FC<GitSessionRowMetadataProps>,
	{
		interactive,
		openExternal,
		inertHost = false,
	}: {
		interactive?: boolean;
		openExternal?: () => Promise<{ opened: boolean }>;
		inertHost?: boolean;
	} = {},
) {
	const sdk = createFakeSdk({
		featureId: "git",
		channels: gitContract,
		handlers: { status },
		...(openExternal ? { shell: { openExternal } } : {}),
	});
	render(
		<SdkProvider system={createFakeFeatureSystem({ sdks: { git: sdk } })}>
			<QueryClientProvider client={queryClient}>
				<div className={inertHost ? "pointer-events-none" : undefined}>
					<Component
						statusId={STATUS_ID}
						directory={WORKTREE}
						worktreeBranch={STAMPED_BRANCH}
						{...(interactive ? { interactive } : {})}
					/>
				</div>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

beforeEach(() => {
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useGitPrStatusStore.setState({
		targets: [{ id: STATUS_ID, directory: WORKTREE, active: true, branch: STAMPED_BRANCH }],
		snapshots: {},
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useGitPrStatusStore.setState({ targets: [], snapshots: {} });
});

it.each(SURFACES)(
	"%s shows the pull request of a branch checked out after the worktree was stamped",
	async (_surface, Component) => {
		useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));

		renderSessionPullRequest(Component);

		await expect.element(page.getByText("#649")).toBeVisible();
	},
);

it.each(SURFACES)(
	"%s hides the pull request as soon as the header's status shows another branch",
	async (_surface, Component) => {
		useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));
		cacheHeaderStatus("main", lastLookupAt() + 1);

		renderSessionPullRequest(Component);

		await expect.element(page.getByText("#649")).not.toBeInTheDocument();
		expect(status).not.toHaveBeenCalled();
	},
);

it("keeps the pull request when the cached status predates the last lookup", async () => {
	useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));
	cacheHeaderStatus("main", lastLookupAt() - 1);

	renderSessionPullRequest(GitSessionRowMetadata);

	await expect.element(page.getByText("#649")).toBeVisible();
});

it("follows the header's status as it refreshes", async () => {
	useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));
	cacheHeaderStatus(PR_BRANCH, lastLookupAt() + 1);
	renderSessionPullRequest(GitSessionRowMetadata);
	await expect.element(page.getByText("#649")).toBeVisible();

	cacheHeaderStatus("main", lastLookupAt() + 2);

	await expect.element(page.getByText("#649")).not.toBeInTheDocument();
});

it("renders nothing while the worktree has no pull request", async () => {
	useGitPrStatusStore
		.getState()
		.setSnapshot(STATUS_ID, { ...snapshotOn(STAMPED_BRANCH), pullRequest: null });

	renderSessionPullRequest(GitSessionRowMetadata);

	await expect.element(page.getByText("#649")).not.toBeInTheDocument();
});

it("keeps the row's pull request a plain badge where its host is clickable", async () => {
	useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));

	renderSessionPullRequest(GitSessionRowMetadata);

	await expect.element(page.getByText("#649")).toBeVisible();
	await expect.element(page.getByRole("link")).not.toBeInTheDocument();
});

it("opens the pull request in the browser where its host lets the badge be interactive", async () => {
	useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));
	const openExternal = vi.fn(async () => ({ opened: true }));

	renderSessionPullRequest(GitSessionRowMetadata, { interactive: true, openExternal });

	const link = page.getByRole("link", { name: "View PR #649: Lazy runtimed" });
	await expect.element(link).toHaveAttribute("href", "https://github.com/acme/repo/pull/649");
	await link.click();
	expect(openExternal).toHaveBeenCalledWith("https://github.com/acme/repo/pull/649");
});

it("takes the pointer for its link inside a host that otherwise ignores it", async () => {
	useGitPrStatusStore.getState().setSnapshot(STATUS_ID, snapshotOn(PR_BRANCH));

	renderSessionPullRequest(GitSessionRowMetadata, { interactive: true, inertHost: true });

	const link = page.getByRole("link");
	await expect.element(link).toBeVisible();
	const rect = link.element().getBoundingClientRect();
	const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
	expect(link.element().contains(hit)).toBe(true);
});
