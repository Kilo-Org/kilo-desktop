import { execFile as execFileCallback } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

const execFile = promisify(execFileCallback);

type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
	version: string;
	globalDirectory: string;
};

type KiloSession = {
	id: string;
	directory?: string;
	metadata?: {
		"kilo-desktop"?: {
			worktree?: { branch?: string };
		};
	};
};

/** The desktopApi invoke result shape exposed by the e2e preload. */
type DesktopGlobal = typeof globalThis & {
	desktopApi: {
		invoke(
			channel: "feature:invoke",
			input: { featureId: string; channel: string; args?: unknown },
		): Promise<
			{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
		>;
	};
};

/**
 * Git-worktree chat lifecycle page object: drives the draft footer's git
 * menus and first sends, and verifies the on-disk worktree state straight
 * from the repository (the e2e runs on the same machine as the app). The
 * draft default is local mode; tests that need worktree must call
 * switchToWorktreeMode() before sending.
 */
export class GitWorktreesPage {
	async createWorkspace(folderPath: string, name: string): Promise<void> {
		const response = await getPage().evaluate(
			async ({ folderPath, name }) => {
				const result = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId: "kilo-ui",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				return result;
			},
			{ folderPath, name },
		);
		if (!response.ok) {
			throw new Error(`[${response.error.code}] ${response.error.message}`);
		}
	}

	/** Opens a fresh draft scoped to the named workspace. */
	async openNewDraftForWorkspace(workspaceName: string): Promise<void> {
		const page = getPage();
		await page.evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await page.getByTestId("kilo-chat-thread").waitFor({ state: "visible" });
		await page.locator('[data-slot="aui_thread-list-new"]').click();
		await page.getByRole("combobox", { name: "Select workspace" }).click();
		await page.getByText(workspaceName, { exact: true }).click();
	}

	async switchToLocalMode(): Promise<void> {
		const page = getPage();
		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-item-local").click();
	}

	async switchToWorktreeMode(): Promise<void> {
		const page = getPage();
		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-item-worktree").click();
	}

	/** The local mode keeps the checkout branch selector with the current branch. */
	async assertLocalModeShowsBranchSelector(currentBranch: string): Promise<void> {
		await expect
			.poll(() => getPage().getByTestId("git-branch-selector-trigger").textContent())
			.toContain(currentBranch);
	}

	/** Sends the first message and resolves the newly created session. */
	async sendFirstMessage(text: string): Promise<KiloSession> {
		const page = getPage();
		const connection = await this.getConnection();
		const existingSessionIds = (await this.listSessions(connection)).map((session) => session.id);
		await page.getByRole("textbox", { name: "Message input" }).fill(text);
		await page.getByRole("button", { name: "Send message" }).click();

		let createdSession: KiloSession | undefined;
		await expect
			.poll(
				async () => {
					createdSession = (await this.listSessions(connection)).find(
						(session) => !existingSessionIds.includes(session.id),
					);
					return createdSession?.directory;
				},
				{ timeout: 30_000 },
			)
			.toBeTruthy();
		return createdSession!;
	}

	/** Asserts the session runs in a fresh managed worktree and returns its on-disk facts. */
	async assertWorktreeSession(
		repoPath: string,
		session: KiloSession,
	): Promise<{ directory: string; branch: string }> {
		const directory = session.directory ?? "";
		if (!directory.includes(`${path.sep}.kilo${path.sep}worktrees${path.sep}`)) {
			throw new Error(`Expected a managed worktree directory, got ${directory}.`);
		}
		const branch = session.metadata?.["kilo-desktop"]?.worktree?.branch;
		if (!branch?.startsWith("kilo/")) {
			throw new Error(`Expected a kilo/ worktree branch stamp, got ${branch ?? "none"}.`);
		}

		const listing = await this.git(repoPath, ["worktree", "list", "--porcelain"]);
		const worktreePaths = await this.listWorktreePaths(repoPath);
		if (!worktreePaths.includes(path.normalize(directory))) {
			throw new Error(`Expected the session directory registered as a worktree:\n${listing}`);
		}
		const branches = await this.git(repoPath, ["branch", "--list", "kilo/*"]);
		if (!branches.split("\n").some((line) => line.trim().replace(/^[*+]\s+/, "") === branch)) {
			throw new Error(`Expected branch ${branch} in the repository, got:\n${branches}`);
		}
		return { directory, branch };
	}

	/** The active composer footer labels this thread as a worktree session. */
	async assertComposerShowsWorktreeMode(): Promise<void> {
		await expect
			.poll(() => getPage().getByTestId("kilo-composer-session-mode").textContent(), {
				timeout: 30_000,
			})
			.toContain("Worktree");
	}

	/**
	 * Deletes the workspace-scoped session through the row menu and confirms
	 * the worktree dialog. Filters the list first so leftover sessions from
	 * the shared worker app cannot steal `.first()`.
	 */
	async deleteSessionViaRowMenu(workspaceName: string): Promise<void> {
		const page = getPage();
		await this.assertComposerShowsWorktreeMode();
		await page.getByRole("combobox", { name: "Filter by workspace" }).click();
		await page.getByRole("option", { name: workspaceName }).click();
		const row = page
			.getByRole("listitem")
			.filter({ has: page.locator('[data-slot="aui_session-list-item"]') });
		await row.waitFor({ state: "visible" });
		await row.hover();
		await row.getByRole("button", { name: "Thread actions" }).click({ force: true });
		await page.getByRole("menuitem", { name: "Delete" }).click();
		await page.getByTestId("session-delete-worktree-dialog").waitFor({ state: "visible" });
		await page.getByTestId("session-delete-worktree-confirm").click();
		await page.getByTestId("session-delete-worktree-dialog").waitFor({ state: "hidden" });
	}

	/** The worktree directory and its branch are gone from the repository. */
	async assertWorktreeRemoved(repoPath: string, directory: string, branch: string): Promise<void> {
		await expect
			.poll(
				async () => {
					const worktreePaths = await this.listWorktreePaths(repoPath);
					return worktreePaths.includes(path.normalize(directory));
				},
				{ timeout: 30_000 },
			)
			.toBe(false);
		await expect
			.poll(
				async () => {
					const branches = await this.git(repoPath, ["branch", "--list", "kilo/*"]);
					return branches
						.split("\n")
						.some((line) => line.trim().replace(/^[*+]\s+/, "") === branch);
				},
				{ timeout: 30_000 },
			)
			.toBe(false);
	}

	private async listWorktreePaths(repoPath: string): Promise<string[]> {
		const listing = await this.git(repoPath, ["worktree", "list", "--porcelain"]);
		// Git for Windows writes forward-slash paths; normalize before comparing
		// against the OS-native session directory.
		return listing
			.split("\n")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => path.normalize(line.slice("worktree ".length)));
	}

	private async git(repoPath: string, args: string[]): Promise<string> {
		const { stdout } = await execFile("git", args, { cwd: repoPath });
		return stdout;
	}

	private async getConnection(): Promise<KiloConnection> {
		const value = await getPage().evaluate(async () => {
			const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
				featureId: "kilo-server",
				channel: "server.getConnection",
			});
			if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			return response.value as KiloConnection;
		});
		return value;
	}

	private async listSessions(connection: KiloConnection): Promise<KiloSession[]> {
		return getPage().evaluate(async (currentConnection) => {
			const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
			const response = await fetch(
				`${currentConnection.baseUrl}/experimental/session?roots=true&archived=true`,
				{ headers: { Authorization: authorization }, cache: "no-store" },
			);
			if (!response.ok) throw new Error(`Global session list failed with ${response.status}.`);
			return (await response.json()) as KiloSession[];
		}, connection);
	}
}

/** Initializes a git repository on `main` with one commit for the smoke. */
export async function initializeGitRepository(repoPath: string): Promise<void> {
	const git = (args: string[]) => execFile("git", args, { cwd: repoPath });
	await git(["init", "-b", "main"]);
	await git(["config", "user.email", "e2e@example.com"]);
	await git(["config", "user.name", "Anaconda E2E"]);
	await writeFile(path.join(repoPath, "README.md"), "# git worktree smoke repository\n");
	await git(["add", "."]);
	await git(["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
}
