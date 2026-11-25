import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { expect, type Locator } from "@playwright/test";

import { kiloServer } from "../../utils/kilo-server.js";
import {
	kiloServerConnection,
	openNewSession,
	openNewSessionInNewWorkspace,
	renameWorkSession,
	sessionListRow,
	shownAgentSessionId,
	verifyNewSessionIn,
	type KiloServerConnection,
} from "../chat/agent-session.js";
import { sessionListData } from "../../testdata/work-sessions/session-list.js";

const SESSION_LIST = sessionListData.locators;

const execFile = promisify(execFileCallback);

/** Worktree creation, git's own bookkeeping and the Kilo server's session list, on a cold CI runner. */
const WORKTREE_TIMEOUT_MS = 30_000;

type KiloSession = { id: string; directory?: string };

/** The Work Session a first send started, and the folder its chat works in. */
export interface StartedWorktreeSession {
	readonly title: string;
	readonly directory: string;
}

/** A worktree as git lists it (`git worktree list --porcelain`). */
interface GitWorktree {
	readonly directory: string;
	readonly branch: string | undefined;
}

/**
 * Worktree isolation for new work sessions: the New Session page's isolation
 * control (kilo.work-sessions, over its `vcs` point, which kilo.git fills
 * with worktrees), and deleting the last work session in a worktree. The on-disk state
 * is read straight from the repository (the e2e runs on the app's machine).
 */
export class WorktreesPage {
	// --- Locators ---

	private readonly isolation = () =>
		getLocatorByTestId("launcher-location").getByTestId("launcher-isolation");
	private readonly modeTrigger = () => this.isolation().getByTestId("git-draft-mode-trigger");
	// The session list's own locators, from its centralized definitions.
	private readonly rowMore = (row: Locator): Locator =>
		row.getByTestId(SESSION_LIST.itemMoreTestId);
	private readonly menuDelete = () => getLocatorByTestId(SESSION_LIST.menuDeleteTestId);
	private readonly deleteWorktreeDialog = () =>
		getLocatorByTestId(SESSION_LIST.deleteWorktreeDialogTestId);
	private readonly deleteWorktreeConfirm = () =>
		getLocatorByTestId(SESSION_LIST.deleteWorktreeConfirmTestId);

	// --- Steps and assertions ---

	/** The New Session page in a new workspace for the repository. */
	async openNewSession(repoPath: string, name: string): Promise<void> {
		// New session from an open session starts in that session's workspace,
		// so the workspace is activated once the New Session page is showing.
		await openNewSessionInNewWorkspace(repoPath, name);
		await this.verifyIsolationOffered();
	}

	/** The New Session page again, from a session in the same workspace. */
	async openAnotherNewSession(name: string): Promise<void> {
		await openNewSession();
		await verifyNewSessionIn(name);
		await this.verifyIsolationOffered();
	}

	private async verifyIsolationOffered(): Promise<void> {
		await expectElementToBeVisible(
			this.modeTrigger(),
			"A repository with commits should offer where the session works",
		);
	}

	async chooseLocal(): Promise<void> {
		await click(this.modeTrigger());
		await click(getLocatorByTestId("git-draft-mode-item-local"));
		await expectElementToContainText(this.modeTrigger(), "Local repository", {
			message: "The isolation control should show the current checkout",
		});
	}

	async chooseNewWorktree(): Promise<void> {
		await click(this.modeTrigger());
		await click(getLocatorByTestId("git-draft-mode-item-worktree"));
		await expectElementToContainText(this.modeTrigger(), "New worktree", {
			message: "The isolation control should show New worktree",
		});
	}

	async chooseExistingWorktree(name: string): Promise<void> {
		await click(this.modeTrigger());
		await click(getLocatorByTestId("git-draft-mode-sub-existing"));
		await click(getLocatorByTestId(`git-draft-mode-item-existing-${name}`));
		await expectElementToContainText(this.modeTrigger(), name, {
			message: `The isolation control should show the existing worktree "${name}"`,
		});
	}

	/** Local sessions work on the checkout, so kilo.git's branch picker shows its branch. */
	async verifyLocalShowsBranchPicker(branch: string): Promise<void> {
		await expectElementToContainText(
			this.isolation().getByTestId("git-branch-selector-trigger"),
			branch,
			{ message: `The branch picker should show the checkout's branch "${branch}"` },
		);
	}

	/**
	 * Sends the starter's first message, which places the session (creating
	 * its worktree) and starts its chat, then names the session `title` so its
	 * row can be found.
	 */
	async startSession(title: string): Promise<StartedWorktreeSession> {
		const connection = await kiloServerConnection();
		const knownIds = new Set((await this.kiloSessions(connection)).map((session) => session.id));
		await fill(getLocatorByRole("textbox", { name: "Message input" }), title);
		await click(getLocatorByTestId("kilo-composer-send"));
		await expectElementToBeHidden(getLocatorByTestId("launcher-isolation-progress"), {
			message: "Creating the worktree should finish",
			timeout: WORKTREE_TIMEOUT_MS,
		});
		const workSessionId = await shownAgentSessionId();
		let directory: string | undefined;
		await expect
			.poll(
				async () => {
					const created = (await this.kiloSessions(connection)).find(
						(session) => !knownIds.has(session.id) && session.directory,
					);
					directory = created?.directory;
					return directory;
				},
				{
					message: `The chat started by "${title}" should reach the Kilo server with its folder`,
					timeout: WORKTREE_TIMEOUT_MS,
				},
			)
			.toBeTruthy();
		// Deleting a session while its first turn is still running is not what this covers.
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-agent-pane").locator('[data-role="assistant"]'),
			{ message: `The mock model should answer "${title}"`, timeout: WORKTREE_TIMEOUT_MS },
		);
		await renameWorkSession(workSessionId, title);
		await expectElementToBeVisible(sessionListRow(title), `"${title}" should be listed`);
		return { title, directory: path.normalize(directory!) };
	}

	/** The session works in a new worktree under `.kilo/worktrees/`, on a `kilo/` branch. */
	async verifyWorksInNewWorktree(
		repoPath: string,
		session: StartedWorktreeSession,
	): Promise<GitWorktree> {
		const managedRoot = path.join(repoPath, ".kilo", "worktrees") + path.sep;
		expect(
			session.directory.startsWith(managedRoot),
			`The session should work under ${managedRoot}, not ${session.directory}`,
		).toBe(true);
		const worktree = (await this.worktrees(repoPath)).find(
			(entry) => entry.directory === session.directory,
		);
		expect(worktree, `git should list ${session.directory} as a worktree`).toBeDefined();
		expect(worktree!.branch, "The worktree's branch should carry the kilo/ prefix").toMatch(
			/^kilo\//,
		);
		return worktree!;
	}

	async verifyWorksIn(session: StartedWorktreeSession, directory: string): Promise<void> {
		expect(session.directory, `"${session.title}" should work in ${directory}`).toBe(directory);
	}

	async verifyWorktreeCount(repoPath: string, count: number): Promise<void> {
		const managed = (await this.worktrees(repoPath)).filter((entry) =>
			entry.directory.startsWith(path.join(repoPath, ".kilo", "worktrees") + path.sep),
		);
		expect(managed, `The repository should have ${count} session worktree(s)`).toHaveLength(count);
	}

	/** Deletes the last session in its worktree from the row menu, choosing to delete both. */
	async deleteSessionAndWorktree(title: string): Promise<void> {
		const row = sessionListRow(title);
		await row.hover();
		await click(this.rowMore(row));
		await click(this.menuDelete());
		await expectElementToBeVisible(
			this.deleteWorktreeDialog(),
			"Deleting the last session in a worktree should ask about the worktree",
		);
		await click(this.deleteWorktreeConfirm());
		await expectElementToBeHidden(row, { message: `"${title}" should leave the session list` });
	}

	/** The worktree folder and its `kilo/` branch are gone from the repository. */
	async verifyWorktreeRemoved(repoPath: string, worktree: GitWorktree): Promise<void> {
		await expect
			.poll(
				async () =>
					(await this.worktrees(repoPath)).some((entry) => entry.directory === worktree.directory),
				{
					message: `git should no longer list ${worktree.directory}`,
					timeout: WORKTREE_TIMEOUT_MS,
				},
			)
			.toBe(false);
		await expect
			.poll(async () => (await this.localBranches(repoPath)).includes(worktree.branch!), {
				message: `The worktree's branch ${worktree.branch} should be deleted`,
				timeout: WORKTREE_TIMEOUT_MS,
			})
			.toBe(false);
	}

	private async kiloSessions(connection: KiloServerConnection): Promise<KiloSession[]> {
		return kiloServer.rootSessions(connection);
	}

	/** Git for Windows writes forward-slash paths; normalized to compare with OS-native ones. */
	private async worktrees(repoPath: string): Promise<GitWorktree[]> {
		const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
			cwd: repoPath,
		});
		return stdout
			.split(/\r?\n\r?\n/)
			.map((block) => block.split(/\r?\n/))
			.filter((lines) => lines[0]?.startsWith("worktree "))
			.map((lines) => ({
				directory: path.normalize(lines[0]!.slice("worktree ".length)),
				branch: lines
					.find((line) => line.startsWith("branch "))
					?.slice("branch refs/heads/".length),
			}));
	}

	private async localBranches(repoPath: string): Promise<string[]> {
		const { stdout } = await execFile(
			"git",
			["for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{ cwd: repoPath },
		);
		return stdout.split(/\r?\n/).filter(Boolean);
	}
}
