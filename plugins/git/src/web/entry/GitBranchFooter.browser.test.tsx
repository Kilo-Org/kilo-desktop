import { cleanup, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, type DomainProvider } from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider, useExtensions } from "@kilo-desktop/kernel/web";
import { ComposerAction, type ComposerContext } from "@kilo-desktop/plugin-chat/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { Files, WORKSPACES_DEFINITIONS } from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../../plugin.json";
import { GIT_DEFINITIONS, Repository, type GitRepositoryType } from "../../contracts/index.js";
import { gitWebEntry } from "./index.js";

const WAIT = { timeout: 5_000 };

/** kilo.git's repository in main, over folders the test describes. */
class FakeRepositories {
	readonly folders = new Map<string, { branch: string | null } | "missing">();
	readonly inits: string[] = [];
	failInit = false;
	provider: DomainProvider<typeof Repository> | undefined;

	readonly main = {
		manifest,
		definitions: GIT_DEFINITIONS,
		entry: {
			activate: (sdk: Parameters<NonNullable<typeof gitWebEntry.activate>>[0]) => {
				const unused = () => {
					throw new KernelError("BUSINESS", "unused");
				};
				this.provider = sdk.domains.provide(Repository, {
					initialState: {},
					methods: new Proxy(
						{
							repositoryType: ({ directory }: { directory: string }): GitRepositoryType => {
								const folder = this.folders.get(directory);
								if (folder === "missing") return { kind: "missing" };
								if (!folder) return { kind: "bare" };
								return { kind: "regular", topLevelWorkingDirectory: directory, gitDir: ".git" };
							},
							branches: ({ directory }: { directory: string }) => {
								const folder = this.folders.get(directory);
								if (!folder || folder === "missing") return null;
								return {
									...(folder.branch ? { currentBranch: folder.branch } : {}),
									branches: [],
									recentBranches: [],
								};
							},
							init: ({ directory }: { directory: string }) => {
								if (this.failInit) throw new KernelError("CONFLICT", "permission denied");
								this.inits.push(directory);
								this.folders.set(directory, { branch: "main" });
							},
						},
						{ get: (target, key) => (target as Record<string | symbol, unknown>)[key] ?? unused },
					) as never,
				});
			},
		},
	};
}

const chatPoint = testPlugin("kilo.chat", {
	manifest: { extensionPoints: [{ id: "composer-action", kind: "additive" }] },
	definitions: { extensionPoints: [ComposerAction] },
});

function FooterSlot({ context }: { context: ComposerContext }) {
	const contributions = useExtensions(ComposerAction).filter(
		(contribution) => contribution.metadata.slot === "footer",
	);
	return (
		<>
			{contributions.map((contribution) => {
				const implementation = contribution.implementation;
				if (implementation?.kind !== "view") return null;
				const { Component } = implementation;
				return <Component key={contribution.key} {...context} />;
			})}
		</>
	);
}

/** kilo.workspaces' file changes in main, for the window's repository watcher. */
function fakeWorkspaces() {
	let files: DomainProvider<typeof Files> | undefined;
	return {
		main: {
			manifest: workspacesManifest,
			definitions: WORKSPACES_DEFINITIONS,
			entry: {
				activate: (sdk: Parameters<NonNullable<typeof gitWebEntry.activate>>[0]) => {
					files = sdk.domains.provide(Files, { initialState: { watched: [] }, methods: {} });
				},
			},
		},
		renderer: { manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS },
		changed: (root: string, path: string) =>
			files!.emit("changed", { root, changes: [{ path, type: "update" }] }),
	};
}

async function renderFooter(
	repositories: FakeRepositories,
	directory: string | null,
	workspaces = fakeWorkspaces(),
) {
	cleanup();
	const host = await createTestKernelPair({
		main: [chatPoint, workspaces.main, repositories.main],
		renderer: [
			chatPoint,
			workspaces.renderer,
			{ manifest, definitions: GIT_DEFINITIONS, entry: gitWebEntry },
		],
	});
	const context: ComposerContext = {
		sessionId: "wses_1",
		chatId: "ses_a",
		directory,
		workspaceId: "w1",
		workspaceFolders: [{ path: "/projects/app", isPrimary: true }],
	};
	render(
		<KernelProvider kernel={host.renderer}>
			<FooterSlot context={context} />
			<Toaster />
		</KernelProvider>,
	);
	return host;
}

describe("the branch under a chat's composer", () => {
	it("shows the branch of the folder the chat works in", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/app/.kilo/worktrees/fix", { branch: "kilo/fix" });

		await renderFooter(repositories, "/projects/app/.kilo/worktrees/fix");

		await expect
			.element(page.getByTestId("git-branch-label"))
			.toHaveAttribute("aria-label", "Branch kilo/fix");
	});

	it("says Detached HEAD without a branch, and nothing outside a usable repository", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/app", { branch: null });
		await renderFooter(repositories, "/projects/app");
		await expect
			.element(page.getByTestId("git-branch-label").getByText("Detached HEAD"))
			.toBeVisible();

		await renderFooter(repositories, "/projects/bare");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByTestId("git-branch-label").query()).toBeNull();

		await renderFooter(repositories, null);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByTestId("git-init-thread-button").query()).toBeNull();
	});

	it("initializes a folder that is not a repository, then shows its branch", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/plain", "missing");
		await renderFooter(repositories, "/projects/plain");

		await page.getByTestId("git-init-thread-button").click();

		await vi.waitFor(() => expect(repositories.inits).toEqual(["/projects/plain"]), WAIT);
		await expect.element(page.getByTestId("git-branch-label").getByText("main")).toBeVisible();
	});

	it("says why git could not be initialized", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/plain", "missing");
		repositories.failInit = true;
		await renderFooter(repositories, "/projects/plain");

		await page.getByTestId("git-init-thread-button").click();

		await expect.element(page.getByText("Could not initialize git")).toBeVisible();
		await expect.element(page.getByTestId("git-init-thread-button")).toBeEnabled();
	});

	it("reads the branch again when a worktree's branch is renamed", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/wt", { branch: "kilo/old" });
		await renderFooter(repositories, "/wt");
		await expect.element(page.getByTestId("git-branch-label").getByText("kilo/old")).toBeVisible();

		repositories.folders.set("/wt", { branch: "kilo/new" });
		repositories.provider!.emit("worktree-branch-renamed", {
			directory: "/elsewhere",
			branch: "x",
		});
		repositories.provider!.emit("worktree-branch-renamed", {
			directory: "/wt",
			branch: "kilo/new",
		});

		await expect.element(page.getByTestId("git-branch-label").getByText("kilo/new")).toBeVisible();
	});
});

describe("the branch after a checkout", () => {
	it("follows the repository's HEAD as kilo.workspaces reports it changing", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/app", { branch: "main" });
		const workspaces = fakeWorkspaces();
		await renderFooter(repositories, "/projects/app", workspaces);
		await expect.element(page.getByTestId("git-branch-label").getByText("main")).toBeVisible();

		repositories.folders.set("/projects/app", { branch: "feature" });
		workspaces.changed("/projects/app", "/projects/app/.git/HEAD");

		await expect
			.element(page.getByTestId("git-branch-label").getByText("feature"), WAIT)
			.toBeVisible();
	});

	it("reads the branch again when the window regains focus", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/app", { branch: "main" });
		await renderFooter(repositories, "/projects/app");
		await expect.element(page.getByTestId("git-branch-label").getByText("main")).toBeVisible();

		repositories.folders.set("/projects/app", { branch: "elsewhere" });
		window.dispatchEvent(new Event("focus"));

		await expect
			.element(page.getByTestId("git-branch-label").getByText("elsewhere"), WAIT)
			.toBeVisible();
	});
});
