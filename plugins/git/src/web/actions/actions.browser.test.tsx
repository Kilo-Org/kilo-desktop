import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import { RenderContribution } from "@kilo-desktop/kernel/web";
import { AgentTool, Conversations, type GenerateInput } from "@kilo-desktop/plugin-agent/contracts";
import { Composer, ComposerAction, ModelPreferences } from "@kilo-desktop/plugin-chat/contracts";
import {
	SessionDecoration,
	type Session,
	type SessionDecorationProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import { Telemetry, TelemetryEvent } from "@kilo-desktop/plugin-telemetry/contracts";
import { SessionAction, type SessionActionProps } from "@kilo-desktop/plugin-workbench/contracts";

import {
	CHANGES_PANE_KIND,
	type GitStatus,
	type PullRequest,
	type PullRequestsState,
} from "../../contracts/index.js";
import {
	bootGitHost,
	resetViewTestDom,
	ROOT,
	session,
	type ChangesHostOptions,
	type GitHost,
	type RepositoryFake,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

const WAIT = { timeout: 5_000 };
const SESSION = session("wses_1");

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

/** kilo.agent, kilo.chat and kilo.telemetry as far as the actions use them. */
function collaborators() {
	const generated: GenerateInput[] = [];
	const tracked: unknown[] = [];
	const inserted: unknown[] = [];
	let answer: Record<string, unknown> = { message: "Fix the login" };
	const unused = () => {
		throw new KernelError("NOT_FOUND", "unused");
	};
	const agent = testPlugin("kilo.agent", {
		manifest: {
			domains: [{ id: "conversation", home: "main" }],
			extensionPoints: [{ id: "tool", kind: "additive" }],
		},
		definitions: { domains: [Conversations], extensionPoints: [AgentTool] },
	});
	const chat = testPlugin("kilo.chat", {
		manifest: {
			domains: [
				{ id: "model-preferences", home: "main" },
				{ id: "composer", home: "renderer" },
			],
			extensionPoints: [{ id: "composer-action", kind: "additive" }],
		},
		definitions: { domains: [ModelPreferences, Composer], extensionPoints: [ComposerAction] },
	});
	const telemetry = testPlugin("kilo.telemetry", {
		manifest: {
			domains: [{ id: "telemetry", home: "main" }],
			extensionPoints: [{ id: "telemetry-event", kind: "additive" }],
		},
		definitions: { domains: [Telemetry], extensionPoints: [TelemetryEvent] },
	});
	const options: Pick<ChangesHostOptions, "main" | "renderer"> = {
		main: [
			{
				...agent,
				entry: {
					activate(sdk) {
						sdk.domains.provide(Conversations, {
							initialState: { ready: true, chats: {} },
							methods: new Proxy(
								{
									generate: (input: GenerateInput) => {
										generated.push(input);
										return answer;
									},
								} as Record<string, unknown>,
								{ get: (target, key) => target[key as string] ?? unused },
							) as never,
						});
					},
				},
			},
			{
				...chat,
				entry: {
					activate(sdk) {
						sdk.domains.provide(ModelPreferences, {
							initialState: {
								modelSelections: {},
								preferred: { providerID: "kilo", modelID: "fast", variant: "low" },
								variantSelections: {},
								recentModels: [],
								favorites: [],
								autoFreeModelsEnabled: true,
							},
							methods: {
								remember: unused,
								recordRecent: unused,
								setFavorite: unused,
								setAutoFreeEnabled: unused,
								importLegacyFavorites: unused,
							},
						});
					},
				},
			},
			{
				...telemetry,
				entry: {
					activate(sdk) {
						sdk.domains.provide(Telemetry, {
							initialState: {},
							methods: { track: (input) => void tracked.push(input) },
						});
					},
				},
			},
		],
		renderer: [
			agent,
			{
				...chat,
				entry: {
					activate(sdk) {
						sdk.domains.provide(Composer, {
							initialState: { drafts: {}, focusedSessionId: null },
							methods: {
								focus: unused,
								insert: (input) => void inserted.push(input),
								startNewChat: unused,
							},
						});
					},
				},
			},
			telemetry,
		],
	};
	return {
		options,
		generated,
		tracked,
		inserted,
		answer: (next: Record<string, unknown>) => (answer = next),
	};
}

function Header({ host, shown = SESSION }: { host: GitHost; shown?: Session }) {
	const action = host.renderer.extensions
		.list(SessionAction)
		.find((contribution) => contribution.key === "kilo.git/repository-actions")!;
	const badge = host.renderer.extensions
		.list(SessionDecoration)
		.find((contribution) => contribution.metadata.slot === "row")!;
	return (
		<>
			<RenderContribution<SessionActionProps> contribution={action} props={{ session: shown }} />
			<div data-qa-id="row">
				<RenderContribution<SessionDecorationProps>
					contribution={badge}
					props={{ session: shown }}
				/>
			</div>
		</>
	);
}

async function renderActions(
	repositoryFake: RepositoryFake,
	options: { pullRequests?: Partial<PullRequestsState>; activeSessionId?: string | null } = {},
) {
	const peers = collaborators();
	const host = await bootGitHost({
		repository: repositoryFake,
		...peers.options,
		...options,
	});
	host.render(<Header host={host} />);
	return { host, ...peers };
}

const primary = () => page.getByTestId("git-action-primary");

describe("the open session's repository actions", () => {
	it("sit before the pane controls in the session header", async () => {
		const host = await bootGitHost();
		const action = host.renderer.extensions
			.list(SessionAction)
			.find((contribution) => contribution.key === "kilo.git/repository-actions");

		expect(action?.metadata).toEqual({ placement: "start" });
	});

	it("commit with a message generated by the preferred model, tracked without its content", async () => {
		const { host, generated, tracked } = await renderActions(repository());

		await expect.element(primary()).toHaveTextContent("Commit");
		await primary().click();

		await vi.waitFor(
			() => expect(host.calls("commit")).toEqual([{ directory: ROOT, message: "Fix the login" }]),
			WAIT,
		);
		expect(generated[0]).toMatchObject({
			directory: ROOT,
			title: "Generate commit message",
			model: { providerID: "kilo", modelID: "fast", variant: "low" },
		});
		expect(generated[0]?.prompt).toContain("M a.txt");
		expect(tracked).toEqual([{ event: "Commit Message Generated", data: {} }]);
	});

	it("show the changed files and open the Changes pane", async () => {
		const { host } = await renderActions(repository());

		const summary = page.getByTestId("git-open-changes-summary");
		await expect.element(summary.getByText("+3")).toBeVisible();
		await summary.click();

		await vi.waitFor(
			() => expect(host.opened).toEqual([{ sessionId: "wses_1", kind: CHANGES_PANE_KIND }]),
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
		expect(generated[1]).toMatchObject({ title: "Generate PR: kilo/new-name" });
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
		expect(tracked).toHaveLength(2);
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
							sessionId: "wses_1",
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

	it("are offered while a session is open and version control is present", async () => {
		const host = await bootGitHost();
		const offered = () => host.renderer.commands.list().map((command) => command.key);
		expect(offered()).toEqual(expect.arrayContaining(COMMANDS));
		expect(
			(await bootGitHost({ activeSessionId: null })).renderer.commands
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
