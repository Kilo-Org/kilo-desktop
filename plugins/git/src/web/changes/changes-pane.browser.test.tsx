import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	LIGHT_THEME,
	WAIT,
	ROOT,
	FIRST_FILE,
	SECOND_PATCH,
	collapseButtonFor,
	controlledPatchStream,
	diffContainerFor,
	filesPanel,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

describe("the Changes pane", () => {
	it("keeps the diff and file tree on the active preset across same-mode changes", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const host = await renderView({}, { theme: LIGHT_THEME });
		await waitForTreePath("README.md");
		const themeCss = () =>
			document
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-theme-css]")
				?.textContent?.toLowerCase();
		await host.setTheme({ ...LIGHT_THEME, shiki: "catppuccin-latte" });
		// The new preset's Shiki theme loads on demand, which can take longer than
		// the default wait when the whole monorepo's tests run at once.
		await vi.waitFor(
			() => {
				expect(themeCss()).toContain("#4c4f69");
				expect(treeHost()?.style.getPropertyValue("--trees-theme-sidebar-fg")).toBe("#4c4f69");
			},
			{ timeout: 15_000 },
		);
	});

	it("uses the app's compact text scale for diff content", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");

		await vi.waitFor(() => {
			const customCss = document
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector("style[data-unsafe-css]")?.textContent;
			expect(customCss).toContain("--diffs-font-size: 0.6875rem");
			expect(customCss).toContain("--diffs-line-height: 1rem");
		}, WAIT);
	});

	it("shows an explicit state when the session has no workspace", async () => {
		await renderView({ workspaceId: null });
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
		await renderView();

		// The tab content StrictMode double-mounts, so the first mount's tree
		// tears down and rebuilds before the state settles; poll for the
		// settled row order instead of asserting a single DOM snapshot.
		await vi.waitFor(() => {
			const rowOrder = Array.from(
				treeHost()?.shadowRoot?.querySelectorAll("[data-item-path]") ?? [],
			).map((row) => row.getAttribute("data-item-path"));
			expect(rowOrder).toEqual(["foo.txt", "foo/", "foo/bar.ts"]);
		}, WAIT);
	});

	it("streams the patch into the tree, the stats, and the code view", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		await renderView();

		await waitForTreePath("README.md");
		await waitForTreePath("src/new.ts");

		// `toHaveTextContent` requires a full-text match; the stats spans carry
		// several numbers, so assert on the element's text content directly.
		await vi.waitFor(() => {
			const statsText = document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
			expect(statsText).toContain("2 files");
			expect(statsText).toContain("+2");
			expect(statsText).toContain("−1");
		}, WAIT);

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
		}, WAIT);

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
		}, WAIT);
		expect(fetchMock).toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project")}`,
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("renders the no-changes state for an empty patch", async () => {
		stubFetch(() => new Response(""));
		await renderView();
		await expect.element(page.getByTestId("git-diff-empty")).toBeVisible();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-sidebar"]')).not.toBeNull();
			const placeholder = document.querySelector('[data-qa-id="git-diff-tree-placeholder"]');
			expect(placeholder?.textContent ?? "").toContain("No changed files.");
		}, WAIT);
	});

	it("shows a loading placeholder in the viewer and the tree while the fetch stalls", async () => {
		// A fetch that never settles pins the view in the fetching state, so
		// the initial-loading placeholders are the settled DOM to assert on.
		stubFetch(() => new Promise<Response>(() => {}));
		await renderView();

		await vi.waitFor(() => {
			const viewerLoading = document.querySelector('[data-qa-id="git-diff-viewer-loading"]');
			expect(viewerLoading?.textContent ?? "").toContain("Fetching changes");
			expect(viewerLoading?.getAttribute("role")).toBe("status");
		}, WAIT);
		await vi.waitFor(() => {
			expect(
				document.querySelector('[data-qa-id="git-diff-tree-placeholder"]')?.textContent ?? "",
			).toContain("Loading changes…");
		}, WAIT);
	});

	it("offers to initialize git on a 404, then reloads the diff on success", async () => {
		let respond404 = true;
		const fetchMock = stubFetch(() =>
			respond404
				? new Response("Not a git repository.", { status: 404 })
				: new Response(patchResponseStream()),
		);
		const init = vi.fn(() => undefined);
		await renderView({}, { repository: { init } });

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("Not a git repository");
			expect(errorText).toContain("This folder isn't a git repository.");
			expect(errorText).toContain("Initialize git to track its changes");
		}, WAIT);
		// The 404 branch swaps Retry for Initialize Git.
		await expect.element(page.getByTestId("git-diff-init")).toBeVisible();
		expect(document.querySelector('[data-qa-id="git-diff-retry"]')).toBeNull();

		respond404 = false;
		// Hover a non-tooltip element first so a tooltip lingering under the
		// browser pointer closes; it would overlap the button and block the click.
		await page.getByTestId("git-diff-error").hover();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="tooltip-content"][data-open=""]')).toBeNull();
		}, WAIT);
		await page.getByTestId("git-diff-init").click();

		await vi.waitFor(() => expect(init).toHaveBeenCalledWith({ directory: ROOT }), WAIT);
		// The patch loader bypasses the query cache, so success retries explicitly.
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		}, WAIT);
	});

	it("refreshes on demand into the no-changes state", async () => {
		let fetchCount = 0;
		const fetchMock = stubFetch(() => {
			fetchCount++;
			return fetchCount === 1 ? new Response(patchResponseStream()) : new Response("");
		});
		await renderView();
		await waitForTreePath("README.md");

		// Hover a non-tooltip element first so a tooltip lingering under the
		// browser pointer closes; it would overlap the button and block the click.
		await page.getByTestId("git-diff-search").hover();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="tooltip-content"][data-open=""]')).toBeNull();
		}, WAIT);
		await page.getByTestId("git-diff-refresh").click();
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		}, WAIT);

		// A refresh that streams zero files publishes no tree, exactly like
		// a first load that found nothing: the main panel shows the empty
		// state and the sidebar falls back to its placeholder.
		await expect.element(page.getByTestId("git-diff-empty")).toBeVisible();
		await vi.waitFor(() => {
			const placeholder = document.querySelector('[data-qa-id="git-diff-tree-placeholder"]');
			expect(placeholder?.textContent ?? "").toContain("No changed files.");
			const search = document.querySelector<HTMLInputElement>('[data-qa-id="git-diff-search"]');
			expect(search?.disabled).toBe(true);
		}, WAIT);
	});

	it("refreshes in place, keeping unchanged files as the user left them", async () => {
		const secondLoad = controlledPatchStream();
		let fetchCount = 0;
		const fetchMock = stubFetch(() => {
			fetchCount++;
			return fetchCount === 1
				? new Response(patchResponseStream())
				: new Response(secondLoad.stream);
		});
		await renderView();
		await waitForTreePath("README.md");

		// The diff body awaits the highlight pipeline and the header-prefix
		// slot content publishes a tick later, so wait for both before
		// collapsing — otherwise the collapse assertions below would pass
		// trivially on a body that never rendered.
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);
		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
		}, WAIT);

		// Refresh into a stream the test controls: the refresh stalls with
		// the old diff on screen until the second patch is released.
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await vi.waitFor(() => {
			const refreshButton = document.querySelector<HTMLButtonElement>(
				'[data-qa-id="git-diff-refresh"]',
			);
			expect(refreshButton?.disabled).toBe(true);
			expect(refreshButton?.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
			// The header spinner follows the same busy flag (Decision 4).
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).not.toBeNull();
		}, WAIT);
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		}, WAIT);
		// In-place: the current diff stays mounted; no first-load placeholder.
		expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
		expect(document.querySelector('[data-qa-id="git-diff-viewer-loading"]')).toBeNull();

		// README.md byte-identical, src/new.ts changed.
		secondLoad.enqueue(SECOND_PATCH);
		secondLoad.close();
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
		}, WAIT);
		await vi.waitFor(() => {
			expect(diffContainerFor("src/new.ts")?.shadowRoot?.textContent ?? "").toContain(
				"export const value = 2;",
			);
		}, WAIT);
		// The refresh settled: the busy affordances cleared.
		await vi.waitFor(() => {
			expect(
				document.querySelector<HTMLButtonElement>('[data-qa-id="git-diff-refresh"]')?.disabled,
			).toBe(false);
		}, WAIT);
	});

	it("re-opens a collapsed file whose diff changed", async () => {
		let fetchCount = 0;
		const fetchMock = stubFetch(() => {
			fetchCount++;
			return new Response(patchResponseStream(24, fetchCount === 1 ? undefined : SECOND_PATCH));
		});
		await renderView();
		await waitForTreePath("README.md");

		await vi.waitFor(() => {
			expect(collapseButtonFor("src/new.ts")).not.toBeNull();
			expect(diffContainerFor("src/new.ts")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);
		// Collapsing bumps the live item's version to 1; the refresh must
		// still replace it (version 2) and re-open it.
		fireEvent.click(collapseButtonFor("src/new.ts")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("false");
		}, WAIT);

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		}, WAIT);
		await vi.waitFor(() => {
			expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");
		}, WAIT);
		await vi.waitFor(() => {
			expect(diffContainerFor("src/new.ts")?.shadowRoot?.textContent ?? "").toContain(
				"export const value = 2;",
			);
		}, WAIT);
	});

	it("renders singular stats for a single changed file", async () => {
		stubFetch(() => new Response(patchResponseStream(24, FIRST_FILE)));
		await renderView();
		await waitForTreePath("first.txt");
		await vi.waitFor(() => {
			const statsText = document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
			expect(statsText).toContain("1 file");
			expect(statsText).not.toContain("1 files");
		}, WAIT);
	});

	it("surfaces the generic error for a 200 body that is not a patch", async () => {
		stubFetch(() => new Response("this is not a git patch"));
		await renderView();

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("could not be loaded");
		}, WAIT);
	});

	it("surfaces a status-only failure message when the error body is empty", async () => {
		stubFetch(() => new Response("", { status: 500 }));
		await renderView();

		await expect.element(page.getByTestId("git-diff-error")).toBeVisible();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("Request failed (500).");
		}, WAIT);
		// Non-404 errors keep the Retry button exactly as-is.
		expect(document.querySelector('[data-qa-id="git-diff-retry"]')).not.toBeNull();
		expect(document.querySelector('[data-qa-id="git-diff-init"]')).toBeNull();
	});

	it("hides and restores the file tree panel from the toolbar toggle", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		}, WAIT);

		const toggle = page.getByTestId("git-diff-tree-toggle");
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-tree-toggle"]')!);
		await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("0px");
		}, WAIT);
		// Collapsing hides the panel but keeps the tree mounted so its
		// selection and scroll survive the round trip.
		expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]')).not.toBeNull();

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-tree-toggle"]')!);
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		}, WAIT);
	});

	it("persists the file tree panel toggle", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-tree-toggle"]')!);
		await vi.waitFor(() => {
			expect(localStorage.getItem("git.diffTreeCollapsed:v1")).toBe("true");
		}, WAIT);

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-tree-toggle"]')!);
		await vi.waitFor(() => {
			expect(localStorage.getItem("git.diffTreeCollapsed:v1")).toBe("false");
		}, WAIT);
	});

	it("mounts with the file tree panel hidden when it was persisted hidden", async () => {
		localStorage.setItem("git.diffTreeCollapsed:v1", "true");
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");

		await expect
			.element(page.getByTestId("git-diff-tree-toggle"))
			.toHaveAttribute("aria-pressed", "true");
		expect(filesPanel()?.style.width).toBe("0px");
	});

	it("mounts with the file tree panel shown when the persisted toggle is not a boolean", async () => {
		localStorage.setItem("git.diffTreeCollapsed:v1", '"yes"');
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");

		await expect
			.element(page.getByTestId("git-diff-tree-toggle"))
			.toHaveAttribute("aria-pressed", "false");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		}, WAIT);
	});

	it("resizes the file tree panel from the keyboard, clamped to the minimum width", async () => {
		localStorage.setItem("git.diffFilesWidth", "170");
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("170px");
		}, WAIT);

		const handle = () => document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree-resize"]');
		// The tree sits right of the divider, so ArrowRight (divider pushed
		// right) shrinks it; 170 - 12 lands below the floor and clamps to 160.
		fireEvent.keyDown(handle()!, { key: "ArrowRight" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		}, WAIT);
		// At the floor, further shrink requests stay clamped.
		fireEvent.keyDown(handle()!, { key: "ArrowRight" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		}, WAIT);

		fireEvent.keyDown(handle()!, { key: "ArrowLeft", shiftKey: true });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("200px");
		}, WAIT);
		// The resized width persists for the next session.
		expect(localStorage.getItem("git.diffFilesWidth")).toBe("200");
	});

	it("falls back to the default panel width when the stored width is corrupt", async () => {
		localStorage.setItem("git.diffFilesWidth", '"wide"');
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("224px");
		}, WAIT);
	});

	it("reopens a collapsed file tree panel from the resize handle", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-tree-toggle"]')!);
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("0px");
		}, WAIT);

		// The collapsed panel's right-edge handle is its only visible
		// affordance; growing the tree from it (ArrowLeft pulls the divider
		// away from the right edge) reopens the panel at the minimum width.
		const handle = document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree-resize"]');
		fireEvent.keyDown(handle!, { key: "ArrowLeft" });
		await vi.waitFor(() => {
			expect(filesPanel()?.style.width).toBe("160px");
		}, WAIT);
		await expect
			.element(page.getByTestId("git-diff-tree-toggle"))
			.toHaveAttribute("aria-pressed", "false");
		expect(localStorage.getItem("git.diffTreeCollapsed:v1")).toBe("false");
	});
});
