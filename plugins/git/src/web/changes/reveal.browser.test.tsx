import { afterEach, describe, expect, it, vi } from "vitest";

import {
	FIRST_FILE,
	SECOND_FILE,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	WAIT,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

/** Strict variant of test-utils' waitForTreePath: a missing tree host must not count as a match. */
async function waitForTreeRow(relativePath: string): Promise<void> {
	await vi.waitFor(() => {
		expect(
			treeHost()?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`) ?? null,
		).not.toBeNull();
	}, WAIT);
}

function rowSelected(relativePath: string): string | null | undefined {
	return treeHost()
		?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`)
		?.getAttribute("aria-selected");
}

describe("GitDiffView reveal requests", () => {
	it("selects the file the Changes tab was opened for", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		await renderView({ metadata: { revealPath: "src/new.ts", revealRequest: "1" } });

		await vi.waitFor(() => {
			expect(rowSelected("src/new.ts")).toBe("true");
		}, WAIT);
		expect(rowSelected("README.md")).not.toBe("true");
	});

	it("moves the selection when the tab is re-opened for another file", async () => {
		stubFetch(() => new Response(patchResponseStream()));
		const { rerender } = await renderView({
			metadata: { revealPath: "src/new.ts", revealRequest: "1" },
		});
		await vi.waitFor(() => {
			expect(rowSelected("src/new.ts")).toBe("true");
		}, WAIT);

		rerender({ metadata: { revealPath: "README.md", revealRequest: "2" } });

		await vi.waitFor(() => {
			expect(rowSelected("README.md")).toBe("true");
			expect(rowSelected("src/new.ts")).not.toBe("true");
		}, WAIT);
	});

	it("shows the workspace folder the tab was opened for", async () => {
		const fetchMock = stubFetch(
			(url) =>
				new Response(
					patchResponseStream(
						24,
						url.includes(encodeURIComponent("/workspace/other")) ? SECOND_FILE : FIRST_FILE,
					),
				),
		);
		await renderView(
			{
				metadata: {
					workspaceDirectory: "/workspace/other",
					revealPath: "second.txt",
					revealRequest: "1",
				},
			},
			{
				folders: [
					{ path: "/workspace/project", isPrimary: true },
					{ path: "/workspace/other", isPrimary: false },
				],
			},
		);

		await waitForTreeRow("second.txt");
		await vi.waitFor(() => {
			expect(rowSelected("second.txt")).toBe("true");
		}, WAIT);
		expect(fetchMock).not.toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project")}`,
			expect.anything(),
		);
	});

	it("switches an open tab to the requested workspace folder", async () => {
		stubFetch(
			(url) =>
				new Response(
					patchResponseStream(
						24,
						url.includes(encodeURIComponent("/workspace/other")) ? SECOND_FILE : FIRST_FILE,
					),
				),
		);
		const workspaceFolders = [
			{ path: "/workspace/project", isPrimary: true },
			{ path: "/workspace/other", isPrimary: false },
		];
		const { rerender } = await renderView({}, { folders: workspaceFolders });
		await waitForTreeRow("first.txt");

		rerender({
			directory: "/workspace/project",
			metadata: { workspaceDirectory: "/workspace/other", revealRequest: "1" },
		});

		await waitForTreeRow("second.txt");
	});

	it("reveals a same-named file in the requested folder, not the folder being left", async () => {
		const readme = (content: string) => `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+${content}
`;
		const fetchMock = stubFetch((url) =>
			url.includes(encodeURIComponent("/workspace/other"))
				? new Response(patchResponseStream(24, SECOND_FILE + readme("other")))
				: new Response(patchResponseStream(24, FIRST_FILE + readme("project"))),
		);
		const workspaceFolders = [
			{ path: "/workspace/project", isPrimary: true },
			{ path: "/workspace/other", isPrimary: false },
		];
		const { rerender } = await renderView({}, { folders: workspaceFolders });
		await waitForTreeRow("first.txt");

		rerender({
			directory: "/workspace/project",
			metadata: {
				workspaceDirectory: "/workspace/other",
				revealPath: "README.md",
				revealRequest: "1",
			},
		});

		await waitForTreeRow("second.txt");
		await vi.waitFor(() => {
			expect(rowSelected("README.md")).toBe("true");
		}, WAIT);
		expect(fetchMock).toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/other")}`,
			expect.anything(),
		);
	});

	it("ignores a requested folder that is not one of the session's folders", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream(24, FIRST_FILE)));
		await renderView({ metadata: { workspaceDirectory: "/elsewhere", revealRequest: "1" } });

		await waitForTreeRow("first.txt");
		expect(fetchMock).toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project")}`,
			expect.anything(),
		);
	});
});
