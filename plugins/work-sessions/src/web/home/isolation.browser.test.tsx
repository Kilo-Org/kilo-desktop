import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PluginSdk } from "@kilo-desktop/kernel";

import {
	NewWorkSessionOption,
	type IsolationOptions,
	type NewWorkSessionOptionProps,
} from "../../contracts";
import { renderWorkSessions, workSession, workspace } from "../../testing";
import { ISOLATION_PREFERENCE_STORAGE_KEY } from "./isolation/isolation-preference";

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
	copies: [{ directory: "/projects/app/.kilo/worktrees/old", name: "old", branch: "kilo/old" }],
};

function renderLauncher(
	options: { isolation?: IsolationOptions | null; localStorage?: Record<string, string> } = {},
) {
	return renderWorkSessions({
		workspaces: [workspace("w-app", "App"), workspace("w-lib", "Lib")],
		activeWorkspaceId: "w-app",
		...options,
	});
}

const modeTrigger = () => page.getByTestId("git-draft-mode-trigger");

describe("launcher isolation", () => {
	it("is not offered without version control or a repository", async () => {
		const withoutVcs = await renderLauncher();
		await expect.element(page.getByTestId("launcher-location")).toBeVisible();
		expect(withoutVcs.workSessions.calls.isolationOptions).not.toHaveBeenCalled();

		const notARepository = await renderLauncher({ isolation: null });
		await vi.waitFor(
			() =>
				expect(notARepository.workSessions.calls.isolationOptions).toHaveBeenCalledWith("w-app"),
			WAIT,
		);
		await notARepository.run("new-empty-work-session");

		await vi.waitFor(
			() =>
				expect(notARepository.workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
				}),
			WAIT,
		);
		expect(page.getByTestId("launcher-isolation").query()).toBeNull();
	});

	it("starts local by default, showing the current branch", async () => {
		const { workSessions, run } = await renderLauncher({ isolation: REPOSITORY });

		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");
		await expect.element(page.getByTestId("git-branch-label")).toHaveTextContent("main");
		await run("new-empty-work-session");

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
	});

	it("starts in a new worktree from the chosen base, and remembers the mode per workspace", async () => {
		const { workSessions, run } = await renderLauncher({ isolation: REPOSITORY });

		await modeTrigger().click();
		await page.getByTestId("git-draft-mode-item-worktree").click();
		await expect
			.element(page.getByTestId("launcher-location"))
			.toHaveTextContent("WorkspaceAppUseNew worktreeBase branchmain");
		await page.getByTestId("git-base-branch-trigger").click();
		await page.getByTestId("git-base-branch-item-develop").click();
		await expect.element(page.getByTestId("git-base-branch-trigger")).toHaveTextContent("develop");
		await run("new-empty-work-session");

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "new-copy", baseBranch: "develop" },
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
		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");

		localStorage.removeItem(ISOLATION_PREFERENCE_STORAGE_KEY);
		await renderLauncher({
			isolation: REPOSITORY,
			localStorage: { "git.draftMode:v1": JSON.stringify("worktree") },
		});

		await expect.element(modeTrigger()).toHaveTextContent("New worktree");
	});

	it("starts in an existing worktree picked from the searchable list", async () => {
		const { workSessions, run } = await renderLauncher({ isolation: REPOSITORY });

		await modeTrigger().click();
		await page.getByTestId("git-draft-mode-sub-existing").click();
		await page.getByTestId("git-draft-mode-existing-search").fill("old");
		await page.getByTestId("git-draft-mode-item-existing-old").click();
		await expect.element(modeTrigger()).toHaveTextContent("old");
		await expect.element(page.getByTestId("git-branch-label")).toHaveTextContent("kilo/old");
		await run("new-empty-work-session");

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "existing-copy", directory: "/projects/app/.kilo/worktrees/old" },
				}),
			WAIT,
		);
	});

	it("keeps the row in place, disabled, while the next workspace's options load", async () => {
		const { workSessions } = await renderLauncher({ isolation: REPOSITORY });
		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");
		const release = workSessions.holdIsolationOptions("w-lib");

		await page.getByTestId("launcher-workspace-selector").click();
		await page.getByRole("option", { name: /Lib/ }).click();

		await vi.waitFor(
			() => expect(workSessions.calls.isolationOptions).toHaveBeenCalledWith("w-lib"),
			WAIT,
		);
		await expect.element(modeTrigger()).toBeDisabled();
		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");
		release();
		await expect.element(modeTrigger()).toBeEnabled();
	});

	it("starts with the next workspace's isolation even before its options show", async () => {
		const { workSessions, run } = await renderLauncher({
			isolation: REPOSITORY,
			localStorage: { [ISOLATION_PREFERENCE_STORAGE_KEY]: JSON.stringify({ "w-lib": "worktree" }) },
		});
		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");
		const release = workSessions.holdIsolationOptions("w-lib");

		await page.getByTestId("launcher-workspace-selector").click();
		await page.getByRole("option", { name: /Lib/ }).click();
		await vi.waitFor(
			() => expect(workSessions.calls.isolationOptions).toHaveBeenCalledWith("w-lib"),
			WAIT,
		);
		const started = run("new-empty-work-session");
		release();
		await started;

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-lib",
					isolation: { kind: "new-copy", baseBranch: "main" },
				}),
			WAIT,
		);
	});

	it("keeps new worktrees off for a repository without commits", async () => {
		await renderLauncher({
			isolation: { ...REPOSITORY, branches: [], currentBranch: null, copies: [] },
			localStorage: { [ISOLATION_PREFERENCE_STORAGE_KEY]: JSON.stringify({ "w-app": "worktree" }) },
		});

		await expect.element(modeTrigger()).toHaveTextContent("Current checkout");
		await modeTrigger().click();
		await expect
			.element(page.getByTestId("git-draft-mode-item-worktree"))
			.toHaveAttribute("data-disabled");
		expect(page.getByTestId("git-draft-mode-sub-existing").query()).toBeNull();
	});
});

/** Contributes a branch picker that reports what it was given and can move the launcher. */
function branchPickerPlugin() {
	const shown = vi.fn<(props: NewWorkSessionOptionProps) => void>();
	return {
		shown,
		plugin: {
			manifest: {
				manifestVersion: 1,
				id: "test.branches",
				displayName: "Branches",
				version: "1.0.0",
				contributes: {
					extensions: {
						"kilo.work-sessions/new-work-session-option": [{ id: "branch", slot: "branch" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(
						NewWorkSessionOption,
						"branch",
						(props: NewWorkSessionOptionProps) => {
							shown(props);
							return (
								<button
									type="button"
									data-qa-id="test-branch-picker"
									onClick={() =>
										props.onIsolationChange({
											kind: "existing-copy",
											directory: "/projects/app/.kilo/worktrees/old",
										})
									}
								>
									{props.directory}
								</button>
							);
						},
					);
				},
			},
		},
	};
}

describe("a contributed branch picker", () => {
	it("takes the read-only branch's place for the checkout and existing worktrees", async () => {
		const picker = branchPickerPlugin();
		const { workSessions, run } = await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
			isolation: REPOSITORY,
			guests: [picker.plugin, setupOptionPlugin().plugin],
		});

		await expect.element(page.getByTestId("test-branch-picker")).toHaveTextContent("/projects/app");
		expect(page.getByTestId("git-branch-label").query()).toBeNull();
		// A repository has something to choose, so a `setup` option stays out of the way.
		expect(page.getByTestId("test-setup").query()).toBeNull();
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
		await run("new-empty-work-session");

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "existing-copy", directory: "/projects/app/.kilo/worktrees/old" },
				}),
			WAIT,
		);
	});

	it("is not shown for a new worktree", async () => {
		await renderWorkSessions({
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

/** Contributes a setup option that reports what it was given and says the page changed. */
function setupOptionPlugin() {
	const shown = vi.fn<(props: NewWorkSessionOptionProps) => void>();
	return {
		shown,
		plugin: {
			manifest: {
				manifestVersion: 1,
				id: "test.setup",
				displayName: "Setup",
				version: "1.0.0",
				contributes: {
					extensions: {
						"kilo.work-sessions/new-work-session-option": [{ id: "setup", slot: "setup" }],
					},
				},
			},
			web: {
				activate(sdk: PluginSdk) {
					sdk.extensions.implement(
						NewWorkSessionOption,
						"setup",
						(props: NewWorkSessionOptionProps) => {
							shown(props);
							return (
								<button type="button" data-qa-id="test-setup" onClick={props.onChanged}>
									Set up {props.directory}
								</button>
							);
						},
					);
				},
			},
		},
	};
}

describe("a contributed setup option", () => {
	it("shows for a workspace with nothing to choose, and reads the options again once used", async () => {
		const setup = setupOptionPlugin();
		const { workSessions } = await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
			isolation: null,
			guests: [setup.plugin],
		});

		await expect.element(page.getByTestId("test-setup")).toHaveTextContent("Set up /projects/app");
		expect(setup.shown).toHaveBeenLastCalledWith(
			expect.objectContaining({
				workspaceId: "w-app",
				repositoryDirectory: "/projects/app",
				directory: "/projects/app",
			}),
		);
		const reads = workSessions.calls.isolationOptions.mock.calls.length;

		await page.getByTestId("test-setup").click();

		await vi.waitFor(
			() => expect(workSessions.calls.isolationOptions.mock.calls.length).toBeGreaterThan(reads),
			WAIT,
		);
	});
});

describe("deleting a worktree session", () => {
	const worktreeSession = workSession("a", {
		title: "Fix login",
		directory: "/projects/app/.kilo/worktrees/fix",
		branch: "kilo/fix",
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
		const { workSessions } = await renderWorkSessions({ workSessions: [worktreeSession] });

		await askToDelete();
		await expect
			.element(page.getByTestId("session-delete-worktree-items").getByText("kilo/fix"))
			.toBeVisible();
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => expect(workSessions.calls.removeCopy).toHaveBeenCalledWith("a"), WAIT);
		await expect
			.element(page.getByText("Branch kilo/fix and its worktree were removed."))
			.toBeVisible();
	});

	it("keeps the worktree when asked", async () => {
		const { workSessions } = await renderWorkSessions({ workSessions: [worktreeSession] });

		await askToDelete();
		await page.getByTestId("session-delete-keep-worktree").click();

		await vi.waitFor(() => expect(workSessions.calls.remove).toHaveBeenCalledWith("a"), WAIT);
		expect(workSessions.calls.removeCopy).not.toHaveBeenCalled();
	});

	it("says why a worktree could not be removed", async () => {
		await renderWorkSessions({ workSessions: [worktreeSession], copyError: "worktree is locked" });

		await askToDelete();
		await page.getByTestId("session-delete-worktree-confirm").click();

		await expect.element(page.getByText("Could not remove worktree")).toBeVisible();
		await expect.element(page.getByText("worktree is locked")).toBeVisible();
	});

	it("asks the plain question when another session shares the worktree", async () => {
		await renderWorkSessions({
			workSessions: [
				worktreeSession,
				workSession("b", { title: "Other", directory: "/projects/app/.kilo/worktrees/fix" }),
			],
		});

		await askToDelete();

		await expect.element(page.getByTestId("session-delete-dialog")).toBeVisible();
		expect(page.getByTestId("session-delete-worktree-dialog").query()).toBeNull();
	});
});
