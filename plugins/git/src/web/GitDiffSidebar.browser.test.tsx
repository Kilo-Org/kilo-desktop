import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	FIRST_FILE,
	SECOND_FILE,
	controlledPatchStream,
	delayedFileResponseStream,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
} from "./test-utils.js";

afterEach(resetViewTestDom);

describe("GitDiffSidebar folder select", () => {
	it("shows a workspace-folder select above the search filter for multi-folder workspaces", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView({
			workspaceFolders: [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/other", isPrimary: false },
			],
		});
		await waitForTreePath("README.md");

		// StrictMode double-mounts tear the sidebar down mid-test, so poll
		// for the settled DOM instead of asserting a single snapshot.
		await vi.waitFor(() => {
			const sidebar = document.querySelector('[data-qa-id="git-diff-sidebar"]');
			const select = sidebar?.querySelector('[data-qa-id="git-diff-folder-select"]') ?? null;
			const search = sidebar?.querySelector('[data-qa-id="git-diff-search"]') ?? null;
			expect(select).not.toBeNull();
			expect(search).not.toBeNull();
			expect(select!.textContent).toContain("project");
			expect(
				select!.compareDocumentPosition(search!) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		});
	});

	it("hides the workspace-folder select when the workspace has a single folder", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await vi.waitFor(() => {
			expect(
				document
					.querySelector('[data-qa-id="git-diff-sidebar"]')
					?.querySelector('[data-qa-id="git-diff-folder-select"]'),
			).toBeNull();
		});
	});

	it("labels duplicate folder basenames with their full paths", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView({
			workspaceFolders: [
				{ path: "/monorepo/app", isPrimary: true },
				{ path: "/other/app", isPrimary: false },
			],
		});
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-folder-select").click();
		await expect.element(page.getByRole("option", { name: "/monorepo/app" })).toBeVisible();
		await expect.element(page.getByRole("option", { name: "/other/app" })).toBeVisible();
	});

	it("re-fetches the diff for the workspace folder selected in the folder select", async () => {
		const fetchMock = stubFetch(
			(url) =>
				new Response(
					patchResponseStream(
						24,
						url.includes(encodeURIComponent("/workspace/other")) ? SECOND_FILE : FIRST_FILE,
					),
				),
		);
		renderView({
			workspaceFolders: [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/other", isPrimary: false },
			],
		});
		await waitForTreePath("first.txt");

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "other" }).click();

		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/other")}`,
				expect.objectContaining({ cache: "no-store" }),
			);
		});
		await waitForTreePath("second.txt");
		await vi.waitFor(() => {
			const triggerText =
				document.querySelector('[data-qa-id="git-diff-folder-select"]')?.textContent ?? "";
			expect(triggerText).toContain("other");
		});
	});

	it("a folder switch during a refresh clears the busy state", async () => {
		const stalledRefresh = controlledPatchStream();
		let projectFetches = 0;
		stubFetch((url) => {
			if (url.includes(encodeURIComponent("/workspace/other"))) {
				return new Response(patchResponseStream(24, SECOND_FILE));
			}
			projectFetches++;
			return projectFetches === 1
				? new Response(patchResponseStream(24, FIRST_FILE))
				: new Response(stalledRefresh.stream);
		});
		renderView({
			workspaceFolders: [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/other", isPrimary: false },
			],
		});
		await waitForTreePath("first.txt");
		const refreshButton = () =>
			document.querySelector<HTMLButtonElement>('[data-qa-id="git-diff-refresh"]');
		await vi.waitFor(() => {
			expect(refreshButton()?.disabled).toBe(false);
		});

		fireEvent.click(refreshButton()!);
		await vi.waitFor(() => {
			expect(refreshButton()?.disabled).toBe(true);
		});

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "other" }).click();
		await waitForTreePath("second.txt");
		await vi.waitFor(() => {
			expect(refreshButton()?.disabled).toBe(false);
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		});
	});

	it("keeps the folder switcher usable when the selected folder is not a git repository", async () => {
		stubFetch((url) =>
			url.includes(encodeURIComponent("/workspace/other"))
				? new Response("Not a git repository.", { status: 404 })
				: new Response(patchResponseStream(24, FIRST_FILE)),
		);
		renderView({
			workspaceFolders: [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/other", isPrimary: false },
			],
		});
		await waitForTreePath("first.txt");

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "other" }).click();

		// StrictMode double-mounts tear the DOM down mid-test, so poll for the
		// settled state instead of asserting a single snapshot.
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-folder-select"]')).not.toBeNull();
			expect(document.querySelector('[data-qa-id="git-diff-error"]')).not.toBeNull();
			const placeholder = document.querySelector('[data-qa-id="git-diff-tree-placeholder"]');
			expect(placeholder?.textContent ?? "").toContain("Not a git repository.");
		});

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "project" }).click();
		await waitForTreePath("first.txt");
	});

	it("falls back to the workspace directory when the chosen folder leaves the folder list", async () => {
		const propUrl = `kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project")}`;
		const fetchMock = stubFetch(
			(url) =>
				new Response(
					patchResponseStream(
						24,
						url.includes(encodeURIComponent("/workspace/other")) ? SECOND_FILE : FIRST_FILE,
					),
				),
		);
		const { rerender } = renderView({
			workspaceFolders: [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/other", isPrimary: false },
			],
		});
		await waitForTreePath("first.txt");

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "other" }).click();
		await waitForTreePath("second.txt");

		const propUrlCallsBefore = fetchMock.mock.calls.filter(
			([url]) => String(url) === propUrl,
		).length;
		rerender({ workspaceFolders: [{ path: "/workspace/project", isPrimary: true }] });

		await vi.waitFor(() => {
			const propUrlCalls = fetchMock.mock.calls.filter(([url]) => String(url) === propUrl).length;
			expect(propUrlCalls).toBeGreaterThan(propUrlCallsBefore);
		});
		await waitForTreePath("first.txt");
		await vi.waitFor(() => {
			expect(
				document
					.querySelector('[data-qa-id="git-diff-sidebar"]')
					?.querySelector('[data-qa-id="git-diff-folder-select"]'),
			).toBeNull();
		});
	});
});

describe("GitDiffSidebar tree search", () => {
	it("filters the tree as you type", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-search").fill("readme");
		await vi.waitFor(() => {
			expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]')).not.toBeNull();
			expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="src/"]') ?? null).toBeNull();
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="src/new.ts"]') ?? null,
			).toBeNull();
		});
	});

	it("clearing the search restores all rows", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		const search = page.getByTestId("git-diff-search");
		await search.fill("readme");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="src/new.ts"]') ?? null,
			).toBeNull();
		});

		await search.fill("");
		await vi.waitFor(() => {
			expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]')).not.toBeNull();
			expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="src/new.ts"]')).not.toBeNull();
		});
	});

	it("keeps the search filter across refresh", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-search").fill("readme");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="src/new.ts"]') ?? null,
			).toBeNull();
		});

		// A lingering browser pointer can open a tooltip that overlaps the
		// refresh button. Move the pointer to the input first so lingering
		// tooltips close, then click.
		await page.getByTestId("git-diff-search").hover();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="tooltip-content"][data-open=""]')).toBeNull();
		});
		await page.getByTestId("git-diff-refresh").click();
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		await waitForTreePath("README.md");
		// Discriminating pair: the input still holds the query AND the
		// non-match stays hidden after the refresh. The tree now survives an
		// in-place refresh (no remount — the unchanged path list skips the
		// reset), so this pins resetPaths being skipped, not a rebuild that
		// happens to restore the same search state.
		await vi.waitFor(() => {
			const input = document.querySelector<HTMLInputElement>('[data-qa-id="git-diff-search"]');
			expect(input?.value).toBe("readme");
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="src/new.ts"]') ?? null,
			).toBeNull();
		});
	});

	it("keeps streamed rows filtered by the active query", async () => {
		stubFetch(() => new Response(delayedFileResponseStream([FIRST_FILE, SECOND_FILE])));
		renderView();

		await waitForTreePath("first.txt");
		await page.getByTestId("git-diff-search").fill("second");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="first.txt"]') ?? null,
			).toBeNull();
		});

		// second.txt streams in later, under the active query: it appears
		// while the non-match stays hidden.
		await waitForTreePath("second.txt");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="first.txt"]') ?? null,
			).toBeNull();
		});
	});
});

describe("GitDiffSidebar tree streaming", () => {
	it("adds streamed files to the tree incrementally", async () => {
		stubFetch(() => new Response(delayedFileResponseStream([FIRST_FILE, SECOND_FILE])));
		renderView();

		await waitForTreePath("first.txt");
		expect(
			treeHost()?.shadowRoot?.querySelector('[data-item-path="second.txt"]') ?? null,
		).toBeNull();

		await waitForTreePath("second.txt");
		await vi.waitFor(() => {
			const statsText = document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
			expect(statsText).toContain("2 files");
		});
	});
});

describe("GitDiffSidebar panel", () => {
	it("renders a resize separator between the file tree and the code view", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await expect.element(page.getByRole("separator")).toBeVisible();
	});

	it("resizes the file tree from the keyboard and persists the layout", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();

		// StrictMode double-mounts the tab content; wait for the settled
		// post-load state before grabbing element references.
		let separator: HTMLElement | null = null;
		let sidebar: HTMLElement | null = null;
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
			separator = document.querySelector<HTMLElement>('[role="separator"]');
			sidebar = document.querySelector<HTMLElement>('[data-qa-id="git-diff-sidebar"]');
			expect(separator).not.toBeNull();
			expect(sidebar).not.toBeNull();
		});
		const initialWidth = sidebar!.getBoundingClientRect().width;
		expect(initialWidth).toBeGreaterThan(0);

		// The tree sits right of the separator, so growing the separator
		// (ArrowRight) shrinks it.
		fireEvent.keyDown(separator!, { key: "ArrowRight" });
		await vi.waitFor(() => {
			expect(sidebar!.getBoundingClientRect().width).toBeLessThan(initialWidth);
		});

		const saved = localStorage.getItem("git.diffFilesWidth");
		expect(saved).not.toBeNull();
	});

	it("collapses and restores the file tree from the toolbar", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		});

		const toggle = page.getByTestId("git-diff-tree-toggle");
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		const sidebar = () => document.querySelector<HTMLElement>('[data-qa-id="git-diff-sidebar"]');
		await vi.waitFor(() => {
			expect(sidebar()?.getBoundingClientRect().width ?? 0).toBeGreaterThan(0);
		});

		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
		await vi.waitFor(() => {
			expect(sidebar()?.getBoundingClientRect().width ?? 0).toBeLessThan(1);
		});

		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		await vi.waitFor(() => {
			expect(sidebar()?.getBoundingClientRect().width ?? 0).toBeGreaterThan(0);
		});
	});

	it("keeps the collapsed file tree collapsed across a refresh", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		});

		await page.getByTestId("git-diff-tree-toggle").click();
		await vi.waitFor(() => {
			expect(
				document
					.querySelector<HTMLElement>('[data-qa-id="git-diff-sidebar"]')
					?.getBoundingClientRect().width ?? 0,
			).toBeLessThan(1);
		});

		// The refresh button lives in the sidebar toolbar, so it is not
		// clickable (by design) while the panel is collapsed; dispatch the
		// click on the DOM node — the collapse-persistence behavior under
		// test is the remount, not button reachability.
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(
				document
					.querySelector<HTMLElement>('[data-qa-id="git-diff-sidebar"]')
					?.getBoundingClientRect().width ?? 0,
			).toBeLessThan(1);
		});
	});

	it("restores the persisted panel width instead of the default width", async () => {
		// A pixel width far from the 224px default; 360px is well under the
		// 450px (50%) resize ceiling of the 900px test container.
		localStorage.setItem("git.diffFilesWidth", "360");
		stubFetch(() => new Response(patchResponseStream()));
		renderView();

		await vi.waitFor(() => {
			const sidebar = document.querySelector<HTMLElement>('[data-qa-id="git-diff-sidebar"]');
			expect(sidebar?.getBoundingClientRect().width ?? 0).toBeGreaterThan(300);
		});
	});
});
