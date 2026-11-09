import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CodeViewItem } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { RefObject } from "react";

import { usePatchLoader } from "./use-patch-loader.js";
import {
	SECOND_PATCH,
	WAIT,
	patchResponseStream,
	resetViewTestDom,
	stubFetch,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

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

function createFakeViewer(
	getItem: (id: string) => CodeViewItem<undefined> | undefined = () => undefined,
): CodeViewHandle<undefined, undefined> {
	return {
		addItems: vi.fn(),
		getItem,
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
	onItems,
}: {
	workspaceDirectory: string;
	viewerRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
	onItems?: (items: readonly CodeViewItem<undefined>[]) => void;
}) {
	const result = usePatchLoader({
		collapseMode: "expanded",
		workspaceDirectory,
		unlimited: false,
		viewerRef,
	});
	onItems?.(result.initialItems);
	return (
		<div
			data-file-count={String(result.diffStats?.fileCount ?? 0)}
			data-load-state={result.loadState}
			data-qa-id="patch-loader-harness"
		>
			<button type="button" data-qa-id="patch-loader-refresh" onClick={result.refresh}>
				Refresh
			</button>
		</div>
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
	}, WAIT);
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
	}, WAIT);
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
		const live = new Map<string, CodeViewItem<undefined>>();
		const keep = (items: readonly CodeViewItem<undefined>[]) => {
			for (const item of items) live.set(item.id, item);
		};
		const viewer = createFakeViewer((id) => live.get(id));
		vi.mocked(viewer.addItems).mockImplementation(keep);
		const viewerRef = createViewerRef(viewer);
		const diffOf = (name: string) => {
			const item = live.get(name);
			return item?.type === "diff" ? item.fileDiff : undefined;
		};
		const loadState = () =>
			document
				.querySelector('[data-qa-id="patch-loader-harness"]')
				?.getAttribute("data-load-state");
		render(
			<PatchLoaderHarness
				viewerRef={viewerRef}
				workspaceDirectory="/workspace/project"
				onItems={keep}
			/>,
		);
		await vi.waitFor(() => {
			expect(loadState()).toBe("ready");
			expect(diffOf("README.md")).toBeDefined();
			expect(diffOf("src/new.ts")).toBeDefined();
		}, WAIT);
		const firstReadme = diffOf("README.md");
		const firstNew = diffOf("src/new.ts");

		fireEvent.click(document.querySelector('[data-qa-id="patch-loader-refresh"]')!);

		await vi.waitFor(() => expect(diffOf("src/new.ts")).not.toBe(firstNew), WAIT);
		expect(diffOf("README.md")).toBe(firstReadme);
		cleanup();
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
		}, WAIT);

		load.close();
		// The drain loop's releaseLock only runs once every buffered file
		// (including the rename-carrying second entry) was processed.
		await vi.waitFor(() => {
			expect(load.stream.locked).toBe(false);
		}, WAIT);

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
		}, WAIT);

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
		}, WAIT);

		expect(newViewer.updateItemId).not.toHaveBeenCalled();
		expect(newViewer.addItems).not.toHaveBeenCalled();
	});
});
