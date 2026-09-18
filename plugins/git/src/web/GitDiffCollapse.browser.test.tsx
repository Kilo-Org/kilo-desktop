import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { createFakeSdk } from "@kilo-desktop/testing";

import { gitContract } from "../contracts/schemas.js";
import {
	collapseButtonFor,
	diffContainerFor,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
} from "./test-utils.js";

afterEach(resetViewTestDom);

describe("GitDiffView collapse", () => {
	it("collapses and expands all files", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");

		const toggle = page.getByTestId("git-diff-collapse-all");
		await expect.element(toggle).toHaveAttribute("aria-label", "Collapse all files");
		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-label", "Expand all files");
	});

	it("collapses and expands an individual file from its header button", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
			expect(collapseButtonFor("src/new.ts")).not.toBeNull();
		});
		expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
		expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");

		// The diff body awaits the highlight pipeline, so wait for real code
		// to exist before collapsing — otherwise the removal assertion below
		// would pass trivially on a body that never rendered.
		await vi.waitFor(() => {
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		});

		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
			expect(collapseButtonFor("src/new.ts")?.getAttribute("aria-expanded")).toBe("true");
		});
		await vi.waitFor(() => {
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).toBeNull();
		});

		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		});
	});

	it("expands a collapsed file when its tree row is selected", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")).not.toBeNull();
		});
		fireEvent.click(collapseButtonFor("README.md")!);
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("false");
		});

		const row = treeHost()?.shadowRoot?.querySelector('[data-item-path="README.md"]');
		expect(row).not.toBeNull();
		fireEvent.click(row!);
		// The row must actually be selected first — proving the click reached
		// onSelectionChange — so the expansion wait below fails for a missing
		// expand-on-select behavior, not a dead click.
		await vi.waitFor(() => {
			expect(row?.getAttribute("aria-selected")).toBe("true");
		});
		await vi.waitFor(() => {
			expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
		});
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
		const requests: { workingDirectory: string; path: string }[] = [];
		stubFetch(() => new Response(patchResponseStream(24, gapPatch)));
		const sdk = createFakeSdk({
			featureId: "git",
			channels: gitContract,
			handlers: {
				getDiffContents: async (args: { workingDirectory: string; path: string }) => {
					requests.push(args);
					return {
						oldContents: `${oldLines.join("\n")}\n`,
						newContents: `${newLines.join("\n")}\n`,
					};
				},
			},
		});
		renderView(undefined, sdk);

		// The diff body awaits the highlight pipeline; wait for real code
		// before asserting on what is or is not rendered. StrictMode
		// double-mounts can replace the container, so re-query every poll.
		await vi.waitFor(() => {
			expect(diffContainerFor("story.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		});
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
		});

		fireEvent.click(expandButton);
		await vi.waitFor(() => {
			expect(diffContainerFor("story.md")?.shadowRoot?.textContent ?? "").toContain("line 25");
		});
		expect(requests).toContainEqual({
			workingDirectory: "/workspace/project",
			path: "story.md",
		});
	});

	it("disables the per-file button for an empty diff", async () => {
		// Mode-change-only patch: no hunks, so the diff body has no lines.
		const modeChangePatch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`;
		stubFetch(() => new Response(patchResponseStream(24, modeChangePatch)));
		renderView();

		await vi.waitFor(() => {
			expect(collapseButtonFor("script.sh")).not.toBeNull();
		});
		const button = collapseButtonFor("script.sh");
		expect(button?.disabled).toBe(true);
		expect(button?.getAttribute("aria-label")).toBe("Collapse diff");
	});

	it("shows tooltips for the toolbar controls", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		});

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
		renderView();
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
		});
	});
});
