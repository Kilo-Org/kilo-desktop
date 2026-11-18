import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";
import { ComposerAction, type ComposerContext } from "@kilo-desktop/plugin-chat/contracts";

import type { GitRepositoryType } from "../../contracts";
import { bootGitHost, type GitHost } from "../../test/git-host";

const WAIT = { timeout: 5_000 };

/** kilo.git's repository in main, over folders the test describes. */
class FakeRepositories {
	readonly folders = new Map<string, { branch: string | null } | "missing">();
	readonly inits: string[] = [];
	failInit = false;

	readonly fake = {
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
	};
}

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

async function renderFooter(
	repositories: FakeRepositories,
	directory: string | null,
): Promise<GitHost> {
	const host = await bootGitHost({ repository: repositories.fake });
	const context: ComposerContext = {
		workSessionId: "wses_1",
		chatId: "ses_a",
		directory,
		workspaceId: "w1",
		workspaceFolders: [{ path: "/projects/app", isPrimary: true }],
	};
	host.render(<FooterSlot context={context} />);
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

		const bare = await renderFooter(repositories, "/projects/bare");
		await vi.waitFor(
			() => expect(bare.calls("repositoryType")).toEqual([{ directory: "/projects/bare" }]),
			WAIT,
		);
		expect(page.getByTestId("git-branch-label").query()).toBeNull();

		await renderFooter(repositories, null);
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
		const host = await renderFooter(repositories, "/wt");
		await expect.element(page.getByTestId("git-branch-label").getByText("kilo/old")).toBeVisible();

		repositories.folders.set("/wt", { branch: "kilo/new" });
		await host.emitBranchRenamed("/elsewhere", "x");
		await host.emitBranchRenamed("/wt", "kilo/new");

		await expect.element(page.getByTestId("git-branch-label").getByText("kilo/new")).toBeVisible();
	});
});

describe("the branch after a checkout", () => {
	it("follows the repository's HEAD as kilo.work-sessions reports it changing", async () => {
		const repositories = new FakeRepositories();
		repositories.folders.set("/projects/app", { branch: "main" });
		const host = await renderFooter(repositories, "/projects/app");
		await expect.element(page.getByTestId("git-branch-label").getByText("main")).toBeVisible();

		repositories.folders.set("/projects/app", { branch: "feature" });
		await host.emitFileChanges("/projects/app", ["/projects/app/.git/HEAD"]);

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
