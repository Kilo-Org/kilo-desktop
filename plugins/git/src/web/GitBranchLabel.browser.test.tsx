import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import {
	gitContract,
	type GitBranchesResult,
	type GitRepositoryType,
} from "../contracts/schemas.js";
import { GitBranchLabel } from "./GitBranchLabel.js";

const branchesResult: GitBranchesResult = {
	currentBranch: "main",
	defaultBranch: "main",
	recentBranches: [],
	branches: [
		{ name: "main", upstream: null, tip: { sha: "a" }, ref: "refs/heads/main", kind: "local" },
	],
};

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: "/repo/project",
	gitDir: "/repo/project/.git",
};

function renderLabel(
	handlers: {
		repositoryType?: () => GitRepositoryType | Promise<GitRepositoryType>;
		branches: () => GitBranchesResult | null | Promise<GitBranchesResult | null>;
	},
	options?: { workingDirectory?: string | undefined },
) {
	const workingDirectory = options === undefined ? "/repo/project" : options.workingDirectory;
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		repositoryType: ({ workingDirectory: probedDirectory }) => {
			if (workingDirectory === undefined) throw new Error("probed without a workspace");
			expect(probedDirectory).toBe(workingDirectory);
			return handlers.repositoryType?.() ?? regularRepositoryType;
		},
		branches: ({ workingDirectory: probedDirectory }) => {
			expect(probedDirectory).toBe(workingDirectory);
			return handlers.branches();
		},
		checkout: async () => undefined,
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		init: () => {
			throw new Error("unused in this test");
		},
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
				<GitBranchLabel workingDirectory={workingDirectory} />
			</QueryClientProvider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

afterEach(() => {
	cleanup();
});

describe("GitBranchLabel", () => {
	it("shows the current branch as a read-only label", async () => {
		const screen = renderLabel({ branches: () => branchesResult });

		const label = screen.getByTestId("git-branch-label");
		await expect.element(label).toBeVisible();
		await expect.element(label).toHaveTextContent("main");
		await expect.element(label).toHaveAttribute("aria-label", "Branch main");
		await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
	});

	it("hides when there is no workspace and never probes", async () => {
		const branches = vi.fn(() => branchesResult);
		const screen = renderLabel({ branches }, { workingDirectory: undefined });

		await expect.element(screen.getByTestId("git-branch-label")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});

	it("renders the Initialize Git button for a missing workspace and never probes", async () => {
		const branches = vi.fn(() => branchesResult);
		const screen = renderLabel(
			{
				repositoryType: () => ({ kind: "missing" }),
				branches,
			},
			{ workingDirectory: "/tmp/not-a-repo" },
		);

		await expect.element(screen.getByTestId("git-init-thread-button")).toBeVisible();
		await expect.element(screen.getByTestId("git-branch-label")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});

	it.each([
		["bare", { kind: "bare" } as const],
		["unsafe", { kind: "unsafe", path: "/repo/project" } as const],
	])("hides for a %s workspace and never probes", async (_kind, repositoryType) => {
		const branches = vi.fn(() => branchesResult);
		const screen = renderLabel(
			{
				repositoryType: () => repositoryType,
				branches,
			},
			{ workingDirectory: "/repo/project" },
		);

		await expect.element(screen.getByTestId("git-branch-label")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("git-init-thread-button")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});

	it("shows the worktree branch when given a worktree working directory", async () => {
		const worktreeBranchesResult: GitBranchesResult = {
			currentBranch: "kilo/fix-the-login-bug",
			defaultBranch: "main",
			recentBranches: [],
			branches: [
				{
					name: "kilo/fix-the-login-bug",
					upstream: null,
					tip: { sha: "b" },
					ref: "refs/heads/kilo/fix-the-login-bug",
					kind: "local",
				},
			],
		};
		const screen = renderLabel(
			{ branches: () => worktreeBranchesResult },
			{ workingDirectory: "/repo/.kilo/worktrees/kilo-fix-the-login-bug" },
		);

		const label = screen.getByTestId("git-branch-label");
		await expect.element(label).toBeVisible();
		await expect.element(label).toHaveTextContent("kilo/fix-the-login-bug");
	});
});
