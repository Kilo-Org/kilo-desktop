import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FeatureError } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { gitActionsContract, gitContract, type GitRepositoryType } from "../contracts/schemas.js";
import { GitActionsControl } from "./GitActionsControl.js";

const toastApi = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@kilo-desktop/ui/components/sonner", () => ({ toast: toastApi }));

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: "/repo/project",
	gitDir: "/repo/project/.git",
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("tracks a generated commit message without its content", async () => {
	const track = vi.fn(async () => {});
	const commit = vi.fn(() => undefined);
	const sdk = createFakeSdk({
		featureId: "git",
		channels: { ...gitContract, ...gitActionsContract },
		telemetry: { track },
		handlers: {
			repositoryType: () => regularRepositoryType,
			status: () => ({
				exists: true,
				doConflictedFilesExist: false,
				currentBranch: "feature",
				workingDirectory: { files: [{ path: "a.txt", status: { kind: "Modified" as const } }] },
			}),
			branches: () => ({
				currentBranch: "feature",
				defaultBranch: "main",
				recentBranches: [],
				branches: [],
			}),
			originUrl: () => null,
			workingTreeStats: () => ({ additions: 1, deletions: 0 }),
			fetch: () => undefined,
			stageChanges: () => ({ statusSummary: "M a.txt", diffPatch: "", recentCommitSubjects: [] }),
			commit,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	system.getSdk("kilo-ui").plugins.expose("sourceControlWriter", {
		generateCommitMessage: async () => "Secret commit subject",
		generatePullRequest: async () => ({ title: "", body: "" }),
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	try {
		render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<GitActionsControl workspaceDirectory="/repo/project" />
				</QueryClientProvider>
			</SdkProvider>,
		);
		await page.getByTestId("git-action-primary").click();
		await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());

		expect(track).toHaveBeenCalledExactlyOnceWith({
			event: "Commit Message Generated",
			data: { featureId: "git" },
		});
	} finally {
		cleanup();
		queryClient.clear();
		sdk.destroy();
	}
});

it("opens the pull request from the branch checked out after a mid-flow rename", async () => {
	let checkedOutBranch = "kilo/old-name";
	const push = vi.fn(() => undefined);
	const createPullRequest = vi.fn(() => ({
		number: 7,
		title: "Title",
		url: "https://github.com/acme/repo/pull/7",
		state: "open" as const,
		isDraft: true,
		headBranch: checkedOutBranch,
		baseBranch: "main",
	}));
	const generatePullRequest = vi.fn(async () => ({ title: "Title", body: "Body" }));
	const sdk = createFakeSdk({
		featureId: "git",
		channels: { ...gitContract, ...gitActionsContract },
		handlers: {
			repositoryType: () => regularRepositoryType,
			status: () => ({
				exists: true,
				doConflictedFilesExist: false,
				currentBranch: checkedOutBranch,
				workingDirectory: { files: [{ path: "a.txt", status: { kind: "Modified" as const } }] },
			}),
			branches: () => ({
				currentBranch: checkedOutBranch,
				defaultBranch: "main",
				recentBranches: [],
				branches: [],
			}),
			originUrl: () => "git@github.com:acme/repo.git",
			workingTreeStats: () => ({ additions: 1, deletions: 0 }),
			fetch: () => undefined,
			stageChanges: () => ({ statusSummary: "M a.txt", diffPatch: "", recentCommitSubjects: [] }),
			commit: () => {
				// The session's worktree auto-rename lands while the flow is running.
				checkedOutBranch = "kilo/new-name";
				return undefined;
			},
			push,
			githubCliStatus: () => ({ status: "ready" as const }),
			pullRequestContext: () => ({
				commitSummary: "",
				diffSummary: "",
				diffPatch: "",
				recentCommitSubjects: [],
				pullRequestTemplate: null,
			}),
			createPullRequest,
			pullRequestSnapshot: () => ({
				identity: null,
				branch: checkedOutBranch,
				repository: "acme/repo",
				parentRepository: null,
				pullRequest: null,
				githubStatus: "ready" as const,
			}),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	system.getSdk("kilo-ui").plugins.expose("sourceControlWriter", {
		generateCommitMessage: async () => "Subject",
		generatePullRequest,
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	try {
		render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<GitActionsControl workspaceDirectory="/repo/project" />
				</QueryClientProvider>
			</SdkProvider>,
		);
		await expect
			.element(page.getByTestId("git-action-primary"))
			.toHaveTextContent("Commit, push & PR");
		await page.getByTestId("git-action-primary").click();
		await vi.waitFor(() => expect(createPullRequest).toHaveBeenCalledOnce());

		expect(push).toHaveBeenCalledExactlyOnceWith({ workingDirectory: "/repo/project" });
		expect(generatePullRequest).toHaveBeenCalledWith(
			expect.objectContaining({ headBranch: "kilo/new-name" }),
		);
		expect(createPullRequest).toHaveBeenCalledWith(
			expect.objectContaining({ headBranch: "kilo/new-name" }),
		);
	} finally {
		cleanup();
		queryClient.clear();
		sdk.destroy();
	}
});

it.each(["primary", "menu", "default branch"])(
	"keeps long %s push errors readable within the window and allows dismissal",
	async (entry) => {
		const onAppendToChat = vi.fn();
		const details = `remote: Permission denied.\n${"remote: Check repository access.\n".repeat(80)}https://example.com/${"repository".repeat(100)}\nfatal: push failed`;
		const push = vi.fn(() => {
			throw new FeatureError(details);
		});
		const sdk = createFakeSdk({
			featureId: "git",
			channels: { ...gitContract, ...gitActionsContract },
			handlers: {
				repositoryType: () => regularRepositoryType,
				status: () => ({
					exists: true,
					doConflictedFilesExist: false,
					currentBranch: "feature",
					currentUpstreamBranch: "origin/feature",
					branchAheadBehind: { ahead: 1, behind: 0 },
					workingDirectory: { files: [] },
				}),
				branches: () => ({
					currentBranch: "feature",
					defaultBranch: entry === "default branch" ? "feature" : "main",
					recentBranches: [],
					branches: [],
				}),
				originUrl: () => "git@github.com:acme/repo.git",
				workingTreeStats: () => ({ additions: 0, deletions: 0 }),
				fetch: () => undefined,
				push,
			},
		});
		const system = createFakeFeatureSystem({ sdks: { git: sdk } });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		try {
			render(
				<SdkProvider system={system}>
					<QueryClientProvider client={queryClient}>
						<GitActionsControl
							workspaceDirectory="/repo/project"
							{...(entry !== "menu" ? { onAppendToChat } : {})}
						/>
					</QueryClientProvider>
				</SdkProvider>,
			);
			if (entry === "menu") {
				await page.getByRole("button", { name: "Repository action options" }).click();
				await page.getByTestId("git-action-push").click();
			} else {
				await page.getByTestId("git-action-primary").click();
				if (entry === "default branch") {
					await page
						.getByRole("dialog", { name: "Push to default branch?" })
						.getByRole("button", { name: "Push", exact: true })
						.click();
				}
			}
			const dialog = page.getByRole("dialog", { name: "Unable to push" });
			await expect.element(dialog).toBeVisible();
			expect(push).toHaveBeenCalledOnce();
			expect(toastApi.error).not.toHaveBeenCalled();
			expect(dialog.element().querySelector("pre")?.textContent).toBe(details);

			for (const [width, height] of [
				[1280, 800],
				[375, 500],
				[640, 320],
				[375, 320],
			] as const) {
				await page.viewport(width, height);
				await vi.waitFor(() => {
					const element = dialog.element();
					const bounds = element.getBoundingClientRect();
					expect(bounds.left).toBeGreaterThanOrEqual(0);
					expect(bounds.top).toBeGreaterThanOrEqual(0);
					expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
					expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
					expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
					const viewport = element.querySelector<HTMLElement>(
						'[data-slot="scroll-area-viewport"]',
					)!;
					expect(viewport.clientHeight).toBeGreaterThan(0);
					expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
					expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
					const footer = element.querySelector('[data-slot="dialog-footer"]')!;
					expect(viewport.getBoundingClientRect().bottom).toBeLessThanOrEqual(
						footer.getBoundingClientRect().top,
					);
					viewport.scrollTop = viewport.scrollHeight;
					expect(viewport.scrollTop).toBeGreaterThan(0);
				});
			}
			if (entry === "primary") {
				await page.getByRole("button", { name: "Fix in chat" }).click();
				expect(onAppendToChat).toHaveBeenCalledExactlyOnceWith(
					`Git error output:\n${details}\n\nHelp me diagnose and fix the Git push failure above in /repo/project.`,
				);
				expect(push).toHaveBeenCalledOnce();
			} else {
				if (entry === "menu") {
					await expect
						.element(page.getByRole("button", { name: "Fix in chat" }))
						.not.toBeInTheDocument();
				}
				await page.getByTestId("git-push-error-close").click();
				expect(onAppendToChat).not.toHaveBeenCalled();
			}
			await expect.element(dialog).not.toBeInTheDocument();
			await expect.element(page.getByTestId("git-action-primary")).toBeEnabled();
		} finally {
			cleanup();
			queryClient.clear();
			sdk.destroy();
			await page.viewport(1280, 800);
		}
	},
);

it("never probes branches for a non-repository workspace", async () => {
	const repositoryType = vi.fn(() => ({ kind: "missing" }) as const);
	const branches = vi.fn(() => ({
		currentBranch: "feature",
		defaultBranch: "main",
		recentBranches: [],
		branches: [],
	}));
	const sdk = createFakeSdk({
		featureId: "git",
		channels: { ...gitContract, ...gitActionsContract },
		handlers: {
			repositoryType,
			status: () => null,
			branches,
			originUrl: () => null,
			workingTreeStats: () => ({ additions: 0, deletions: 0 }),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	try {
		render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<GitActionsControl workspaceDirectory="/tmp/not-a-repo" />
				</QueryClientProvider>
			</SdkProvider>,
		);

		await vi.waitFor(() => expect(repositoryType).toHaveBeenCalled());
		expect(branches).not.toHaveBeenCalled();
	} finally {
		cleanup();
		queryClient.clear();
		sdk.destroy();
	}
});
