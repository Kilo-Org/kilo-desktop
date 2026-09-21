import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { FeatureError } from "@kilo-desktop/feature-sdk";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import {
	gitContract,
	type GitBranchesResult,
	type GitRepositoryType,
	type GitServiceContract,
} from "../contracts/schemas.js";
import { GitBranchSelector } from "./GitBranchSelector.js";

const toastApi = vi.hoisted(() => ({
	error: vi.fn(),
}));

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	toast: toastApi,
}));

type CheckoutInput = Parameters<GitServiceContract["checkout"]>[0];

const branchesResult: GitBranchesResult = {
	currentBranch: "main",
	defaultBranch: "main",
	recentBranches: [],
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
};

const featureBranchesResult: GitBranchesResult = {
	currentBranch: "feature-x",
	defaultBranch: "main",
	recentBranches: [],
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
};

const remoteBranchesResult: GitBranchesResult = {
	currentBranch: "main",
	defaultBranch: "main",
	recentBranches: [],
	branches: [
		{
			name: "main",
			upstream: "origin/main",
			tip: { sha: "a" },
			ref: "refs/heads/main",
			kind: "local",
		},
		{
			name: "origin/feature",
			upstream: null,
			tip: { sha: "c" },
			ref: "refs/remotes/origin/feature",
			kind: "remote",
		},
	],
};

/** Default + Recent + Other all populated: main is the default, feature-x recent, develop other. */
const groupedResult: GitBranchesResult = {
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
			name: "origin/develop",
			upstream: null,
			tip: { sha: "c" },
			ref: "refs/remotes/origin/develop",
			kind: "remote",
		},
	],
};

const regularRepositoryType: GitRepositoryType = {
	kind: "regular",
	topLevelWorkingDirectory: "/repo/project",
	gitDir: "/repo/project/.git",
};

function renderSelector(
	handlers: {
		repositoryType?: () => GitRepositoryType | Promise<GitRepositoryType>;
		branches: () => GitBranchesResult | null | Promise<GitBranchesResult | null>;
		checkout?: (input: CheckoutInput) => Promise<void>;
		init?: (input: { workingDirectory: string }) => Promise<void> | void;
	},
	options?: { workspaceDirectory?: string | undefined },
) {
	// `options` present means its value is authoritative — including an
	// explicit `undefined` (unscoped chat), so `??` is deliberately avoided.
	const workspaceDirectory = options === undefined ? "/repo/project" : options.workspaceDirectory;
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		repositoryType: ({ workingDirectory: probedDirectory }) => {
			if (workspaceDirectory === undefined) throw new Error("probed without a workspace");
			expect(probedDirectory).toBe(workspaceDirectory);
			return handlers.repositoryType?.() ?? regularRepositoryType;
		},
		branches: ({ workingDirectory: probedDirectory }) => {
			expect(probedDirectory).toBe(workspaceDirectory);
			return handlers.branches();
		},
		checkout: async (input) => {
			await handlers.checkout?.(input);
			return undefined;
		},
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		init: async (input) => {
			await handlers.init?.(input);
			return undefined;
		},
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
		defaultBranch: () => {
			throw new Error("unused in this test");
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<GitBranchSelector workspaceDirectory={workspaceDirectory} />
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, sdk, mainSdk, queryClient };
}

/**
 * The dedicated trigger — always rendered and clickable like the workspace
 * selector's — opens the popover, whose inline note narrates the state.
 */
async function openTrigger(label: string, note: string) {
	const trigger = page.getByTestId("git-branch-selector-trigger");
	await expect.element(trigger).toBeVisible();
	await expect.element(trigger).toBeEnabled();
	await expect.element(trigger).toHaveTextContent(label);
	await trigger.click();
	const noteElement = page.getByTestId("git-branch-selector-note");
	await expect.element(noteElement).toBeVisible();
	await expect.element(noteElement).toHaveTextContent(note);
	return trigger;
}

afterEach(() => {
	cleanup();
	toastApi.error.mockReset();
});

describe("GitBranchSelector", () => {
	it("shows the current branch on the trigger", async () => {
		renderSelector({ branches: () => branchesResult });

		await expect.element(page.getByTestId("git-branch-selector-trigger")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toHaveTextContent("main");
	});

	it("opens with a neutral label and inline note without a workspace directory", async () => {
		renderSelector({ branches: () => branchesResult }, { workspaceDirectory: undefined });

		await openTrigger("Select branch", "No workspace selected.");
	});

	it("replaces the trigger with the Initialize Git button for a missing workspace and never probes branches", async () => {
		const branches = vi.fn(() => branchesResult);
		renderSelector({
			repositoryType: () => ({ kind: "missing" }),
			branches,
		});

		await expect.element(page.getByTestId("git-init-draft-button")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-selector-trigger")).not.toBeInTheDocument();
		expect(branches).not.toHaveBeenCalled();
	});

	it("runs init from the draft footer button and restores the trigger once the refetch reports regular", async () => {
		let initialized = false;
		const init = vi.fn(async () => {
			initialized = true;
		});
		renderSelector({
			repositoryType: () => (initialized ? regularRepositoryType : { kind: "missing" }),
			branches: () => branchesResult,
			init,
		});

		const button = page.getByTestId("git-init-draft-button");
		await expect.element(button).toBeVisible();
		await button.click();

		await vi.waitFor(() => {
			expect(init).toHaveBeenCalledWith({ workingDirectory: "/repo/project" });
		});
		// Success invalidates repositoryType → the refetch reports
		// `regular` → the init button is replaced by the trigger.
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toBeVisible();
		await expect.element(page.getByTestId("git-init-draft-button")).not.toBeInTheDocument();
	});

	it("shows an inline note for an unsafe workspace and never probes branches", async () => {
		const branches = vi.fn(() => branchesResult);
		renderSelector({
			repositoryType: () => ({ kind: "unsafe", path: "/repo/project" }),
			branches,
		});

		await openTrigger("Select branch", "Not a git repository.");
		expect(branches).not.toHaveBeenCalled();
	});

	it("shows an inline note for a bare workspace and never probes branches", async () => {
		const branches = vi.fn(() => branchesResult);
		renderSelector({
			repositoryType: () => ({ kind: "bare" }),
			branches,
		});

		await openTrigger("Select branch", "Not a git repository.");
		expect(branches).not.toHaveBeenCalled();
	});

	it("shows an inline note when the repository type query errors and never probes branches", async () => {
		const branches = vi.fn(() => branchesResult);
		renderSelector({
			repositoryType: () => {
				throw new FeatureError("Git executable not found.", "BUSINESS");
			},
			branches,
		});

		await openTrigger("Select branch", "Git is unavailable.");
		expect(branches).not.toHaveBeenCalled();
	});

	it("shows an inline loading note while the repository type probe is in flight", async () => {
		renderSelector({
			repositoryType: () => new Promise<GitRepositoryType>(() => {}),
			branches: () => branchesResult,
		});

		await openTrigger("Loading…", "Loading…");
	});

	it("shows an inline note when the branches probe resolves null", async () => {
		renderSelector({ branches: () => null });

		await openTrigger("Select branch", "Something went wrong!");
	});

	it("shows an inline note when the branches query errors", async () => {
		renderSelector({
			branches: () => {
				throw new Error("boom");
			},
		});

		await openTrigger("Select branch", "Something went wrong!");
	});

	it("renders the Desktop-parity group headings with branches in their buckets", async () => {
		renderSelector({ branches: () => groupedResult });

		await page.getByTestId("git-branch-selector-trigger").click();

		const defaultHeading = page.getByText("Default Branch");
		const recentHeading = page.getByText("Recent Branches");
		const otherHeading = page.getByText("Other Branches");
		await expect.element(defaultHeading).toBeVisible();
		await expect.element(recentHeading).toBeVisible();
		await expect.element(otherHeading).toBeVisible();

		// Bucket membership by document order: each item follows its own
		// group's heading and precedes the next group's.
		const isBetween = (item: string, after: string, before?: string) => {
			const itemElement = page.getByTestId(`git-branch-item-${item}`).element();
			const afterElement = page.getByText(after).element();
			expect(
				itemElement.compareDocumentPosition(afterElement) & Node.DOCUMENT_POSITION_PRECEDING,
			).toBe(Node.DOCUMENT_POSITION_PRECEDING);
			if (before !== undefined) {
				const beforeElement = page.getByText(before).element();
				expect(
					itemElement.compareDocumentPosition(beforeElement) & Node.DOCUMENT_POSITION_FOLLOWING,
				).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
			}
		};
		isBetween("main", "Default Branch", "Recent Branches");
		isBetween("feature-x", "Recent Branches", "Other Branches");
		isBetween("develop", "Other Branches");
	});

	it("auto-hides groups whose branches do not match the search", async () => {
		renderSelector({ branches: () => groupedResult });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await search.fill("develop");

		await expect.element(page.getByTestId("git-branch-item-develop")).toBeVisible();
		// cmdk hides an emptied group via aria-hidden rather than removing it.
		await expect.element(page.getByText("Default Branch")).not.toBeVisible();
		await expect.element(page.getByText("Recent Branches")).not.toBeVisible();

		await search.fill("feature");
		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		await expect.element(page.getByText("Default Branch")).not.toBeVisible();
		await expect.element(page.getByText("Other Branches")).not.toBeVisible();
	});

	it("lists branches with the current one checked", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();

		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		const main = page.getByTestId("git-branch-item-main").element();
		expect(main).toHaveAttribute("data-checked", "true");
		expect(page.getByTestId("git-branch-item-feature-x").element()).toHaveAttribute(
			"data-checked",
			"false",
		);
	});

	it("filters branches by name while searching", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await expect.element(search).toBeVisible();

		await search.fill("feature");
		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-item-main")).not.toBeInTheDocument();

		await search.fill("main");
		await expect.element(page.getByTestId("git-branch-item-main")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-item-feature-x")).not.toBeInTheDocument();
	});

	it("closes the popover and updates the trigger before checkout finishes", async () => {
		let finishCheckout: (() => void) | undefined;
		const checkout = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCheckout = resolve;
				}),
		);
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-item-feature-x").click();

		await expect
			.element(page.getByRole("combobox", { name: "Search branches" }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("git-branch-selector-trigger"))
			.toHaveTextContent("feature-x");
		expect(checkout).toHaveBeenCalled();
		finishCheckout?.();
	});

	it("checks out a branch when it is selected", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-item-feature-x").click();

		await vi.waitFor(() => {
			expect(checkout).toHaveBeenCalledWith({
				workingDirectory: "/repo/project",
				branch: "feature-x",
			});
		});
		await expect
			.element(page.getByRole("combobox", { name: "Search branches" }))
			.not.toBeInTheDocument();
	});

	it("checks out a remote branch with tracking when it is selected", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => remoteBranchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await expect.element(page.getByTestId("git-branch-item-feature")).toBeVisible();
		await expect.element(page.getByText("origin/feature")).not.toBeInTheDocument();
		await page.getByTestId("git-branch-item-feature").click();

		await vi.waitFor(() => {
			expect(checkout).toHaveBeenCalledWith({
				workingDirectory: "/repo/project",
				branch: "origin/feature",
				kind: "remote",
			});
		});
	});

	it("clears the search when a branch checkout closes the popover", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await search.fill("feature");
		await expect.element(page.getByTestId("git-branch-item-main")).not.toBeInTheDocument();

		await page.getByTestId("git-branch-item-feature-x").click();
		await vi.waitFor(() => {
			expect(checkout).toHaveBeenCalled();
		});
		await expect
			.element(page.getByRole("combobox", { name: "Search branches" }))
			.not.toBeInTheDocument();

		await page.getByTestId("git-branch-selector-trigger").click();
		const reopenedSearch = page.getByRole("combobox", { name: "Search branches" });
		await expect.element(reopenedSearch).toHaveValue("");
		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-item-main")).toBeVisible();
	});

	it("clears the search when Escape closes the popover", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await search.fill("feature");
		await expect.element(page.getByTestId("git-branch-item-main")).not.toBeInTheDocument();

		await userEvent.keyboard("{Escape}");
		await expect
			.element(page.getByRole("combobox", { name: "Search branches" }))
			.not.toBeInTheDocument();

		await page.getByTestId("git-branch-selector-trigger").click();
		await expect.element(page.getByRole("combobox", { name: "Search branches" })).toHaveValue("");
		await expect.element(page.getByTestId("git-branch-item-main")).toBeVisible();
	});

	it("clears the search when the create flow closes the popover", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByRole("combobox", { name: "Search branches" }).fill("zzz");
		await page.getByTestId("git-branch-create").click();

		const dialog = page.getByTestId("git-branch-create-dialog");
		await expect.element(dialog).toBeVisible();
		await expect.element(page.getByTestId("git-branch-create-name")).toHaveValue("zzz");
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect.element(dialog).not.toBeInTheDocument();

		await page.getByTestId("git-branch-selector-trigger").click();
		await expect.element(page.getByRole("combobox", { name: "Search branches" })).toHaveValue("");
		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-item-main")).toBeVisible();
	});

	it("opens the create dialog with the search text and creates on submit", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await search.fill("zzz");

		const create = page.getByTestId("git-branch-create");
		await expect.element(create).toBeVisible();
		// Mirrors WorkspacePicker: the cmdk empty state coexists with the
		// force-mounted create item.
		await expect.element(page.getByText("No branches found.")).toBeVisible();
		await create.click();

		await expect.element(page.getByTestId("git-branch-create-dialog")).toBeVisible();
		await expect.element(page.getByTestId("git-branch-create-name")).toHaveValue("zzz");

		await page.getByTestId("git-branch-create-submit").click();

		await vi.waitFor(() => {
			expect(checkout).toHaveBeenCalledWith({
				workingDirectory: "/repo/project",
				branch: "zzz",
				create: true,
			});
		});
		await expect.element(page.getByTestId("git-branch-create-dialog")).not.toBeInTheDocument();
	});

	it("opens the create dialog from the pinned item without typing", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-create").click();

		await expect.element(page.getByTestId("git-branch-create-dialog")).toBeVisible();
		const name = page.getByTestId("git-branch-create-name");
		await expect.element(name).toHaveValue("");

		await name.fill("feat-y");
		await page.getByTestId("git-branch-create-submit").click();

		await vi.waitFor(() => {
			expect(checkout).toHaveBeenCalledWith({
				workingDirectory: "/repo/project",
				branch: "feat-y",
				create: true,
			});
		});
	});

	it("closes the create dialog on cancel without creating anything", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-create").click();

		const dialog = page.getByTestId("git-branch-create-dialog");
		await expect.element(dialog).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();

		await expect.element(dialog).not.toBeInTheDocument();
		expect(checkout).not.toHaveBeenCalled();
	});

	it("keeps the create dialog submit disabled while the name is blank", async () => {
		const checkout = vi.fn(() => Promise.resolve());
		renderSelector({ branches: () => branchesResult, checkout });

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-create").click();

		const submit = page.getByTestId("git-branch-create-submit");
		await expect.element(submit).toBeVisible();
		await expect.element(submit).toBeDisabled();
		expect(checkout).not.toHaveBeenCalled();
	});

	it("pins the create item outside the scrollable list before typing", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();

		const create = page.getByTestId("git-branch-create");
		await expect.element(create).toBeVisible();
		// Always enabled like "Create workspace": the name is asked for in
		// the dialog, not the search field.
		expect(create.element()).not.toHaveAttribute("aria-disabled", "true");
		await expect.element(create).toHaveTextContent("Create branch");
		// Pinned outside the scrollable list so it never scrolls away.
		expect(create.element().closest('[data-slot="command-list"]')).toBe(null);
		// Pinned last: after the final branch item, like "Create workspace".
		const lastBranch = page.getByTestId("git-branch-item-main").element();
		expect(
			create.element().compareDocumentPosition(lastBranch) & Node.DOCUMENT_POSITION_PRECEDING,
		).toBe(Node.DOCUMENT_POSITION_PRECEDING);
	});

	it("keeps the create item pinned while a branch matches the search", async () => {
		renderSelector({ branches: () => branchesResult });

		await page.getByTestId("git-branch-selector-trigger").click();
		const search = page.getByRole("combobox", { name: "Search branches" });
		await search.fill("feature");

		await expect.element(page.getByTestId("git-branch-item-feature-x")).toBeVisible();
		const create = page.getByTestId("git-branch-create");
		await expect.element(create).toBeVisible();
		expect(create.element()).not.toHaveAttribute("aria-disabled", "true");
		await expect.element(create).toHaveTextContent("Create branch");
	});

	it("shows an unborn-repo empty state with the pinned create item still enabled", async () => {
		renderSelector({
			branches: () => ({ currentBranch: undefined, branches: [], recentBranches: [] }),
		});

		await page.getByTestId("git-branch-selector-trigger").click();

		await expect.element(page.getByText("No branches yet.")).toBeVisible();
		await expect.element(page.getByText("No branches found.")).not.toBeInTheDocument();
		const create = page.getByTestId("git-branch-create");
		await expect.element(create).toBeVisible();
		expect(create.element()).not.toHaveAttribute("aria-disabled", "true");
	});

	it("inlines a failed create in the dialog instead of toasting", async () => {
		renderSelector({
			branches: () => branchesResult,
			checkout: () =>
				Promise.reject(new FeatureError("A branch with that name already exists.", "BUSINESS")),
		});

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-create").click();
		await page.getByTestId("git-branch-create-name").fill("feature-x");
		await page.getByTestId("git-branch-create-submit").click();

		const dialog = page.getByTestId("git-branch-create-dialog");
		await expect.element(dialog).toBeVisible();
		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("A branch with that name already exists.");
		expect(page.getByTestId("git-branch-create-name").element()).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		expect(toastApi.error).not.toHaveBeenCalled();
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toHaveTextContent("main");
	});

	it("clears the inlined create error when the name is edited", async () => {
		renderSelector({
			branches: () => branchesResult,
			checkout: () =>
				Promise.reject(new FeatureError("A branch with that name already exists.", "BUSINESS")),
		});

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-create").click();
		await page.getByTestId("git-branch-create-name").fill("feature-x");
		await page.getByTestId("git-branch-create-submit").click();
		await expect.element(page.getByRole("alert")).toBeVisible();

		await page.getByTestId("git-branch-create-name").fill("fresh-name");

		await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
		expect(page.getByTestId("git-branch-create-name").element()).not.toHaveAttribute(
			"aria-invalid",
		);
	});

	it("surfaces a failed checkout as an error toast", async () => {
		renderSelector({
			branches: () => branchesResult,
			checkout: () =>
				Promise.reject(new FeatureError("A branch with that name already exists.", "BUSINESS")),
		});

		await page.getByTestId("git-branch-selector-trigger").click();
		await page.getByTestId("git-branch-item-feature-x").click();

		await vi.waitFor(() => {
			expect(toastApi.error).toHaveBeenCalledWith("Could not switch branches", {
				description: "A branch with that name already exists.",
			});
		});
		await expect.element(page.getByTestId("git-branch-selector-trigger")).toHaveTextContent("main");
	});

	describe("CreateBranchDialog based-on choice", () => {
		it("offers the detected default branch pre-selected when it differs from the current branch", async () => {
			const checkout = vi.fn(() => Promise.resolve());
			renderSelector({
				branches: () => ({
					currentBranch: "feature-x",
					// Not the `main ?? master` heuristic: the detected default is
					// what the dialog must offer.
					defaultBranch: "trunk",
					recentBranches: [],
					branches: [
						{
							name: "feature-x",
							upstream: null,
							tip: { sha: "b" },
							ref: "refs/heads/feature-x",
							kind: "local",
						},
						{
							name: "trunk",
							upstream: null,
							tip: { sha: "a" },
							ref: "refs/heads/trunk",
							kind: "local",
						},
					],
				}),
				checkout,
			});

			await page.getByTestId("git-branch-selector-trigger").click();
			await page.getByTestId("git-branch-create").click();

			const base = page.getByTestId("git-branch-create-base");
			await expect.element(base).toBeVisible();
			expect(base.element().textContent).toContain("trunk");

			await page.getByTestId("git-branch-create-name").fill("topic");
			await page.getByTestId("git-branch-create-submit").click();

			await vi.waitFor(() => {
				expect(checkout).toHaveBeenCalledWith({
					workingDirectory: "/repo/project",
					branch: "topic",
					create: true,
					startPoint: "trunk",
				});
			});
		});

		it("offers the default branch pre-selected when it differs from the current branch", async () => {
			const checkout = vi.fn(() => Promise.resolve());
			renderSelector({ branches: () => featureBranchesResult, checkout });

			await page.getByTestId("git-branch-selector-trigger").click();
			await page.getByTestId("git-branch-create").click();

			const base = page.getByTestId("git-branch-create-base");
			await expect.element(base).toBeVisible();
			expect(base.element().textContent).toContain("main");

			await page.getByTestId("git-branch-create-name").fill("topic");
			await page.getByTestId("git-branch-create-submit").click();

			await vi.waitFor(() => {
				expect(checkout).toHaveBeenCalledWith({
					workingDirectory: "/repo/project",
					branch: "topic",
					create: true,
					startPoint: "main",
				});
			});
		});

		it("sends no start point when the current branch is picked", async () => {
			const checkout = vi.fn(() => Promise.resolve());
			renderSelector({ branches: () => featureBranchesResult, checkout });

			await page.getByTestId("git-branch-selector-trigger").click();
			await page.getByTestId("git-branch-create").click();

			await page.getByTestId("git-branch-create-base").click();
			await page.getByTestId("git-branch-create-base-current").click();

			await page.getByTestId("git-branch-create-name").fill("topic");
			await page.getByTestId("git-branch-create-submit").click();

			await vi.waitFor(() => {
				expect(checkout).toHaveBeenCalledWith({
					workingDirectory: "/repo/project",
					branch: "topic",
					create: true,
				});
			});
		});

		it("shows the informational based-on copy instead of a select when current is default", async () => {
			const checkout = vi.fn(() => Promise.resolve());
			renderSelector({ branches: () => branchesResult, checkout });

			await page.getByTestId("git-branch-selector-trigger").click();
			await page.getByTestId("git-branch-create").click();

			await expect
				.element(
					page.getByText(
						"Your new branch will be based on your currently checked out branch (main).",
					),
				)
				.toBeVisible();
			await expect.element(page.getByTestId("git-branch-create-base")).not.toBeInTheDocument();
		});
	});
});
