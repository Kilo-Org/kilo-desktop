import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeMainSdk,
	createFakeSdk,
} from "@anaconda-agentic-desktop/testing";

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
	options?: { workspaceDirectory?: string | undefined },
) {
	const workspaceDirectory = options === undefined ? "/repo/project" : options.workspaceDirectory;
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		repositoryType: ({ workingDirectory: probedDirectory }) => {
			if (workspaceDirectory === undefined) throw new Error("probed without a workspace");
			expect(probedDirectory).toBe(workspaceDirectory);
			return handlers.repositoryType?.() ?? regularRepositoryType;
		},
		branches: ({ workingDirectory: probedDirectory }) => {
			expect(probedDirectory).toBe(workspaceDirectory);
			return handlers.branches();
		},
		checkout: async () => undefined,
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<GitBranchLabel workspaceDirectory={workspaceDirectory} />
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
		const screen = renderLabel({ branches }, { workspaceDirectory: undefined });

		await expect.element(screen.getByTestId("git-branch-label")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});

	it("hides when the workspace is not a git repository", async () => {
		const branches = vi.fn(() => branchesResult);
		const screen = renderLabel(
			{
				repositoryType: () => ({ kind: "missing" }),
				branches,
			},
			{ workspaceDirectory: "/tmp/not-a-repo" },
		);

		await expect.element(screen.getByTestId("git-branch-label")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});
});
