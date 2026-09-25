import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { processFile } from "@pierre/diffs";
import type * as PierreDiffs from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { RefObject } from "react";

import { usePatchLoader } from "./use-patch-loader.js";
import {
	SECOND_PATCH,
	diffContainerFor,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	stubFetch,
	waitForTreePath,
} from "./test-utils.js";

vi.mock("@pierre/diffs", async (importOriginal) => {
	const actual = await importOriginal<typeof PierreDiffs>();
	return { ...actual, processFile: vi.fn(actual.processFile) };
});

afterEach(() => {
	vi.mocked(processFile).mockClear();
	resetViewTestDom();
});

/**
 * Same-path patch entries: the second entry supersedes the first's CodeView
 * item, which renames the first item's id (`same.txt` → `same.txt?previous`)
 * once the first item has been published out of the pending map.
 */
const FIRST_ENTRY = `diff --git a/same.txt b/same.txt
index 1111111..2222222 100644
--- a/same.txt
+++ b/same.txt
@@ -1 +1 @@
-one
+two
`;

const SECOND_ENTRY = `diff --git a/same.txt b/same.txt
index 2222222..3333333 100644
--- a/same.txt
+++ b/same.txt
@@ -1 +1 @@
-two
+three
`;

function createFakeViewer(): CodeViewHandle<undefined, undefined> {
	return {
		addItems: vi.fn(),
		getItem: () => undefined,
		removeItem: () => false,
		updateItem: () => false,
		updateItemId: vi.fn(),
		scrollTo: () => {},
		setSelectedLines: () => {},
		getSelectedLines: () => null,
		clearSelectedLines: () => {},
		getEditor: () => undefined,
		getInstance: () => undefined,
	};
}

/** Test-owned ref so a "new viewer" after supersession can be simulated. */
function createViewerRef(
	viewer: CodeViewHandle<undefined, undefined>,
): RefObject<CodeViewHandle<undefined, undefined> | null> {
	return { current: viewer };
}

function PatchLoaderHarness({
	workspaceDirectory,
	viewerRef,
}: {
	workspaceDirectory: string;
	viewerRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
}) {
	const result = usePatchLoader({ collapseMode: "expanded", workspaceDirectory, viewerRef });
	return (
		<div
			data-file-count={String(result.diffStats?.fileCount ?? 0)}
			data-qa-id="patch-loader-harness"
		/>
	);
}

/** A patch body stream the test feeds and closes by hand. */
function controlledPatchStream(): {
	stream: ReadableStream<Uint8Array>;
	enqueue(text: string): void;
	close(): void;
} {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	return {
		stream,
		enqueue: (text: string) => controller?.enqueue(encoder.encode(text)),
		close: () => controller?.close(),
	};
}

async function harnessFileCount(): Promise<string> {
	await vi.waitFor(() => {
		const count = document
			.querySelector('[data-qa-id="patch-loader-harness"]')
			?.getAttribute("data-file-count");
		expect(count).not.toBeNull();
		return count;
	});
	return document
		.querySelector('[data-qa-id="patch-loader-harness"]')!
		.getAttribute("data-file-count")!;
}

async function enqueueFirstEntryThenPublish(load: {
	stream: ReadableStream<Uint8Array>;
	enqueue(text: string): void;
}): Promise<void> {
	// The loader stamps its publish clocks just before it takes the body
	// reader, so the lock marks the moment the publish interval starts.
	// Timing from enqueue instead races a slow loader start on busy runners.
	await vi.waitFor(() => {
		expect(load.stream.locked).toBe(true);
	});
	load.enqueue(FIRST_ENTRY);
	// The first entry is only handed to the loader when the second entry's
	// header arrives. Waiting past STREAM_PUBLISH_INTERVAL_MS (100ms) from the
	// loader start makes it publish then (leaving the pending map), so the
	// second entry's rename is a viewer rename, not a pending re-key.
	await new Promise((resolve) => setTimeout(resolve, 150));
	load.enqueue(SECOND_ENTRY);
}

describe("usePatchLoader parse reuse", () => {
	it("re-parses only the files whose raw patch changed on an in-place refresh", async () => {
		const fetchMock = stubFetch(() =>
			fetchMock.mock.calls.length === 1
				? new Response(patchResponseStream())
				: new Response(patchResponseStream(24, SECOND_PATCH)),
		);
		renderView();
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
		});
		expect(processFile).toHaveBeenCalledTimes(2);

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await vi.waitFor(() => {
			expect(diffContainerFor("src/new.ts")?.shadowRoot?.textContent ?? "").toContain(
				"export const value = 2;",
			);
		});
		expect(processFile).toHaveBeenCalledTimes(3);
	});
});

describe("usePatchLoader supersession", () => {
	it("applies the second entry's item-id rename to the current viewer", async () => {
		const load = controlledPatchStream();
		stubFetch(() => new Response(load.stream));
		const viewer = createFakeViewer();
		const viewerRef = createViewerRef(viewer);

		render(<PatchLoaderHarness viewerRef={viewerRef} workspaceDirectory="/workspace/project" />);
		await enqueueFirstEntryThenPublish(load);
		await vi.waitFor(async () => {
			expect(await harnessFileCount()).toBe("1");
		});

		load.close();
		// The drain loop's releaseLock only runs once every buffered file
		// (including the rename-carrying second entry) was processed.
		await vi.waitFor(() => {
			expect(load.stream.locked).toBe(false);
		});

		expect(viewer.updateItemId).toHaveBeenCalledTimes(1);
		expect(viewer.updateItemId).toHaveBeenCalledWith("same.txt", expect.any(String));
	});

	it("does not apply a superseded stream's item-id rename to the new viewer", async () => {
		const staleLoad = controlledPatchStream();
		// The superseding request's fetch never settles, pinning it in
		// "fetching" while the stale (aborted) request keeps draining.
		stubFetch((url) =>
			url.includes(encodeURIComponent("/workspace/project"))
				? new Response(staleLoad.stream)
				: new Promise<Response>(() => {}),
		);
		const staleViewer = createFakeViewer();
		const newViewer = createFakeViewer();
		const viewerRef = createViewerRef(staleViewer);

		const { rerender } = render(
			<PatchLoaderHarness viewerRef={viewerRef} workspaceDirectory="/workspace/project" />,
		);
		await enqueueFirstEntryThenPublish(staleLoad);
		await vi.waitFor(async () => {
			expect(await harnessFileCount()).toBe("1");
		});

		// Supersede mid-stream: the new workspace directory starts a new load,
		// and the viewer remount (viewerKey bump) attaches a fresh handle.
		rerender(<PatchLoaderHarness viewerRef={viewerRef} workspaceDirectory="/workspace/other" />);
		viewerRef.current = newViewer;

		// The mocked fetch ignores the AbortController, so the stale drain loop
		// still consumes the closed stream's buffered rename entry — the
		// exact window the supersession guard must cover.
		staleLoad.close();
		await vi.waitFor(() => {
			expect(staleLoad.stream.locked).toBe(false);
		});

		expect(newViewer.updateItemId).not.toHaveBeenCalled();
		expect(newViewer.addItems).not.toHaveBeenCalled();
	});
});
