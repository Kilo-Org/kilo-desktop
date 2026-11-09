import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PluginSdk } from "@kilo-desktop/kernel";
import type { IsolationOptions } from "@kilo-desktop/plugin-sessions/contracts";

import { renderWorkbench, session, workspace } from "../test/fakes";
import { LauncherOption, type LauncherOptionProps } from "../contracts";
import { ISOLATION_PREFERENCE_STORAGE_KEY } from "./home/isolation/isolation-preference";

const WAIT = { timeout: 5_000 };

const REPOSITORY: IsolationOptions = {
	directory: "/projects/app",
	currentBranch: "main",
	defaultBranch: "main",
	branches: [
		{ name: "main", kind: "local", ref: "refs/heads/main", upstream: null },
		{ name: "develop", kind: "local", ref: "refs/heads/develop", upstream: null },
	],
	recentBranches: ["develop"],
	worktrees: [{ directory: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old" }],
};

function renderLauncher(
	options: { isolation?: IsolationOptions | null; localStorage?: Record<string, string> } = {},
) {
	return renderWorkbench({
		workspaces: [workspace("w-app", "App"), workspace("w-lib", "Lib")],
		activeWorkspaceId: "w-app",
		...options,
	});
}

const modeTrigger = () => page.getByTestId("git-draft-mode-trigger");

describe("launcher isolation", () => {
	it("is not offered without version control or a repository", async () => {
		const withoutVcs = await renderLauncher();
		await expect.element(page.getByTestId("launcher-start-session")).toBeVisible();
		expect(withoutVcs.sessions.calls.isolationOptions).not.toHaveBeenCalled();

		const notARepository = await renderLauncher({ isolation: null });
		await vi.waitFor(
			() => expect(notARepository.sessions.calls.isolationOptions).toHaveBeenCalledWith("w-app"),
			WAIT,
		);
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(
			() =>
				expect(notARepository.sessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" }),
			WAIT,
		);
		expect(page.getByTestId("launcher-isolation").query()).toBeNull();
	});

	it("starts local by default, showing the current branch", async () => {
		const { sessions } = await renderLauncher({ isolation: REPOSITORY });

		await expect.element(modeTrigger()).toHaveTextContent("Local");
		await expect.element(page.getByTestId("git-branch-label")).toHaveTextContent("main");
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
	});

	it("starts in a new worktree from the chosen base, and remembers the mode per workspace", async () => {
		const { sessions } = await renderLauncher({ isolation: REPOSITORY });

		await modeTrigger().click();
		await page.getByTestId("git-draft-mode-item-worktree").click();
		await expect
			.element(page.getByTestId("git-base-branch-trigger"))
			.toHaveTextContent("From main");
		await page.getByTestId("git-base-branch-trigger").click();
		await page.getByTestId("git-base-branch-item-develop").click();
		await expect
			.element(page.getByTestId("git-base-branch-trigger"))
			.toHaveTextContent("From develop");
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "new-worktree", baseBranch: "develop" },
				}),
			WAIT,
		);
		expect(JSON.parse(localStorage.getItem(ISOLATION_PREFERENCE_STORAGE_KEY)!)).toEqual({
			"w-app": "worktree",
		});
	});

	it("starts from the remembered mode, or origin's when a workspace has none", async () => {
		await renderLauncher({
			isolation: REPOSITORY,
			localStorage: {
				[ISOLATION_PREFERENCE_STORAGE_KEY]: JSON.stringify({ "w-app": "local" }),
				"git.draftMode:v1": JSON.stringify("worktree"),
			},
		});
		await expect.element(modeTrigger()).toHaveTextContent("Local");

		localStorage.removeItem(ISOLATION_PREFERENCE_STORAGE_KEY);
		await renderLauncher({
			isolation: REPOSITORY,
			localStorage: { "git.draftMode:v1": JSON.stringify("worktree") },
		});

		await expect.element(modeTrigger()).toHaveTextContent("New worktree");
	});

	it("starts in an existing worktree picked from the searchable list", async () => {
		const { sessions } = await renderLauncher({ isolation: REPOSITORY });

		await modeTrigger().click();
		await page.getByTestId("git-draft-mode-sub-existing").click();
		await page.getByTestId("git-draft-mode-existing-search").fill("old");
		await page.getByTestId("git-draft-mode-item-existing-old").click();
		await expect.element(modeTrigger()).toHaveTextContent("old");
		await expect.element(page.getByTestId("git-branch-label")).toHaveTextContent("kilo/old");
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "existing-worktree", directory: "/projects/app/.kilo/worktrees/old" },
				}),
			WAIT,
		);
	});

	it("keeps new worktrees off for a repository without commits", async () => {
		await renderLauncher({
			isolation: { ...REPOSITORY, branches: [], currentBranch: null, worktrees: [] },
			localStorage: { [ISOLATION_PREFERENCE_STORAGE_KEY]: JSON.stringify({ "w-app": "worktree" }) },
		});

		await expect.element(modeTrigger()).toHaveTextContent("Local");
		await modeTrigger().click();
		await expect
			.element(page.getByTestId("git-draft-mode-item-worktree"))
			.toHaveAttribute("data-disabled");
		expect(page.getByTestId("git-draft-mode-sub-existing").query()).toBeNull();
	});
});

/** Contributes a branch picker that reports what it was given and can move the launcher. */
function branchPickerPlugin() {
	const shown = vi.fn<(props: LauncherOptionProps) => void>();
	return {
		shown,
		plugin: {
			manifest: {
				manifestVersion: 1,
				id: "test.branches",
				displayName: "Branches",
				version: "1.0.0",
				contributes: {
					extensions: { "kilo.workbench/launcher-option": [{ id: "branch", slot: "branch" }] },
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(LauncherOption, "branch", (props: LauncherOptionProps) => {
						shown(props);
						return (
							<button
								type="button"
								data-qa-id="test-branch-picker"
								onClick={() =>
									props.onIsolationChange({
										kind: "existing-worktree",
										directory: "/projects/app/.kilo/worktrees/old",
									})
								}
							>
								{props.directory}
							</button>
						);
					});
				},
			},
		},
	};
}

describe("a contributed branch picker", () => {
	it("takes the read-only branch's place for the checkout and existing worktrees", async () => {
		const picker = branchPickerPlugin();
		const { sessions } = await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
			isolation: REPOSITORY,
			guests: [picker.plugin],
		});

		await expect.element(page.getByTestId("test-branch-picker")).toHaveTextContent("/projects/app");
		expect(page.getByTestId("git-branch-label").query()).toBeNull();
		expect(picker.shown).toHaveBeenLastCalledWith(
			expect.objectContaining({
				workspaceId: "w-app",
				repositoryDirectory: "/projects/app",
				disabled: false,
			}),
		);

		await page.getByTestId("test-branch-picker").click();
		await expect.element(modeTrigger()).toHaveTextContent("old");
		await expect
			.element(page.getByTestId("test-branch-picker"))
			.toHaveTextContent("/projects/app/.kilo/worktrees/old");
		await page.getByTestId("launcher-start-session").click();

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "existing-worktree", directory: "/projects/app/.kilo/worktrees/old" },
				}),
			WAIT,
		);
	});

	it("is not shown for a new worktree", async () => {
		await renderWorkbench({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
			isolation: REPOSITORY,
			guests: [branchPickerPlugin().plugin],
			localStorage: { [ISOLATION_PREFERENCE_STORAGE_KEY]: JSON.stringify({ "w-app": "worktree" }) },
		});

		await expect.element(page.getByTestId("git-base-branch-trigger")).toBeVisible();
		expect(page.getByTestId("test-branch-picker").query()).toBeNull();
	});
});

describe("deleting a worktree session", () => {
	const worktreeSession = session("a", {
		title: "Fix login",
		directory: "/projects/app/.kilo/worktrees/fix",
		worktreeBranch: "kilo/fix",
	});
	const row = () =>
		page
			.getByTestId("kilo-thread-list")
			.getByTestId(/^session-list-(archived-)?item$/)
			.filter({ hasText: "Fix login" });
	const askToDelete = async () => {
		await row().hover();
		await row().getByTestId("session-list-item-more").click();
		await page.getByTestId("session-menu-delete").click();
	};

	it("offers to keep or delete the worktree of its last session", async () => {
		const { sessions } = await renderWorkbench({ sessions: [worktreeSession] });

		await askToDelete();
		await expect
			.element(page.getByTestId("session-delete-worktree-items").getByText("kilo/fix"))
			.toBeVisible();
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => expect(sessions.calls.removeWorktree).toHaveBeenCalledWith("a"), WAIT);
		await expect
			.element(page.getByText("Branch kilo/fix and its worktree were removed."))
			.toBeVisible();
	});

	it("keeps the worktree when asked", async () => {
		const { sessions } = await renderWorkbench({ sessions: [worktreeSession] });

		await askToDelete();
		await page.getByTestId("session-delete-keep-worktree").click();

		await vi.waitFor(() => expect(sessions.calls.remove).toHaveBeenCalledWith("a"), WAIT);
		expect(sessions.calls.removeWorktree).not.toHaveBeenCalled();
	});

	it("says why a worktree could not be removed", async () => {
		await renderWorkbench({ sessions: [worktreeSession], worktreeError: "worktree is locked" });

		await askToDelete();
		await page.getByTestId("session-delete-worktree-confirm").click();

		await expect.element(page.getByText("Could not remove worktree")).toBeVisible();
		await expect.element(page.getByText("worktree is locked")).toBeVisible();
	});

	it("asks the plain question when another session shares the worktree", async () => {
		await renderWorkbench({
			sessions: [
				worktreeSession,
				session("b", { title: "Other", directory: "/projects/app/.kilo/worktrees/fix" }),
			],
		});

		await askToDelete();

		await expect.element(page.getByTestId("session-delete-dialog")).toBeVisible();
		expect(page.getByTestId("session-delete-worktree-dialog").query()).toBeNull();
	});
});
