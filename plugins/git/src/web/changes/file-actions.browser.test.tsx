import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";

import {
	type GitHostOptions,
	collapseButtonFor,
	DELETED_AND_RENAMED_PATCH,
	diffContainerFor,
	headerActionFor,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	WAIT,
	WORK_SESSION_ID,
} from "../../test/git-host";

const COPY = "git-diff-file-copy-path";
const OPEN = "git-diff-file-open";

afterEach(resetViewTestDom);

/** A regular repository whose top level is `topLevelWorkingDirectory`. */
function regularRepository(topLevelWorkingDirectory = "/workspace/project"): GitHostOptions {
	return {
		repository: {
			repositoryType: () => ({
				kind: "regular",
				topLevelWorkingDirectory,
				gitDir: `${topLevelWorkingDirectory}/.git`,
			}),
		},
	};
}

async function waitForAction(relativePath: string, qaId: string): Promise<HTMLButtonElement> {
	return vi.waitFor(() => {
		const button = headerActionFor(relativePath, qaId);
		expect(button).not.toBeNull();
		return button!;
	}, WAIT);
}

describe("Changes pane file header actions", () => {
	it("copies the file's path as the header shows it", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const host = await renderView();

		fireEvent.click(await waitForAction("src/new.ts", COPY));

		await vi.waitFor(() => expect(host.copied).toEqual(["src/new.ts"]), WAIT);
		await vi.waitFor(
			() => expect(headerActionFor("src/new.ts", COPY)?.getAttribute("aria-label")).toBe("Copied"),
			WAIT,
		);
	});

	it("leaves the file expanded when an action is clicked", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		const copy = await waitForAction("README.md", COPY);
		await vi.waitFor(() => {
			expect(diffContainerFor("README.md")?.shadowRoot?.querySelector("pre")).not.toBeNull();
		}, WAIT);

		// The composed path starts at the icon, the strictest case for the
		// header's click-to-collapse listener.
		fireEvent.click(copy.querySelector("svg")!);

		// "Copied" lands after a round trip to main, so a collapse the clicks
		// had triggered would have committed by then.
		await vi.waitFor(
			() => expect(headerActionFor("README.md", COPY)?.getAttribute("aria-label")).toBe("Copied"),
			WAIT,
		);
		expect(collapseButtonFor("README.md")?.getAttribute("aria-expanded")).toBe("true");
	});

	it("hides the actions until the header is hovered or an action is focused", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		const copy = await waitForAction("README.md", COPY);
		const opacity = () => getComputedStyle(copy.closest("[slot]")!).opacity;
		expect(opacity()).toBe("0");

		const title = diffContainerFor("README.md")!.shadowRoot!.querySelector<HTMLElement>(
			"[data-diffs-header] [data-title]",
		)!;
		await page.elementLocator(title).hover();
		await vi.waitFor(() => expect(opacity()).toBe("1"), WAIT);

		await page.elementLocator(document.body).hover({ position: { x: 1, y: 1 } });
		await vi.waitFor(() => expect(opacity()).toBe("0"), WAIT);

		copy.focus();
		await vi.waitFor(() => expect(opacity()).toBe("1"), WAIT);
	});

	it("keeps a header with actions at the height the virtualizer assumes", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView();
		await waitForAction("README.md", COPY);

		const header = diffContainerFor("README.md")?.shadowRoot?.querySelector("[data-diffs-header]");
		expect(header?.getBoundingClientRect().height).toBe(40);
	});

	it("opens the working-tree file in the session through its file opener", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const host = await renderView({}, { ...regularRepository(), fileOpener: true });

		fireEvent.click(await waitForAction("src/new.ts", OPEN));

		await vi.waitFor(
			() =>
				expect(host.openedObjects).toEqual([
					{
						workSessionId: WORK_SESSION_ID,
						ref: { type: "kilo.work-sessions/file", id: "/workspace/project/src/new.ts" },
					},
				]),
			WAIT,
		);
	});

	it("copies a renamed file's new path, and offers no Open for a deleted file", async () => {
		stubFetch(() => new Response(patchResponseStream(24, DELETED_AND_RENAMED_PATCH)));
		const host = await renderView({}, { ...regularRepository(), fileOpener: true });

		await waitForAction("src/after.ts", OPEN);
		fireEvent.click(await waitForAction("src/after.ts", COPY));
		await vi.waitFor(() => expect(host.copied).toEqual(["src/after.ts"]), WAIT);

		expect(headerActionFor("old.txt", COPY)).not.toBeNull();
		expect(headerActionFor("old.txt", OPEN)).toBeNull();
	});

	it("offers no Open when no plugin opens workspace files", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const host = await renderView({}, regularRepository());

		// The copy round trip to main settles after the repository type read,
		// so Open would have shown by now if anything enabled it.
		await vi.waitFor(() => expect(host.calls("repositoryType")).not.toEqual([]), WAIT);
		fireEvent.click(await waitForAction("src/new.ts", COPY));
		await vi.waitFor(() => expect(host.copied).toEqual(["src/new.ts"]), WAIT);

		expect(headerActionFor("src/new.ts", OPEN)).toBeNull();
	});

	it("opens only files inside the session's folders when the repository is wider", async () => {
		const widePatch = `diff --git a/project/src/a.ts b/project/src/a.ts
index 1111111..2222222 100644
--- a/project/src/a.ts
+++ b/project/src/a.ts
@@ -1 +1 @@
-a
+A
diff --git a/other/b.ts b/other/b.ts
index 1111111..2222222 100644
--- a/other/b.ts
+++ b/other/b.ts
@@ -1 +1 @@
-b
+B
`;
		stubFetch(() => new Response(patchResponseStream(24, widePatch)));
		const host = await renderView({}, { ...regularRepository("/workspace"), fileOpener: true });

		fireEvent.click(await waitForAction("project/src/a.ts", OPEN));

		await vi.waitFor(
			() =>
				expect(host.openedObjects).toEqual([
					{
						workSessionId: WORK_SESSION_ID,
						ref: { type: "kilo.work-sessions/file", id: "/workspace/project/src/a.ts" },
					},
				]),
			WAIT,
		);
		expect(headerActionFor("other/b.ts", COPY)).not.toBeNull();
		expect(headerActionFor("other/b.ts", OPEN)).toBeNull();
	});

	it("tells the person when the file can't be opened", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView(
			{},
			{
				...regularRepository(),
				fileOpener: true,
				openObject: () => {
					throw new KernelError("NOT_FOUND", "The file is gone.");
				},
			},
		);

		fireEvent.click(await waitForAction("src/new.ts", OPEN));

		await expect.element(page.getByText("Couldn't open the file")).toBeVisible();
		await expect.element(page.getByText("The file is gone.")).toBeVisible();
	});

	it("tells the person when no pane opens the file", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView({}, { ...regularRepository(), fileOpener: true, openObject: () => null });

		fireEvent.click(await waitForAction("src/new.ts", OPEN));

		await expect.element(page.getByText("Couldn't open the file")).toBeVisible();
		await expect.element(page.getByText("No pane here opens this kind of file.")).toBeVisible();
	});
});
