import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	collapseButtonFor,
	diffContainerFor,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
	WAIT,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

describe("GitDiffView collapse", () => {
	it("collapses and expands all files", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		// Let the cold highlight pipeline finish first: a real (CDP) click
		// dispatched while it holds the main thread can time out under
		// parallel test load.
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, 10_000);

		const toggle = page.getByTestId("git-diff-collapse-all");
		await expect.element(toggle).toHaveAttribute("aria-label", "Collapse all files");
		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-label", "Expand all files");
	});

	it("collapses and expands an individual file from its header button", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
			expect(collapseButtonFor("src/new.ts")).not.toBeNull();
		}, WAIT);
		expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
		expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");

		// The diff body awaits the highlight pipeline, so wait for real code
		// to exist before collapsing — otherwise the removal assertion below
		// would pass trivially on a body that never rendered.
		await vi.waitFor(() => {
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);

		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
			expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");
		}, WAIT);
		await vi.waitFor(() => {
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).toBeNull();
		}, WAIT);

		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);
	});

	it("collapses and expands a file when its header is clicked", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();

		const title = () =>
			diffContainerFor("README.md")?.shadowRoot?.querySelector<HTMLElement>(
				"[data-diffs-header] [data-title]",
			) ?? null;
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
			expect(title()).not.toBeNull();
		}, WAIT);

		fireEvent.click(title()!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
			expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");
		}, WAIT);

		fireEvent.click(title()!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
		}, WAIT);
	});

	it("expands a collapsed file when its tree row is selected", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
		}, WAIT);
		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
		}, WAIT);

		const row = treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]');
		expect(row).not.toBeNull();
		fireEvent.click(row!);
		// The row must actually be selected first — proving the click reached
		// onSelectionChange — so the expansion wait below fails for a missing
		// expand-on-select behavior, not a dead click.
		await vi.waitFor(() => {
			expect(row?.getAttribute("aria-selected")).toBe("true");
		}, WAIT);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
		}, WAIT);
	});

	it("expands a collapsed hunk gap and reveals the hidden context lines", async () => {
		// Two hunks 46 lines apart: the gap is collapsed, and expanding it
		// requires the full file contents via the getDiffContents channel.
		const gapPatch = `diff --git a/story.md b/story.md
index 1111111..2222222 100644
--- a/story.md
+++ b/story.md
@@ -1,3 +1,3 @@
 line 1
-line 2
+LINE 2
 line 3
@@ -50,3 +50,3 @@
 line 50
-line 51
+LINE 51
 line 52
`;
		const oldLines = Array.from({ length: 52 }, (_, index) => `line ${index + 1}`);
		const newLines = oldLines.map((line) =>
			line === "line 2" || line === "line 51" ? line.toUpperCase() : line,
		);
		const requests: { directory: string; path: string }[] = [];
		const fetchMock = stubFetch(() => new Response(patchResponseStream(24, gapPatch)));
		await renderView(
			{},
			{
				repository: {
					getDiffContents: (args: { directory: string; path: string }) => {
						requests.push(args);
						return {
							oldContents: `${oldLines.join("\n")}\n`,
							newContents: `${newLines.join("\n")}\n`,
						};
					},
				},
			},
		);

		// The diff body awaits the highlight pipeline; wait for real code
		// before asserting on what is or is not rendered. StrictMode
		// double-mounts can replace the container, so re-query every poll.
		await vi.waitFor(() => {
			expect(diffContainerFor("story.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);
		expect(diffContainerFor("story.md")?.shadowRoot?.textContent ?? "").not.toContain("line 25");

		// Pierre only mounts expand buttons when a loadDiffFiles loader is
		// wired into the view options.
		const expandButton = await vi.waitFor(() => {
			const button =
				diffContainerFor("story.md")?.shadowRoot?.querySelector<HTMLButtonElement>(
					"[data-expand-button]",
				) ?? null;
			expect(button).not.toBeNull();
			return button!;
		}, WAIT);

		fireEvent.click(expandButton);
		await vi.waitFor(() => {
			expect(diffContainerFor("story.md")?.shadowRoot?.textContent ?? "").toContain("line 25");
		}, WAIT);
		expect(requests).toContainEqual({
			directory: "/workspace/project",
			path: "story.md",
		});

		// Refresh with a byte-identical patch: the stored raw patch key
		// matches, so the live (hydrated) item is reused and the revealed
		// context lines survive the commit. The live item's own cacheKey
		// was rewritten in place to `…:hydrated` by the expansion, so this
		// pins change detection comparing stored raw keys, not live ones.
		const statsText = () =>
			document.querySelector('[data-qa-id="git-diff-stats"]')?.textContent ?? "";
		const statsBefore = statsText();
		expect(statsBefore).toContain("+2");
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(diffContainerFor("story.md")?.shadowRoot?.textContent ?? "").toContain("line 25");
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		}, WAIT);
		// The refresh reuses the live, hydrated parse; its hunk counts must
		// still add up to the same stats.
		expect(statsText()).toBe(statsBefore);
	});

	it("disables the per-file button for an empty diff", async () => {
		// Mode-change-only patch: no hunks, so the diff body has no lines.
		const modeChangePatch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`;
		stubFetch(() => new Response(patchResponseStream(24, modeChangePatch)));
		await renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("script.sh")).not.toBeNull();
		}, WAIT);
		const button = collapseButtonFor("script.sh");
		expect(button?.disabled).toBe(true);
		expect(button?.getAttribute("aria-label")).toBe("Collapse diff");
	});

	it("shows tooltips for the toolbar controls", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		}, WAIT);

		for (const [testId, label] of [
			["git-diff-collapse-all", "Collapse all files"],
			["git-diff-refresh", "Refresh changes"],
		] as const) {
			await page.getByTestId(testId).hover();
			await expect
				.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
				.toBe(label);
		}
	});

	it("renders the toolbar buttons in order", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForTreePath("README.md");

		const orderedIds = ["git-diff-collapse-all", "git-diff-settings", "git-diff-tree-toggle"];
		const buttons = orderedIds.map((id) => document.querySelector(`[data-qa-id="${id}"]`));
		for (const button of buttons) {
			expect(button).not.toBeNull();
		}
		for (let index = 0; index < buttons.length - 1; index++) {
			expect(
				buttons[index]!.compareDocumentPosition(buttons[index + 1]!) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}

		// Inside the sidebar toolbar, the search input sits left of refresh.
		// StrictMode double-mounts tear the sidebar down mid-test, so poll
		// for the settled DOM instead of asserting a single snapshot.
		await vi.waitFor(() => {
			const sidebar = document.querySelector('[data-qa-id="git-diff-sidebar"]');
			const search = sidebar?.querySelector('[data-qa-id="git-diff-search"]') ?? null;
			const refresh = sidebar?.querySelector('[data-qa-id="git-diff-refresh"]') ?? null;
			expect(search).not.toBeNull();
			expect(refresh).not.toBeNull();
			expect(
				search!.compareDocumentPosition(refresh!) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}, WAIT);
	});
});
