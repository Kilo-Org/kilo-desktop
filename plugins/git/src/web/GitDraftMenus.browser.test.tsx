import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import {
	GIT_DRAFT_SELECTION_STORE_KEY,
	gitContract,
	type GitBranchesResult,
	type GitDraftSelectionStoreValue,
	type GitRepositoryType,
	type GitWorktreeEntry,
} from "../contracts/schemas.js";
import { DRAFT_MODE_STORAGE_KEY, GitDraftMenus } from "./GitDraftMenus.js";
import { setSelection } from "./draft-selection-store.js";
import { webRegister } from "./index.js";

const branchesResult: GitBranchesResult = {
	currentBranch: "main",
	branches: [
		{
			name: "feature-x",
			upstream: null,
			tip: { sha: "b" },
			ref: "refs/heads/feature-x",
			kind: "local",
		},
		{ name: "main", upstream: null, tip: { sha: "a" }, ref: "refs/heads/main", kind: "local" },
	],
	defaultBranch: "main",
	recentBranches: [],
};

/**
 * Grouping fixture for the worktree picker: main is the default, feature-x
 * recent, and the remote origin/feature-y lands in Other Branches.
 */
const worktreeBranchesResult: GitBranchesResult = {
	currentBranch: "main",
	defaultBranch: "main",
	recentBranches: ["feature-x"],
	branches: [
		{
			name: "feature-x",
			upstream: null,
			tip: { sha: "b" },
			ref: "refs/heads/feature-x",
			kind: "local",
		},
		{ name: "main", upstream: null, tip: { sha: "a" }, ref: "refs/heads/main", kind: "local" },
		{
			name: "origin/feature-y",
			upstream: null,
			tip: { sha: "c" },
			ref: "refs/remotes/origin/feature-y",
			kind: "remote",
		},
	],
};

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: "/repo/project",
	gitDir: "/repo/project/.git",
};

interface RenderOptions {
	repositoryType?: () => GitRepositoryType | Promise<GitRepositoryType>;
	branches?: () => GitBranchesResult | null | Promise<GitBranchesResult | null>;
	defaultBranch?: () => string | null | Promise<string | null>;
	worktrees?: () => GitWorktreeEntry[] | null | Promise<GitWorktreeEntry[] | null>;
	workspaceDirectory?: string | undefined;
	workspaceId?: string | undefined;
	/** Pre-seeds localStorage before render; mirrors how a returning user has a stored preference. */
	storedMode?: "local" | "worktree";
}

function renderMenus(options: RenderOptions = {}) {
	const workspaceDirectory = options.workspaceDirectory ?? "/repo/project";
	const workspaceId = options.workspaceId ?? "workspace-1";
	if (options.storedMode !== undefined) {
		localStorage.setItem(DRAFT_MODE_STORAGE_KEY, JSON.stringify(options.storedMode));
	}
	const sdk = createFakeSdk({ featureId: "git" });
	// Renderer boot: the menus' seeding effect writes through the store, so
	// the plugin's boot hook must register it before render — mirroring
	// how SdkProvider runs webRegister before zone components mount.
	webRegister(sdk);
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		// `??` is deliberately avoided: an explicit `null` handler result is
		// authoritative (e.g. "no default branch resolves").
		repositoryType: () =>
			options.repositoryType === undefined ? regularRepositoryType : options.repositoryType(),
		branches: () => (options.branches === undefined ? branchesResult : options.branches()),
		defaultBranch: () => (options.defaultBranch === undefined ? "main" : options.defaultBranch()),
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		checkout: () => {
			throw new Error("unused in this test");
		},
		init: () => {
			throw new Error("unused in this test");
		},
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
		worktrees: () => (options.worktrees === undefined ? [] : options.worktrees()),
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<GitDraftMenus workspaceDirectory={workspaceDirectory} workspaceId={workspaceId} />
			</QueryClientProvider>
		</SdkProvider>,
	);

	const peekStore = (): GitDraftSelectionStoreValue | null =>
		sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek();

	return { ...result, sdk, peekStore };
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

async function selectMode(value: "local" | "worktree") {
	await page.getByTestId("git-draft-mode-trigger").click();
	await page.getByTestId(`git-draft-mode-item-${value}`).click();
}

describe("GitDraftMenus", () => {
	it("renders nothing without a workspace (unscoped chat)", () => {
		renderMenus({ workspaceId: undefined, workspaceDirectory: undefined });

		expect(page.getByTestId("git-draft-mode-trigger").query()).toBe(null);
	});

	it("renders nothing for a non-regular repository", () => {
		renderMenus({ repositoryType: () => ({ kind: "bare" }) });

		expect(page.getByTestId("git-draft-mode-trigger").query()).toBe(null);
	});

	it("renders the Initialize Git button for a missing repository", async () => {
		renderMenus({ repositoryType: () => ({ kind: "missing" }) });

		await expect.element(page.getByTestId("git-init-draft-button")).toBeVisible();
		expect(page.getByTestId("git-draft-mode-trigger").query()).toBe(null);
	});

	it("writes the local default on first mount and displays it", async () => {
		const { peekStore } = renderMenus();

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		});
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toHaveTextContent("Local");
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toBeVisible();
	});

	it("renders the local selector while seeding is still pending", async () => {
		// A persisted worktree preference waits for both branch probes before
		// seeding; until then `selection` is null and the unseeded render must
		// show the local/default UI, not the worktree base picker.
		renderMenus({
			storedMode: "worktree",
			branches: () => new Promise(() => {}),
			defaultBranch: () => new Promise(() => {}),
		});

		await expect.element(page.getByTestId("git-branch-selector-trigger")).toBeVisible();
		await expect.element(page.getByTestId("git-base-branch-trigger")).not.toBeInTheDocument();
	});

	it("shows Loading… while the default branch is still resolving", async () => {
		// The seeding effect waits for both branch probes, so the worktree
		// selection is seeded explicitly — only the default branch stays
		// pending, which is what the Loading… state is about.
		const { sdk } = renderMenus({
			defaultBranch: () => new Promise(() => {}),
			storedMode: "worktree",
		});
		setSelection(sdk, "workspace-1", { mode: "worktree" });

		await vi.waitFor(() => {
			expect(page.getByTestId("git-base-branch-trigger").query()).not.toBe(null);
		});
		const baseTrigger = page.getByTestId("git-base-branch-trigger");
		await expect.element(baseTrigger).toHaveTextContent("Loading…");
		expect(baseTrigger.element().querySelector('[data-slot="spinner"]')).not.toBe(null);
	});

	it("defaults to the baseless worktree selection when no default branch resolves", async () => {
		const { peekStore } = renderMenus({ defaultBranch: () => null, storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "worktree" } });
		});
		await expect
			.element(page.getByTestId("git-base-branch-trigger"))
			.toHaveTextContent("From current branch");
	});

	it("describes the draft modes", async () => {
		renderMenus();

		await page.getByTestId("git-draft-mode-trigger").click();
		await expect
			.element(page.getByTestId("git-draft-mode-item-worktree"))
			.toHaveTextContent("New worktreeCreates a separate copy for this session");
		await expect
			.element(page.getByTestId("git-draft-mode-item-local"))
			.toHaveTextContent("Local repositoryWorks in the repository already on your machine");
	});

	it("switches to local mode and back, writing the store each time", async () => {
		const { peekStore } = renderMenus();

		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "local" });
		});

		await selectMode("worktree");
		expect(peekStore()).toEqual({ "workspace-1": { mode: "worktree", baseBranch: "main" } });
		await expect
			.element(page.getByTestId("git-draft-mode-trigger"))
			.toHaveTextContent("New worktree");
		await expect.element(page.getByTestId("git-branch-selector-trigger")).not.toBeInTheDocument();

		await selectMode("local");
		expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toHaveTextContent("Local");
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toBeVisible();
	});

	it("records a picked base branch without checking it out", async () => {
		const { peekStore, sdk } = renderMenus({ storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "worktree" });
		});

		await page.getByTestId("git-base-branch-trigger").click();
		await page.getByTestId("git-base-branch-item-feature-x").click();

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({
				"workspace-1": { mode: "worktree", baseBranch: "feature-x" },
			});
		});
		// Base picking is pure state — the checkout channel never runs.
		const invokeSpy = vi.spyOn(sdk, "invoke");
		expect(invokeSpy.mock.calls.every(([channel]) => channel !== "checkout")).toBe(true);
	});

	it("groups the worktree base branches like the local selector", async () => {
		renderMenus({ branches: () => worktreeBranchesResult, storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(page.getByTestId("git-base-branch-trigger").query()).not.toBe(null);
		});

		await page.getByTestId("git-base-branch-trigger").click();

		await expect.element(page.getByText("Default Branch")).toBeVisible();
		await expect.element(page.getByText("Recent Branches")).toBeVisible();
		await expect.element(page.getByText("Other Branches")).toBeVisible();
		await expect.element(page.getByTestId("git-base-branch-item-main")).toBeVisible();
		await expect.element(page.getByTestId("git-base-branch-item-feature-x")).toBeVisible();
	});

	it("displays remote branches without the remote prefix and stores the full name", async () => {
		const { peekStore } = renderMenus({
			branches: () => worktreeBranchesResult,
			storedMode: "worktree",
		});

		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "worktree" });
		});

		await page.getByTestId("git-base-branch-trigger").click();
		await expect.element(page.getByTestId("git-base-branch-item-feature-y")).toBeVisible();
		await page.getByTestId("git-base-branch-item-feature-y").click();

		// The stored base is the full contract name — a valid `worktree add`
		// commitish — even though the item displays the stripped label.
		await vi.waitFor(() => {
			expect(peekStore()).toEqual({
				"workspace-1": { mode: "worktree", baseBranch: "origin/feature-y" },
			});
		});
	});

	it("checks the effective base branch in the worktree popover", async () => {
		const { peekStore } = renderMenus({
			branches: () => worktreeBranchesResult,
			storedMode: "worktree",
		});

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "worktree", baseBranch: "main" } });
		});

		await page.getByTestId("git-base-branch-trigger").click();
		expect(page.getByTestId("git-base-branch-item-main").element()).toHaveAttribute(
			"data-checked",
			"true",
		);
		expect(page.getByTestId("git-base-branch-item-feature-y").element()).toHaveAttribute(
			"data-checked",
			"false",
		);

		await page.getByTestId("git-base-branch-item-feature-y").click();
		await vi.waitFor(() => {
			expect(peekStore()).toEqual({
				"workspace-1": { mode: "worktree", baseBranch: "origin/feature-y" },
			});
		});

		await page.getByTestId("git-base-branch-trigger").click();
		expect(page.getByTestId("git-base-branch-item-feature-y").element()).toHaveAttribute(
			"data-checked",
			"true",
		);
		expect(page.getByTestId("git-base-branch-item-main").element()).toHaveAttribute(
			"data-checked",
			"false",
		);
	});

	it("filters the worktree base branches by search and offers no create item", async () => {
		renderMenus({ branches: () => worktreeBranchesResult, storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(page.getByTestId("git-base-branch-trigger").query()).not.toBe(null);
		});

		await page.getByTestId("git-base-branch-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await expect.element(search).toBeVisible();

		await search.fill("feature-y");
		await expect.element(page.getByTestId("git-base-branch-item-feature-y")).toBeVisible();
		await expect.element(page.getByTestId("git-base-branch-item-main")).not.toBeInTheDocument();

		// A base branch must already exist — the create flow stays
		// local-selector-only.
		expect(page.getByTestId("git-branch-create").query()).toBe(null);
	});

	it("does not treat an in-flight branches query as an unborn repository", async () => {
		renderMenus({ branches: () => new Promise(() => {}) });

		await page.getByTestId("git-draft-mode-trigger").click();
		const item = page.getByTestId("git-draft-mode-item-worktree");
		await expect.element(item).toBeVisible();
		await expect.element(item).not.toBeDisabled();
		await userEvent.hover(item);
		expect(
			page
				.getByText("This repository has no commits yet. Create an initial commit to use worktrees.")
				.query(),
		).toBe(null);
	});

	it("keeps worktree mode disabled for a repository without commits", async () => {
		const { peekStore } = renderMenus({
			branches: () => ({ currentBranch: undefined, branches: [], recentBranches: [] }),
			defaultBranch: () => null,
		});

		// The safe default for an unborn repository is local.
		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		});

		await page.getByTestId("git-draft-mode-trigger").click();
		await expect.element(page.getByTestId("git-draft-mode-item-worktree")).toBeDisabled();
		await userEvent.keyboard("{Escape}");
		expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
	});

	it("switching branches in local mode still routes through the checkout selector", async () => {
		renderMenus({ storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(page.getByTestId("git-base-branch-trigger").query()).not.toBe(null);
		});
		await selectMode("local");

		await page.getByTestId("git-branch-selector-trigger").click();
		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
	});

	it("preserves other workspaces' entries on update", async () => {
		const { sdk, peekStore } = renderMenus({ storedMode: "worktree" });

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "worktree", baseBranch: "main" } });
		});
		const firstBefore = peekStore()?.["workspace-1"];

		setSelection(sdk, "workspace-2", { mode: "local" });

		const store = peekStore();
		expect(store?.["workspace-2"]).toEqual({ mode: "local" });
		// The untouched entry keeps its reference so its subscribers do not
		// re-render.
		expect(store?.["workspace-1"]).toBe(firstBefore);
	});

	it("persists the mode choice to fresh workspaces", async () => {
		// Mount with default (local), switch to worktree, then unmount and
		// remount with a new workspace id — the new workspace should seed from
		// the stored worktree preference.
		const { peekStore, unmount } = renderMenus();

		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "local" });
		});

		await selectMode("worktree");
		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "worktree" });
		});

		unmount();
		cleanup();

		const { peekStore: peekStore2 } = renderMenus({ workspaceId: "workspace-2" });

		await vi.waitFor(() => {
			expect(peekStore2()).toEqual({
				"workspace-2": { mode: "worktree", baseBranch: "main" },
			});
		});
		await expect
			.element(page.getByTestId("git-draft-mode-trigger"))
			.toHaveTextContent("New worktree");
	});

	it("writes the mode preference to localStorage on switch", async () => {
		renderMenus();

		await vi.waitFor(() => {
			expect(page.getByTestId("git-draft-mode-trigger").query()).not.toBe(null);
		});

		await selectMode("worktree");

		// Contract-pinning: the key name is the cross-session persistence
		// contract — a rename would silently drop every user's saved preference.
		expect(JSON.parse(localStorage.getItem(DRAFT_MODE_STORAGE_KEY)!)).toBe("worktree");

		await selectMode("local");
		expect(JSON.parse(localStorage.getItem(DRAFT_MODE_STORAGE_KEY)!)).toBe("local");
	});

	it("unborn repo with worktree preference seeds local and disables worktree item", async () => {
		// Even if the user previously chose worktree, an unborn repo must seed
		// local — `worktree add` requires a commitish.
		const { peekStore } = renderMenus({
			branches: () => ({ currentBranch: undefined, branches: [], recentBranches: [] }),
			defaultBranch: () => null,
			storedMode: "worktree",
		});

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		});

		await page.getByTestId("git-draft-mode-trigger").click();
		await expect.element(page.getByTestId("git-draft-mode-item-worktree")).toBeDisabled();
		await userEvent.keyboard("{Escape}");
	});

	it("sanitizes a garbage numeric stored value to local", async () => {
		localStorage.setItem(DRAFT_MODE_STORAGE_KEY, JSON.stringify(42));
		const { peekStore } = renderMenus();

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		});
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toHaveTextContent("Local");
	});

	it("sanitizes unparseable stored value to local", async () => {
		localStorage.setItem(DRAFT_MODE_STORAGE_KEY, "not-json");
		const { peekStore } = renderMenus();

		await vi.waitFor(() => {
			expect(peekStore()).toEqual({ "workspace-1": { mode: "local" } });
		});
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toHaveTextContent("Local");
	});

	it("lists in-workspace worktrees in the Existing worktrees submenu", async () => {
		renderMenus({
			worktrees: () => [
				{ path: "/repo/project", name: "project", branch: "main", isMain: true },
				{
					path: "/repo/project/.kilo/worktrees/kilo-feature",
					name: "kilo-feature",
					branch: "kilo/feature",
					isMain: false,
				},
			],
		});

		await page.getByTestId("git-draft-mode-trigger").click();
		await expect.element(page.getByTestId("git-draft-mode-sub-existing")).toBeVisible();
		await page.getByTestId("git-draft-mode-sub-existing").click();
		await expect
			.element(page.getByTestId("git-draft-mode-item-existing-kilo-feature"))
			.toHaveTextContent("kilo-featurekilo/feature");
	});

	it("selecting an existing worktree sets the selection without touching git.draftMode:v1", async () => {
		const { peekStore } = renderMenus({
			worktrees: () => [
				{ path: "/repo/project", name: "project", branch: "main", isMain: true },
				{
					path: "/repo/project/.kilo/worktrees/kilo-feature",
					name: "kilo-feature",
					branch: "kilo/feature",
					isMain: false,
				},
			],
		});
		await vi.waitFor(() => {
			expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "local" });
		});
		const draftModeBefore = localStorage.getItem(DRAFT_MODE_STORAGE_KEY);

		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-sub-existing").click();
		await page.getByTestId("git-draft-mode-item-existing-kilo-feature").click();

		expect(peekStore()).toEqual({
			"workspace-1": {
				mode: "existing-worktree",
				directory: "/repo/project/.kilo/worktrees/kilo-feature",
			},
		});
		expect(localStorage.getItem(DRAFT_MODE_STORAGE_KEY)).toBe(draftModeBefore);
		await expect
			.element(page.getByTestId("git-draft-mode-trigger"))
			.toHaveTextContent("kilo-feature");
		await expect.element(page.getByTestId("git-draft-mode-item-worktree")).not.toBeInTheDocument();
	});

	describe("searching existing worktrees", () => {
		const manyWorktrees = (): GitWorktreeEntry[] => [
			{ path: "/repo/project", name: "project", branch: "main", isMain: true },
			{
				path: "/repo/project/.kilo/worktrees/kilo-alpha",
				name: "kilo-alpha",
				branch: "feat/login",
				isMain: false,
			},
			{
				path: "/repo/project/.kilo/worktrees/kilo-beta",
				name: "kilo-beta",
				branch: "fix/crash",
				isMain: false,
			},
			{
				path: "/repo/project/.kilo/worktrees/kilo-gamma",
				name: "kilo-gamma",
				branch: "chore/deps",
				isMain: false,
			},
		];

		async function openExistingSubmenu() {
			await page.getByTestId("git-draft-mode-trigger").click();
			await page.getByTestId("git-draft-mode-sub-existing").click();
			const search = page.getByTestId("git-draft-mode-existing-search");
			await expect.element(search).toHaveFocus();
			return search;
		}

		it("filters the list by worktree name", async () => {
			renderMenus({ worktrees: manyWorktrees });
			await openExistingSubmenu();

			await userEvent.keyboard("beta");

			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-beta"))
				.toBeVisible();
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-alpha"))
				.not.toBeInTheDocument();
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-gamma"))
				.not.toBeInTheDocument();
		});

		it("filters the list by branch, but not by path", async () => {
			renderMenus({ worktrees: manyWorktrees });
			await openExistingSubmenu();

			await userEvent.keyboard("chore");
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-gamma"))
				.toBeVisible();
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-alpha"))
				.not.toBeInTheDocument();

			await userEvent.clear(page.getByTestId("git-draft-mode-existing-search"));
			await userEvent.keyboard(".kilo/worktrees");
			await expect.element(page.getByText("No worktrees found.")).toBeVisible();
		});

		it("keeps the submenu's size and position stable while filtering", async () => {
			renderMenus({ worktrees: manyWorktrees });
			await openExistingSubmenu();
			const submenu = page.getByRole("menu", { name: "Existing worktrees" });
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-gamma"))
				.toBeVisible();
			const before = submenu.element().getBoundingClientRect();

			await userEvent.keyboard("beta");
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-alpha"))
				.not.toBeInTheDocument();
			const filtered = submenu.element().getBoundingClientRect();

			await userEvent.keyboard("zzz");
			await expect.element(page.getByText("No worktrees found.")).toBeVisible();
			const empty = submenu.element().getBoundingClientRect();

			for (const rect of [filtered, empty]) {
				expect(rect.top).toBe(before.top);
				expect(rect.height).toBe(before.height);
			}
		});

		it("keeps the menu open while typing and arrowing inside the search input", async () => {
			renderMenus({ worktrees: manyWorktrees });
			const search = await openExistingSubmenu();

			// Letters that would trigger menu typeahead ("l" → Local repository).
			await userEvent.keyboard("lo");
			await userEvent.keyboard("{ArrowLeft}{ArrowRight}");

			await expect.element(search).toHaveFocus();
			await expect.element(search).toHaveValue("lo");
			await expect
				.element(page.getByTestId("git-draft-mode-item-existing-kilo-alpha"))
				.toBeVisible();
		});

		it("selects the highlighted match with Enter and closes the menu", async () => {
			const { peekStore } = renderMenus({ worktrees: manyWorktrees });
			await vi.waitFor(() => {
				expect(peekStore()?.["workspace-1"]).toMatchObject({ mode: "local" });
			});
			const draftModeBefore = localStorage.getItem(DRAFT_MODE_STORAGE_KEY);
			await openExistingSubmenu();

			await userEvent.keyboard("gamma");
			await userEvent.keyboard("{Enter}");

			expect(peekStore()).toEqual({
				"workspace-1": {
					mode: "existing-worktree",
					directory: "/repo/project/.kilo/worktrees/kilo-gamma",
				},
			});
			expect(localStorage.getItem(DRAFT_MODE_STORAGE_KEY)).toBe(draftModeBefore);
			await expect
				.element(page.getByTestId("git-draft-mode-existing-search"))
				.not.toBeInTheDocument();
			await expect
				.element(page.getByTestId("git-draft-mode-trigger"))
				.toHaveTextContent("kilo-gamma");
		});

		it("closes the menu on Escape", async () => {
			renderMenus({ worktrees: manyWorktrees });
			await openExistingSubmenu();

			await userEvent.keyboard("{Escape}");

			await expect
				.element(page.getByTestId("git-draft-mode-item-worktree"))
				.not.toBeInTheDocument();
		});
	});

	it("hides the Existing worktrees submenu when there are no linked worktrees", async () => {
		renderMenus({
			worktrees: () => [{ path: "/repo/project", name: "project", branch: "main", isMain: true }],
		});

		await page.getByTestId("git-draft-mode-trigger").click();
		expect(page.getByTestId("git-draft-mode-sub-existing").query()).toBe(null);
	});

	it("refetches the worktree list when the mode menu opens, so a worktree created since the last open is listed", async () => {
		let linked = false;
		renderMenus({
			worktrees: () => [
				{ path: "/repo/project", name: "project", branch: "main", isMain: true },
				...(linked
					? [
							{
								path: "/repo/project/.kilo/worktrees/kilo-new",
								name: "kilo-new",
								branch: "kilo/new",
								isMain: false,
							},
						]
					: []),
			],
		});

		await page.getByTestId("git-draft-mode-trigger").click();
		expect(page.getByTestId("git-draft-mode-sub-existing").query()).toBe(null);
		await page.getByTestId("git-draft-mode-trigger").click();

		linked = true;
		await page.getByTestId("git-draft-mode-trigger").click();
		await expect.element(page.getByTestId("git-draft-mode-sub-existing")).toBeVisible();
	});
});
