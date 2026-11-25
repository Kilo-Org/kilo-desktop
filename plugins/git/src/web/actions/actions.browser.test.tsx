import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { RenderContribution } from "@kilo-desktop/kernel/web";
import {
	WorkSessionAction,
	WorkSessionDecoration,
	type WorkSession,
	type WorkSessionActionProps,
	type WorkSessionDecorationProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHANGES_PANE_KIND, type GitStatus, type PullRequest } from "../../contracts";
import { actionCollaborators, PREFERRED_MODEL } from "../../test/actions-host";
import {
	bootGitHost,
	resetViewTestDom,
	ROOT,
	workSession,
	type GitHost,
	type GitHostOptions,
	type RepositoryFake,
} from "../../test/git-host";

afterEach(resetViewTestDom);

const WAIT = { timeout: 5_000 };
const SESSION = workSession("wses_1");

function status(patch: Partial<GitStatus> = {}): GitStatus {
	return {
		exists: true,
		doConflictedFilesExist: false,
		currentBranch: "feature",
		workingDirectory: { files: [{ path: "a.txt", status: { kind: "Modified" } }] },
		...patch,
	} as GitStatus;
}

const regular = () => ({
	kind: "regular" as const,
	topLevelWorkingDirectory: ROOT,
	gitDir: ".git",
});
const branchesOn = (currentBranch: string, defaultBranch = "main") => ({
	currentBranch,
	defaultBranch,
	branches: [],
	recentBranches: [],
});

function repository(patch: RepositoryFake = {}): RepositoryFake {
	return {
		status: () => status(),
		repositoryType: regular,
		branches: () => branchesOn("feature"),
		originUrl: () => null,
		workingTreeStats: () => ({ additions: 3, deletions: 1 }),
		fetch: () => undefined,
		stageChanges: () => ({ statusSummary: "M a.txt", diffPatch: "+a", recentCommitSubjects: [] }),
		commit: () => undefined,
		push: () => undefined,
		githubCliStatus: () => ({ status: "ready" as const }),
		pullRequestContext: () => ({
			commitSummary: "",
			diffSummary: "",
			diffPatch: "",
			recentCommitSubjects: [],
			pullRequestTemplate: null,
		}),
		...patch,
	};
}

function Header({ host, shown = SESSION }: { host: GitHost; shown?: WorkSession }) {
	const action = host.renderer.extensions
		.list(WorkSessionAction)
		.find((contribution) => contribution.key === "kilo.git/repository-actions")!;
	const badge = host.renderer.extensions
		.list(WorkSessionDecoration)
		.find((contribution) => contribution.metadata.slot === "row")!;
	return (
		<>
			<RenderContribution<WorkSessionActionProps>
				contribution={action}
				props={{ workSession: shown }}
			/>
			<div data-qa-id="row">
				<RenderContribution<WorkSessionDecorationProps>
					contribution={badge}
					props={{ workSession: shown }}
				/>
			</div>
		</>
	);
}

async function renderActions(
	repositoryFake: RepositoryFake,
	options: Pick<GitHostOptions, "pullRequests" | "activeWorkSessionId" | "openPane"> = {},
) {
	const peers = actionCollaborators();
	const host = await bootGitHost({
		repository: repositoryFake,
		...peers.options,
		...options,
	});
	peers.consent(host);
	host.render(<Header host={host} />);
	return { host, ...peers };
}

const primary = () => page.getByTestId("git-action-primary");

describe("the open work session's repository actions", () => {
	it("sit before the pane controls in the work session header", async () => {
		const host = await bootGitHost();
		const action = host.renderer.extensions
			.list(WorkSessionAction)
			.find((contribution) => contribution.key === "kilo.git/repository-actions");

		expect(action?.metadata).toEqual({ placement: "start" });
	});

	it("commit with Kilo's generated message, tracked without its content", async () => {
		const { host, generated, commitMessages, tracked } = await renderActions(repository());

		await expect.element(primary()).toHaveTextContent("Commit");
		await primary().click();

		await vi.waitFor(
			() => expect(host.calls("commit")).toEqual([{ directory: ROOT, message: "Fix the login" }]),
			WAIT,
		);
		expect(commitMessages).toEqual([ROOT]);
		expect(generated).toEqual([]);
		await vi.waitFor(
			() => expect(tracked()).toEqual([["kilo.git/commit-message-generated", {}]]),
			WAIT,
		);
	});

	it("show the changed files, explain them on hover and open the Changes pane in its own tab group", async () => {
		const openPane = vi.fn();
		await renderActions(repository(), { openPane });

		const summary = page.getByTestId("git-open-changes-summary");
		await expect.element(summary.getByText("+3")).toBeVisible();
		await summary.hover();
		await expect
			.element(page.getByText("Approximate changes since the last commit."))
			.toBeVisible();
		await summary.click();

		await vi.waitFor(
			() => expect(openPane).toHaveBeenCalledWith({ kind: CHANGES_PANE_KIND, placement: "group" }),
			WAIT,
		);
	});

	it("open the pull request from the branch checked out after a mid-flow rename", async () => {
		let checkedOut = "kilo/old-name";
		const created: PullRequest = {
			number: 7,
			title: "Title",
			url: "https://github.com/acme/repo/pull/7",
			state: "open",
			isDraft: true,
			headBranch: "kilo/new-name",
			baseBranch: "main",
		};
		const { host, generated, tracked, answer } = await renderActions(
			repository({
				status: () => status({ currentBranch: checkedOut }),
				branches: () => branchesOn(checkedOut),
				originUrl: () => "git@github.com:acme/repo.git",
				commit: () => {
					checkedOut = "kilo/new-name";
					answer({ title: "Title", body: "Body" });
				},
				createPullRequest: () => created,
			}),
		);

		await expect.element(primary()).toHaveTextContent("Commit, push & PR");
		await primary().click();

		await vi.waitFor(() => expect(host.opens).toEqual([created.url]), WAIT);
		expect(host.calls("push")).toEqual([{ directory: ROOT }]);
		expect(generated[0]).toMatchObject({
			title: "Generate PR: kilo/new-name",
			model: PREFERRED_MODEL,
		});
		expect(host.calls("createPullRequest")).toEqual([
			{
				directory: ROOT,
				baseBranch: "main",
				headBranch: "kilo/new-name",
				title: "Title",
				body: "Body",
			},
		]);
		expect(host.calls("pullRequests.recordCreated")).toEqual([
			{ directory: ROOT, branch: "kilo/new-name", pullRequest: created },
		]);
		expect(tracked()).toEqual([
			["kilo.git/commit-message-generated", {}],
			["kilo.git/pull-request-content-generated", {}],
		]);
		await vi.waitFor(
			() =>
				expect(host.calls("pullRequests.refresh")).toContainEqual({
					directory: ROOT,
					settle: true,
				}),
			WAIT,
		);
	});

	it("guide setting up the GitHub CLI instead of failing the pull request", async () => {
		const { host, generated } = await renderActions(
			repository({
				status: () =>
					status({ workingDirectory: { files: [] }, currentUpstreamBranch: "origin/feature" }),
				originUrl: () => "git@github.com:acme/repo.git",
				githubCliStatus: () => ({ status: "missing" as const }),
			}),
		);

		await expect.element(primary()).toHaveTextContent("Create PR");
		await primary().click();

		await expect.element(page.getByText("GitHub CLI is not installed")).toBeVisible();
		await page.getByRole("button", { name: "Install" }).click();
		await vi.waitFor(() => expect(host.opens).toEqual(["https://cli.github.com/"]), WAIT);
		expect(generated).toEqual([]);
		expect(page.getByText("Unable to create pull request").query()).toBeNull();
	});

	it("toast the step that failed", async () => {
		await renderActions(
			repository({
				stageChanges: () => {
					throw new KernelError("BUSINESS", "index.lock exists");
				},
			}),
		);

		await primary().click();

		await expect.element(page.getByText("Unable to stage changes")).toBeVisible();
		await expect.element(page.getByText("index.lock exists")).toBeVisible();
		await expect.element(primary()).toBeEnabled();
	});

	it.each(["primary", "default branch"])(
		"show a %s push failure in full and add it to the chat on request",
		async (entry) => {
			const details = `remote: Permission denied.\n${"remote: Check repository access.\n".repeat(40)}fatal: push failed`;
			const { host, inserted } = await renderActions(
				repository({
					status: () =>
						status({
							currentUpstreamBranch: "origin/feature",
							branchAheadBehind: { ahead: 1, behind: 0 },
							workingDirectory: { files: [] },
						}),
					branches: () => branchesOn("feature", entry === "default branch" ? "feature" : "main"),
					originUrl: () => "git@github.com:acme/repo.git",
					push: () => {
						throw new KernelError("BUSINESS", details);
					},
				}),
			);

			await primary().click();
			if (entry === "default branch") {
				await page
					.getByRole("dialog", { name: "Push to default branch?" })
					.getByRole("button", { name: "Push", exact: true })
					.click();
			}

			const dialog = page.getByRole("dialog", { name: "Unable to push" });
			await expect.element(dialog).toBeVisible();
			expect(dialog.element().querySelector("pre")?.textContent).toBe(details);
			await page.getByRole("button", { name: "Fix in chat" }).click();

			await vi.waitFor(
				() =>
					expect(inserted).toEqual([
						{
							workSessionId: "wses_1",
							text: `Git error output:\n${details}\n\nHelp me diagnose and fix the Git push failure above in ${ROOT}.`,
						},
					]),
				WAIT,
			);
			await expect.element(dialog).not.toBeInTheDocument();
			expect(host.calls("push")).toHaveLength(1);
		},
	);

	it("never probe branches outside a repository", async () => {
		const { host } = await renderActions(
			repository({ repositoryType: () => ({ kind: "missing" as const }), status: () => null }),
		);

		await vi.waitFor(() => expect(host.calls("repositoryType")).not.toEqual([]), WAIT);
		expect(host.calls("branches")).toEqual([]);
		expect(primary().query()).toBeNull();
	});

	it("hide the row's pull request once the header sees another branch checked out", async () => {
		const pullRequest: PullRequest = {
			number: 649,
			url: "https://github.com/acme/repo/pull/649",
			title: "Lazy runtimed",
			baseBranch: "main",
			headBranch: "fix/lazy",
			state: "open",
			isDraft: false,
		};
		const { host } = await renderActions(
			repository({ status: () => status({ currentBranch: "main" }) }),
			{
				pullRequests: {
					byDirectory: {
						[ROOT]: {
							updatedAt: 1,
							snapshot: {
								identity: null,
								branch: "fix/lazy",
								repository: "acme/repo",
								parentRepository: null,
								pullRequest,
								githubStatus: "ready",
							},
						},
					},
				},
			},
		);

		await expect.element(primary()).toBeVisible();
		await expect.element(page.getByTestId("row").getByText("#649")).not.toBeInTheDocument();
		await vi.waitFor(
			() => expect(host.calls("pullRequests.refresh")).toContainEqual({ directory: ROOT }),
			WAIT,
		);
	});
});

describe("the repository commands", () => {
	const COMMANDS = ["kilo.git/commit", "kilo.git/push", "kilo.git/create-pull-request"];

	it("are offered while a work session is open and version control is present", async () => {
		const host = await bootGitHost();
		const offered = () => host.renderer.commands.list().map((command) => command.key);
		expect(offered()).toEqual(expect.arrayContaining(COMMANDS));
		expect(
			(await bootGitHost({ activeWorkSessionId: null })).renderer.commands
				.list()
				.map((command) => command.key),
		).not.toContain("kilo.git/commit");
	});

	it("commit like the menu item", async () => {
		const { host } = await renderActions(repository());
		await expect.element(primary()).toBeVisible();

		await host.renderer.commands.execute("kilo.git/commit");

		await vi.waitFor(() => expect(host.calls("commit")).toHaveLength(1), WAIT);
	});

	it("say why an action can't run, and when no repository control is shown", async () => {
		const { host } = await renderActions(
			repository({ status: () => status({ workingDirectory: { files: [] } }) }),
		);
		await expect.element(primary()).toBeVisible();

		await host.renderer.commands.execute("kilo.git/push");
		await expect.element(page.getByText("Push isn't available")).toBeVisible();
		await expect.element(page.getByText('Add an "origin" remote before pushing.')).toBeVisible();

		await host.renderer.commands.execute("kilo.git/create-pull-request");
		await expect.element(page.getByText("Create PR isn't available")).toBeVisible();

		const empty = await bootGitHost();
		empty.render(<span />);
		await empty.renderer.commands.execute("kilo.git/commit");
		await expect.element(page.getByText("Open a session in a git repository first.")).toBeVisible();
	});
});
