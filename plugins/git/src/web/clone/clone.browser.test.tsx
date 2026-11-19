import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import {
	WorkspaceSource,
	type NewFolderFormProps,
	type Workspace,
	type WorkspaceSourceImplementation,
	type WorkspaceSourceProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { Dialog, DialogContent } from "@kilo-desktop/ui/components/dialog";

import type { GithubRepository } from "../../contracts";
import {
	bootGitHost,
	type GitHost,
	type GithubRepositoriesFake,
	type RepositoryFake,
} from "../../test/git-host";

const CLONED: Workspace = {
	id: "w-clone",
	name: "app",
	folders: [{ id: "f", path: "/projects/app", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

function repo(nameWithOwner: string, patch: Partial<GithubRepository> = {}): GithubRepository {
	return {
		nameWithOwner,
		name: nameWithOwner.split("/")[1]!,
		description: null,
		isPrivate: false,
		isArchived: false,
		url: `https://github.com/${nameWithOwner}`,
		pushedAt: null,
		...patch,
	};
}

/**
 * kilo.work-sessions' new-folder form as far as a source sees it: the props
 * contract, drawn plainly, creating in `/projects` under the shown name.
 */
function StandInNewFolderForm(props: NewFolderFormProps & { onCreated(w: Workspace): void }) {
	const name = props.suggestedName ?? "";
	return (
		<div>
			{props.choice ? (
				<button
					type="button"
					aria-label={props.choice.changeLabel}
					data-qa-id={props.choice.qaId}
					onClick={props.choice.onChange}
				>
					{props.choice.label}
				</button>
			) : null}
			{props.summary}
			{props.leadingField}
			<output aria-label="Suggested name">{name}</output>
			<button
				type="button"
				disabled={props.ready === false}
				onClick={async () => {
					try {
						props.onCreated(
							await props.create({ name, color: "#34D399", parentPath: "/projects" }),
						);
					} catch (error) {
						document.title = `${props.errorTitle}: ${(error as Error).message}`;
					}
				}}
			>
				Create workspace
			</button>
		</div>
	);
}

function SourceHost({
	sourceKey,
	onCreated,
}: {
	sourceKey: string;
	onCreated(w: Workspace): void;
}) {
	const source = useExtensions(WorkspaceSource).find((candidate) => candidate.key === sourceKey);
	if (!source) return <p>No source {sourceKey}</p>;
	return (
		<RenderContribution<WorkspaceSourceProps>
			contribution={source}
			props={{
				onCreated,
				NewFolderForm: (props) => <StandInNewFolderForm {...props} onCreated={onCreated} />,
				appearance: "outlined",
				// A host frame reduced to the screen's heading and body.
				children: (view) => (
					<div>
						{view.description ? <p>{view.description}</p> : null}
						{view.body}
					</div>
				),
			}}
			select={(implementation: WorkspaceSourceImplementation) => implementation.Component}
		/>
	);
}

async function renderSource(
	sourceKey: "kilo.git/github-repository" | "kilo.git/git-url",
	options: {
		repository?: RepositoryFake;
		github?: GithubRepositoriesFake;
		cloneWorkspace?: () => unknown;
		desktop?: boolean;
	} = {},
) {
	const host: GitHost = await bootGitHost({
		desktop: options.desktop ?? true,
		cloneWorkspace: options.cloneWorkspace ?? (() => CLONED),
		...(options.repository ? { repository: options.repository } : {}),
		...(options.github ? { githubRepositories: options.github } : {}),
	});
	const onCreated = vi.fn();
	// The New workspace dialog draws a source inside its own dialog.
	host.render(
		<Dialog open>
			<DialogContent>
				<SourceHost sourceKey={sourceKey} onCreated={onCreated} />
			</DialogContent>
		</Dialog>,
	);
	return { host, onCreated };
}

describe("Git URL source", () => {
	it("clones a valid URL into a folder named after the repository", async () => {
		const { host, onCreated } = await renderSource("kilo.git/git-url");
		const create = page.getByRole("button", { name: "Create workspace" });
		await expect.element(create).toBeDisabled();

		await page.getByLabelText("Repository URL").fill("git@gitlab.com:group/app.git");
		await expect.element(page.getByLabelText("Suggested name")).toHaveTextContent("app");
		await create.click();

		await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(CLONED));
		expect(host.calls("cloneWorkspace")).toEqual([
			{
				name: "app",
				color: "#34D399",
				parentPath: "/projects",
				source: { kind: "url", url: "git@gitlab.com:group/app.git" },
			},
		]);
	});

	it("explains a URL it can't clone from", async () => {
		await renderSource("kilo.git/git-url");
		const url = page.getByLabelText("Repository URL");

		await url.fill("/local/path");
		await url.element().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

		await expect.element(page.getByText(/Enter an HTTPS or SSH URL/)).toBeVisible();
		await expect.element(page.getByRole("button", { name: "Create workspace" })).toBeDisabled();
	});

	it("is offered only in the desktop app", async () => {
		await renderSource("kilo.git/git-url", { desktop: false });

		await expect.element(page.getByText("No source kilo.git/git-url")).toBeVisible();
	});
});

describe("GitHub repository source", () => {
	it("lists repositories by owner and clones the chosen one", async () => {
		const { host, onCreated } = await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: {
				list: () => ({
					repositories: [repo("acme/app", { isPrivate: true }), repo("me/dots"), repo("acme/api")],
					fetchedAt: 1,
					refreshing: false,
				}),
			},
		});

		await expect.element(page.getByText("acme", { exact: true })).toBeVisible();
		await page.getByRole("option", { name: /api/ }).click();
		await expect.element(page.getByText("acme/api")).toBeVisible();
		await page.getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(CLONED));
		expect(host.calls("cloneWorkspace")).toEqual([
			expect.objectContaining({ name: "api", source: { kind: "github", repository: "acme/api" } }),
		]);
	});

	it("offers every repository of a large account, drawing only the rows in view", async () => {
		const many = Array.from({ length: 1200 }, (_, index) =>
			repo(`acme/repo-${String(index).padStart(4, "0")}`),
		);
		await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: { list: () => ({ repositories: many, fetchedAt: 1, refreshing: false }) },
		});
		const list = page.getByTestId("github-repository-list");
		await expect.element(list.getByRole("option", { name: "repo-0000" })).toBeVisible();
		expect(list.getByRole("option").elements().length).toBeLessThan(50);
		expect(page.getByText(/Showing \d+ of/).elements()).toEqual([]);

		list.element().scrollTop = list.element().scrollHeight;

		await expect.element(list.getByRole("option", { name: "repo-1199" })).toBeVisible();
	});

	it("brings the highlighted repository into view as the person arrows down", async () => {
		const many = Array.from({ length: 60 }, (_, index) =>
			repo(`acme/repo-${String(index).padStart(2, "0")}`),
		);
		await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: { list: () => ({ repositories: many, fetchedAt: 1, refreshing: false }) },
		});
		const list = page.getByTestId("github-repository-list");
		await expect.element(list.getByRole("option", { name: "repo-00" })).toBeVisible();

		await page.getByLabelText("Search repositories or enter owner/name").click();
		for (let step = 0; step < 30; step += 1) await userEvent.keyboard("{ArrowDown}");

		await expect
			.element(list.getByRole("option", { name: "repo-30" }))
			.toHaveAttribute("aria-selected", "true");
		await expect.element(list.getByRole("option", { name: "repo-30" })).toBeInViewport();
	});

	it("goes back to the list to choose another repository", async () => {
		await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: {
				list: () => ({
					repositories: [repo("acme/app"), repo("acme/api")],
					fetchedAt: 1,
					refreshing: false,
				}),
			},
		});
		await page.getByRole("option", { name: /app/ }).click();
		await expect
			.element(page.getByTestId("github-repository-chosen").getByText("acme/app", { exact: true }))
			.toBeVisible();

		await page.getByRole("button", { name: "Choose another repository" }).click();
		await page.getByRole("option", { name: /api/ }).click();

		await expect
			.element(page.getByTestId("github-repository-chosen").getByText("acme/api", { exact: true }))
			.toBeVisible();
	});

	it("filters the list, and checks a typed repository that isn't in it", async () => {
		const { host } = await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: {
				list: () => ({ repositories: [repo("acme/app")], fetchedAt: 1, refreshing: false }),
				resolve: ({ repository }: { repository: string }) => {
					if (repository === "other/missing") {
						throw new KernelError("NOT_FOUND", "GitHub couldn't find other/missing.");
					}
					return repo("Other/Tool");
				},
			},
		});
		const search = page.getByLabelText("Search repositories or enter owner/name");

		await search.fill("zzz");
		await expect.element(page.getByText("No repositories match your search.")).toBeVisible();

		await search.fill("other/missing");
		await page.getByRole("option", { name: "Clone other/missing" }).click();
		await expect.element(page.getByText("GitHub couldn't find other/missing.")).toBeVisible();

		await search.fill("other/tool");
		await page.getByRole("option", { name: "Clone other/tool" }).click();
		await expect.element(page.getByText("Other/Tool")).toBeVisible();
		expect(host.calls("github.resolve")).toEqual([
			{ repository: "other/missing" },
			{ repository: "other/tool" },
		]);
	});

	it("reads the list again when a background refresh settles", async () => {
		let repositories = [repo("acme/old")];
		let refreshing = true;
		const { host } = await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: { list: () => ({ repositories, fetchedAt: 1, refreshing }) },
		});
		await expect.element(page.getByRole("option", { name: /old/ })).toBeVisible();

		repositories = [repo("acme/new")];
		refreshing = false;
		await host.emitGithubRefreshed();

		await expect.element(page.getByRole("option", { name: /new/ })).toBeVisible();
	});

	it("explains a GitHub CLI that isn't installed and offers to get it", async () => {
		let status: "missing" | "ready" = "missing";
		const { host } = await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status }) },
			github: { list: () => ({ repositories: [], fetchedAt: 1, refreshing: false }) },
		});

		await expect.element(page.getByText("Install the GitHub CLI")).toBeVisible();
		await page.getByRole("button", { name: "Get GitHub CLI" }).click();
		await vi.waitFor(() => expect(host.opens).toEqual(["https://cli.github.com/"]));

		status = "ready";
		await page.getByRole("button", { name: "Check again" }).click();
		await expect
			.element(page.getByText("No repositories found for this GitHub account."))
			.toBeVisible();
		expect(host.calls("githubCliStatus")).toContainEqual({ force: true });
	});

	it("asks to sign in when the GitHub CLI isn't signed in", async () => {
		await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "unauthenticated" }) },
			github: { list: () => ({ repositories: [], fetchedAt: 1, refreshing: false }) },
		});

		await expect.element(page.getByText("Sign in to the GitHub CLI")).toBeVisible();
	});

	it("explains a list that couldn't be loaded", async () => {
		await renderSource("kilo.git/github-repository", {
			repository: { githubCliStatus: () => ({ status: "ready" }) },
			github: {
				list: () => {
					throw new KernelError("BUSINESS", "Couldn't reach GitHub.");
				},
			},
		});

		await expect.element(page.getByText("Couldn't load your repositories")).toBeVisible();
		await expect.element(page.getByText("Couldn't reach GitHub.")).toBeVisible();
	});

	describe("warming up when the dialog opens", () => {
		async function prepareSource(options: {
			repository: RepositoryFake;
			github?: GithubRepositoriesFake;
		}) {
			const host = await bootGitHost({
				desktop: true,
				repository: options.repository,
				...(options.github ? { githubRepositories: options.github } : {}),
			});
			const source = host.renderer.extensions
				.list(WorkspaceSource)
				.find((candidate) => candidate.key === "kilo.git/github-repository");
			source?.implementation?.prepare?.();
			return host;
		}

		it("loads the list once the GitHub CLI is signed in, so the picker shows it at once", async () => {
			let resolveList!: (value: unknown) => void;
			const host = await prepareSource({
				repository: { githubCliStatus: () => ({ status: "ready" }) },
				github: {
					list: () =>
						new Promise((resolve) => {
							resolveList = resolve;
						}),
				},
			});
			await vi.waitFor(() => expect(host.calls("github.list")).toEqual([{}]));
			resolveList({ repositories: [repo("acme/app")], fetchedAt: 1, refreshing: false });

			const onCreated = vi.fn();
			host.render(
				<Dialog open>
					<DialogContent>
						<SourceHost sourceKey="kilo.git/github-repository" onCreated={onCreated} />
					</DialogContent>
				</Dialog>,
			);

			// Shown from the warmed cache while the picker's own read (never answered here) runs.
			await expect.element(page.getByRole("option", { name: /app/ })).toBeVisible();
		});

		it("fetches no list while the GitHub CLI isn't signed in", async () => {
			const host = await prepareSource({
				repository: { githubCliStatus: () => ({ status: "unauthenticated" }) },
				github: { list: () => ({ repositories: [], fetchedAt: 1, refreshing: false }) },
			});

			await vi.waitFor(() => expect(host.calls("githubCliStatus")).toEqual([{}]));
			expect(host.calls("github.list")).toEqual([]);
		});
	});
});
