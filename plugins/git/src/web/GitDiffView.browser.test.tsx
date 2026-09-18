import { act, fireEvent } from "@testing-library/react";
import { createFakeSdk, createFakeTheme } from "@kilo-desktop/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	FIRST_FILE,
	filesPanel,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
} from "./test-utils.js";

afterEach(resetViewTestDom);

describe("GitDiffView", () => {
	it("keeps the diff and file tree on the active preset across same-mode changes", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const theme = createFakeTheme();
		renderView({}, createFakeSdk({ featureId: "git", theme }));
		await waitForTreePath("README.md");
		const themeCss = () =>
			document
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-theme-css]")
				?.textContent?.toLowerCase();
		await act(async () =>
			theme.setAppearance({
				...theme.appearance(),
				shiki: "catppuccin-latte",
			}),
		);
		await vi.waitFor(() => {
			expect(themeCss()).toContain("#4c4f69");
			expect(treeHost()?.style.getPropertyValue("--trees-theme-sidebar-fg")).toBe("#4c4f69");
		});
	});

	it("uses the app's compact text scale for diff content", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await vi.waitFor(() => {
			const customCss = document
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-unsafe-css]")?.textContent;
			expect(customCss).toContain("--diffs-font-size: 0.75rem");
			expect(customCss).toContain("--diffs-line-height: 1.125rem");
		});
	});

	it("shows an explicit state when the chat has no workspace", async () => {
		renderView({ workspaceDirectory: undefined });
		await expect.element(page.getByTestId("git-diff-no-workspace")).toBeVisible();
	});

	it("renders tree rows in patch order instead of the default semantic sort", async () => {
		// Real git byte order lists `foo.txt` before `foo/` ("foo." < "foo/");
		// the tree's default sort would flip them (folders first). The sidebar
		// must follow the same patch path sequence that drives the code view.
		const patch = `diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1 +1 @@
-old
+new
diff --git a/foo/bar.ts b/foo/bar.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/foo/bar.ts
@@ -0,0 +1 @@
+export const value = 1;
`;
		stubFetch(() => new Response(patchResponseStream(24, patch)));
		renderView();

		// The tab content StrictMode double-mounts, so the first mount's tree
		// tears down and rebuilds before the state settles; poll for the
		// settled row order instead of asserting a single DOM snapshot.
		await vi.waitFor(() => {
			const rowOrder = Array.from(
				treeHost()?.shadowRoot?.querySelectorAll("[data-item-path]") ?? [],
			).map((row) => row.getAttribute("data-item-path"));
			expect(rowOrder).toEqual(["foo.txt", "foo/", "foo/bar.ts"]);
		});
	});

	it("streams the patch into the tree, the stats, and the code view", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		renderView();

		await waitForTreePath("README.md");
		await waitForTreePath("src/new.ts");

		// `toHaveTextContent` requires a full-text match; the stats spans carry
		// several numbers, so assert on the element's text content directly.
		await vi.waitFor(() => {
			const statsText = document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
			expect(statsText).toContain("2 files");
			expect(statsText).toContain("+2");
			expect(statsText).toContain("−1");
		});

		// Status badges mirror the patch's change types: the modified file
		// shows "M", and the new file (untracked files are indistinguishable
		// from staged-new in a worktree-vs-HEAD patch) shows "A".
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="README.md"] [data-item-section="git"]',
				)?.textContent,
			).toBe("M");
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="src/new.ts"] [data-item-section="git"]',
				)?.textContent,
			).toBe("A");
		});

		// The CodeView mounts one diffs-container per streamed file. The diff
		// body itself awaits the highlight pipeline (worker-driven in the real
		// app), so the stable assertion is the rendered item headers: file
		// names plus their per-file +/- counts.
		await vi.waitFor(() => {
			const containers = Array.from(document.querySelectorAll("diffs-container"));
			expect(containers).toHaveLength(2);
			const headers = containers
				.map((host) => host.shadowRoot?.querySelector("[data-diffs-header]")?.textContent ?? "")
				.join("\n");
			expect(headers).toContain("README.md");
			expect(headers).toContain("src/new.ts");
			expect(headers).toContain("+1");
			// diffs headers use the plain hyphen for deletions (the app header
			// uses the typographic minus).
			expect(headers).toContain("-1");
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project")}`,
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("renders the no-changes state for an empty patch", async () => {
		stubFetch(() => new Response(""));
		renderView();
		await expect.element(page.getByTestId("git-diff-empty")).toBeVisible();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-sidebar"]')).not.toBeNull();
			const placeholder = document.querySelector('[data-qa-id="git-diff-tree-placeholder"]');
			expect(placeholder?.textContent ?? "").toContain("No changed files.");
		});
	});

	it("shows a loading placeholder in the viewer and the tree while the fetch stalls", async () => {
		// A fetch that never settles pins the view in the fetching state, so
		// the initial-loading placeholders are the settled DOM to assert on.
		stubFetch(() => new Promise<Response>(() => {}));
		renderView();

		await vi.waitFor(() => {
			const viewerLoading = document.querySelector('[data-qa-id="git-diff-viewer-loading"]');
			expect(viewerLoading?.textContent ?? "").toContain("Fetching changes");
			expect(viewerLoading?.getAttribute("role")).toBe("status");
		});
		await vi.waitFor(() => {
			expect(
				document.querySelector('[data-qa-id="git-diff-tree-placeholder"]')?.textContent ?? "",
			).toContain("Loading changes…");
		});
	});

	it("renders the error state with the response text and retries", async () => {
		const fetchMock = stubFetch(() => new Response("Not a git repository.", { status: 404 }));
		renderView();

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("Not a git repository");
			expect(errorText).toContain("This folder isn't a git repository.");
		});

		stubFetch(() => new Response(""));
		await page.getByTestId("git-diff-retry").click();
		await expect.element(page.getByTestId("git-diff-empty")).toBeVisible();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes on demand", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-refresh").click();
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		await waitForTreePath("README.md");
	});

	it("renders singular stats for a single changed file", async () => {
		stubFetch(() => new Response(patchResponseStream(24, FIRST_FILE)));
		renderView();
		await waitForTreePath("first.txt");
		await vi.waitFor(() => {
			const statsText = document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
			expect(statsText).toContain("1 file");
			expect(statsText).not.toContain("1 files");
		});
	});

	it("surfaces the generic error for a 200 body that is not a patch", async () => {
		stubFetch(() => new Response("this is not a git patch"));
		renderView();

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("could not be loaded");
		});
	});

	it("surfaces a status-only failure message when the error body is empty", async () => {
		stubFetch(() => new Response("", { status: 500 }));
		renderView();

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("Request failed (500).");
		});
	});

	it("hides and restores the file tree panel from the toolbar toggle", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		});

		const toggle = page.getByTestId("git-diff-tree-toggle");
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("0px");
		});
		// Collapsing hides the panel but keeps the tree mounted so its
		// selection and scroll survive the round trip.
		expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]')).not.toBeNull();

		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		});
	});

	it("resizes the file tree panel from the keyboard, clamped to the minimum width", async () => {
		localStorage.setItem("git.diffFilesWidth", "170");
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("170px");
		});

		const handle = () => document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree-resize"]');
		// The tree sits right of the divider, so ArrowRight (divider pushed
		// right) shrinks it; 170 - 12 lands below the floor and clamps to 160.
		fireEvent.keyDown(handle()!, { key: "ArrowRight" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		});
		// At the floor, further shrink requests stay clamped.
		fireEvent.keyDown(handle()!, { key: "ArrowRight" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		});

		fireEvent.keyDown(handle()!, { key: "ArrowLeft", shiftKey: true });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("200px");
		});
		// The resized width persists for the next session.
		expect(localStorage.getItem("git.diffFilesWidth")).toBe("200");
	});

	it("falls back to the default panel width when the stored width is corrupt", async () => {
		localStorage.setItem("git.diffFilesWidth", '"wide"');
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		});
	});

	it("reopens a collapsed file tree panel from the resize handle", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await page.getByTestId("git-diff-tree-toggle").click();
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("0px");
		});

		// The collapsed panel's right-edge handle is its only visible
		// affordance; growing the tree from it (ArrowLeft pulls the divider
		// away from the right edge) reopens the panel at the minimum width.
		const handle = document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree-resize"]');
		fireEvent.keyDown(handle!, { key: "ArrowLeft" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		});
		await expect
			.element(page.getByTestId("git-diff-tree-toggle"))
			.toHaveAttribute("aria-pressed", "false");
	});
});
