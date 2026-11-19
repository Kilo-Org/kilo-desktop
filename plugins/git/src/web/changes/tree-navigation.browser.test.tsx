import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	diffContainerFor,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	treeHost,
	waitForTreePath,
	WAIT,
} from "../../test/git-host";

afterEach(resetViewTestDom);

const FILE_NAMES = ["a.txt", "b.txt", "c.txt", "d.txt"];

/** New files tall enough that later ones start well below the 600px viewport. */
function tallPatch(): string {
	const body = Array.from({ length: 60 }, (_, line) => `+line ${line}`).join("\n");
	return FILE_NAMES.map(
		(name) => `diff --git a/${name} b/${name}
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/${name}
@@ -0,0 +1,60 @@
${body}
`,
	).join("");
}

function scroller(): HTMLElement {
	const element = document.querySelector<HTMLElement>('[data-qa-id="git-diff-view"] > *');
	expect(element).toBeInstanceOf(HTMLElement);
	return element!;
}

function treeRow(path: string): HTMLElement {
	const row = treeHost()?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
	expect(row).toBeInstanceOf(HTMLElement);
	return row!;
}

/** Distance from the scroller's top edge to the file's diff header. */
function headerOffset(path: string): number | null {
	const header = diffContainerFor(path)?.shadowRoot?.querySelector("[data-diffs-header]");
	if (header == null) return null;
	return header.getBoundingClientRect().top - scroller().getBoundingClientRect().top;
}

async function renderTallView() {
	stubFetch(() => new Response(patchResponseStream(256, tallPatch())));
	await renderView();
	await waitForTreePath("d.txt");
	await vi.waitFor(() => {
		expect(diffContainerFor("a.txt")?.shadowRoot?.querySelector("pre")).toBeTruthy();
	}, WAIT);
}

async function expectScrolledTo(path: string) {
	await vi.waitFor(() => {
		const offset = headerOffset(path);
		expect(offset, `${path} header rendered`).not.toBeNull();
		expect(Math.abs(offset!), `${path} header offset`).toBeLessThan(4);
	}, WAIT);
}

describe("GitDiffView tree navigation", () => {
	it("scrolls back to the selected file when its row is clicked again", async () => {
		await renderTallView();
		fireEvent.click(treeRow("c.txt"));
		await expectScrolledTo("c.txt");

		scroller().scrollTop = 0;
		await vi.waitFor(() => expect(headerOffset("a.txt")).toBe(0), WAIT);

		fireEvent.click(treeRow("c.txt"));

		await expectScrolledTo("c.txt");
	});
});
