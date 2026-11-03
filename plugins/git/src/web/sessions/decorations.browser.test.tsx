import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import {
	SessionDecoration,
	type Session,
	type SessionDecorationProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import { SessionFacet } from "@kilo-desktop/plugin-workbench/contracts";

import type { PullRequestEntry, PullRequestsState } from "../../contracts/index.js";
import {
	bootGitHost,
	resetViewTestDom,
	ROOT,
	session,
	type ChangesHostOptions,
	type GitHost,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

const WAIT = { timeout: 5_000 };
const WORKTREE = `${ROOT}/.kilo/worktrees/fix`;

function entry(branch: string, pullRequest: PullRequestEntry["snapshot"]["pullRequest"]) {
	return {
		updatedAt: 1,
		snapshot: {
			identity: `${branch}|abc`,
			branch,
			repository: "acme/repo",
			parentRepository: null,
			pullRequest,
			githubStatus: "ready" as const,
		},
	};
}

const PULL_REQUEST = {
	number: 42,
	url: "https://github.com/acme/repo/pull/42",
	title: "Example change",
	baseBranch: "main",
	headBranch: "fix/lazy",
	state: "open" as const,
	isDraft: false,
};

const WITH_PR: Partial<PullRequestsState> = {
	byDirectory: { [WORKTREE]: entry("fix/lazy", PULL_REQUEST) },
};

function Decorations({
	host,
	slot,
	session: shown,
}: {
	host: GitHost;
	slot: "row" | "hover" | "hover-branch";
	session: Session;
}) {
	const contributions = host.renderer.extensions
		.list(SessionDecoration)
		.filter((contribution) => contribution.metadata.slot === slot);
	return (
		<>
			{contributions.map((contribution) => (
				<RenderContribution<SessionDecorationProps>
					key={contribution.key}
					contribution={contribution}
					props={{ session: shown }}
				/>
			))}
		</>
	);
}

const worktreeSession = session("wses_1", { directory: WORKTREE, worktreeBranch: "kilo/fix" });

async function renderSlot(
	slot: "row" | "hover" | "hover-branch",
	options: ChangesHostOptions = {},
	shown: Session = worktreeSession,
) {
	const host = await bootGitHost({ sessions: [shown], ...options });
	host.render(<Decorations host={host} slot={slot} session={shown} />);
	return host;
}

describe("a session's pull request", () => {
	it("is a badge on its row, coloured by its state", async () => {
		await renderSlot("row", { pullRequests: WITH_PR });

		const badge = page.getByTestId("git-session-row-pull-request");
		await expect.element(badge.getByText("#42")).toBeVisible();
		await expect.element(badge).toHaveAttribute("title", "PR #42: Example change");
		await expect.element(page.getByRole("link")).not.toBeInTheDocument();
	});

	it("follows the lookups, and nothing shows without a pull request", async () => {
		const host = await renderSlot("row", {
			pullRequests: { byDirectory: { [WORKTREE]: entry("kilo/fix", null) } },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByTestId("git-session-row-pull-request").query()).toBeNull();

		await host.setPullRequests(WITH_PR);

		await expect.element(page.getByText("#42")).toBeVisible();
	});

	it("uses the workspace's primary folder for a session in the checkout", async () => {
		await renderSlot(
			"row",
			{ pullRequests: { byDirectory: { [ROOT]: entry("main", PULL_REQUEST) } } },
			session("wses_1"),
		);

		await expect.element(page.getByText("#42")).toBeVisible();
	});

	it("is a link in its hover details that opens in the browser", async () => {
		const host = await renderSlot("hover", { pullRequests: WITH_PR });

		const link = page.getByTestId("git-session-details-pull-request");
		await expect.element(link).toHaveAttribute("href", PULL_REQUEST.url);
		await expect.element(link.getByText("Example change")).toBeVisible();
		await link.click();

		await vi.waitFor(() => expect(host.opens).toEqual([PULL_REQUEST.url]), WAIT);
	});
});

describe("a session's branch on hover", () => {
	it("is read from the repository", async () => {
		await renderSlot("hover-branch", {
			repository: {
				repositoryType: () => ({
					kind: "regular",
					topLevelWorkingDirectory: WORKTREE,
					gitDir: ".git",
				}),
				branches: () => ({ currentBranch: "feature", branches: [], recentBranches: [] }),
			},
		});

		await expect
			.element(page.getByTestId("git-session-details-branch").getByText("feature"))
			.toBeVisible();
	});

	it("falls back to the last lookup, then the stamped branch, outside a repository", async () => {
		const missing = { repositoryType: () => ({ kind: "missing" as const }) };
		const host = await renderSlot("hover-branch", { repository: missing, pullRequests: WITH_PR });
		await expect
			.element(page.getByTestId("git-session-details-branch").getByText("fix/lazy"))
			.toBeVisible();
		expect(host.calls("branches")).toEqual([]);

		await renderSlot("hover-branch", { repository: missing });
		await expect
			.element(page.getByTestId("git-session-details-branch").getByText("kilo/fix"))
			.toBeVisible();
	});

	it("is nothing without a known branch", async () => {
		await renderSlot(
			"hover-branch",
			{ repository: { repositoryType: () => ({ kind: "bare" as const }) } },
			session("wses_1"),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByTestId("git-session-details-branch").query()).toBeNull();
	});
});

describe("the pull request facet", () => {
	it("gives each session's pull request state, telling listeners of changes", async () => {
		const host = await bootGitHost({
			sessions: [worktreeSession, session("wses_2"), session("wses_3", { workspaceId: null })],
			pullRequests: {
				byDirectory: { [ROOT]: entry("main", { ...PULL_REQUEST, state: "merged" }) },
			},
		});
		const facet = host.renderer.extensions
			.list(SessionFacet)
			.find((contribution) => contribution.metadata.facet === "pull-request")!.implementation!;
		expect(facet.get()).toEqual({ wses_2: "merged" });
		const heard = vi.fn();
		facet.subscribe(heard);

		await host.setPullRequests({
			byDirectory: {
				[ROOT]: entry("main", { ...PULL_REQUEST, state: "merged" }),
				...WITH_PR.byDirectory,
			},
		});

		await vi.waitFor(() => expect(facet.get()).toEqual({ wses_1: "open", wses_2: "merged" }), WAIT);
		expect(heard).toHaveBeenCalledTimes(1);
	});
});

describe("the window's shown directory", () => {
	it("is its open session's, reported to the pull requests in main", async () => {
		const host = await bootGitHost({ sessions: [worktreeSession], activeSessionId: "wses_1" });

		await vi.waitFor(
			() =>
				expect(host.calls("pullRequests.setActive").at(-1)).toEqual({
					windowId: "main",
					directories: [WORKTREE],
					visible: true,
				}),
			WAIT,
		);
	});

	it("is none while no session is open", async () => {
		const host = await bootGitHost({ activeSessionId: null });

		await vi.waitFor(
			() => expect(host.calls("pullRequests.setActive").at(-1)).toMatchObject({ directories: [] }),
			WAIT,
		);
	});
});
