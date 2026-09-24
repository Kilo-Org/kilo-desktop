import { act, cleanup, render } from "@testing-library/react";
import { expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WORKSPACE_FILE_CHANGE_EVENT } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";
import { createFakeFeatureSystem, createFakeSdk, type FakeSdk } from "@kilo-desktop/testing";

import { gitContract, type GitRepositoryType } from "../contracts/schemas.js";
import { GitDiffView, type GitDiffViewProps } from "./GitDiffView.js";

// The view consumes the ambient pierre worker pool (kilo-ui's
// PierreDiffProvider), which these tests do not mount — and workers do not
// spawn inside the vitest browser iframe anyway. CodeView's WorkerPoolContext
// defaults to undefined and falls back to main-thread highlighting — the same
// path production takes when worker init fails.

export const PROPS: GitDiffViewProps = {
	sessionId: "session-1",
	instanceId: "changes-1",
	title: "Changes 1",
	workspaceDirectory: "/workspace/project",
};

export const PATCH = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+hello world
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const value = 1;
`;

/**
 * Same file set as `PATCH`: README.md byte-identical (same raw patch key),
 * src/new.ts with changed content (different raw patch key).
 */
export const SECOND_PATCH = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+hello world
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const value = 2;
`;

export const FIRST_FILE = `diff --git a/first.txt b/first.txt
index 1111111..2222222 100644
--- a/first.txt
+++ b/first.txt
@@ -1 +1 @@
-old
+new
`;

export const SECOND_FILE = `diff --git a/second.txt b/second.txt
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/second.txt
@@ -0,0 +1 @@
+added
`;

export function patchResponseStream(
	chunkSize = 24,
	text: string = PATCH,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			// Chunked deliberately so the incremental `diff --git ` boundary
			// parser is exercised, not just the whole-body path.
			for (let offset = 0; offset < bytes.length; offset += chunkSize) {
				controller.enqueue(bytes.slice(offset, offset + chunkSize));
			}
			controller.close();
		},
	});
}

/** One whole file per chunk, with a gap so each publish lands in its own React commit. */
export function delayedFileResponseStream(
	fileTexts: readonly string[],
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const fileText of fileTexts) {
				controller.enqueue(encoder.encode(fileText));
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			controller.close();
		},
	});
}

/** A patch body stream the test feeds and closes by hand (stalls until then). */
export function controlledPatchStream(): {
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
		enqueue: (text) => controller?.enqueue(encoder.encode(text)),
		close: () => controller?.close(),
	};
}

export function stubFetch(
	respond: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn((input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		// Promise.resolve flattens, so a never-settling promise stalls the
		// loader while sync responses pass straight through.
		return Promise.resolve(respond(url));
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

/** A git sdk whose `repositoryType` probe resolves to `repositoryType`. */
export function createRepositoryTypeSdk(repositoryType: GitRepositoryType): FakeSdk {
	return createFakeSdk({
		featureId: "git",
		channels: gitContract,
		handlers: { repositoryType: async () => repositoryType },
	});
}

export function renderView(props: Partial<GitDiffViewProps> = {}, customSdk?: FakeSdk) {
	const sdk = customSdk ?? createFakeSdk({ featureId: "git" });
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	// TooltipProvider: the view itself relies on the shell's app-level
	// provider (AppSidebarLayout), which the test harness does not mount.
	// QueryClientProvider: the init mutation needs the host's TanStack
	// context (the shell provides it app-wide in production).
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const renderTree = (partial: Partial<GitDiffViewProps>) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<div className="flex" style={{ height: 600, width: 900 }}>
						<GitDiffView {...PROPS} {...partial} />
					</div>
				</TooltipProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
	const { rerender } = render(renderTree(props));
	return {
		rerender: (partial: Partial<GitDiffViewProps>) => rerender(renderTree(partial)),
	};
}

export function treeHost(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree"]');
}

/** The sidebar's resizable panel wrapper; its inline width is the panel size. */
export function filesPanel(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-qa-id="git-diff-files-panel"]');
}

export async function waitForTreePath(relativePath: string): Promise<void> {
	await vi.waitFor(() => {
		expect(
			treeHost()?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`),
		).not.toBeNull();
	});
}

export function diffContainerFor(relativePath: string): Element | null {
	return (
		Array.from(document.querySelectorAll("diffs-container")).find((host) =>
			(host.shadowRoot?.querySelector("[data-diffs-header]")?.textContent ?? "").includes(
				relativePath,
			),
		) ?? null
	);
}

// The collapse button is slotted header-prefix content, so it lives in the
// container host's light DOM — not in its shadow root. Returns null (never
// undefined) so `.not.toBeNull()` assertions actually fail when it is missing.
export function collapseButtonFor(relativePath: string): HTMLButtonElement | null {
	return (
		diffContainerFor(relativePath)?.querySelector<HTMLButtonElement>(
			'[data-qa-id="git-diff-file-collapse"]',
		) ?? null
	);
}

/**
 * Emits one workspace watcher batch. `act` flushes the watcher's counter
 * bump so a debounce timer arms inside the same step — under fake timers
 * the re-render would otherwise wait on a real macrotask that
 * `advanceTimersByTimeAsync` never yields to.
 */
export function emitWorkspaceChanges(
	sdk: FakeSdk,
	root: string,
	paths: readonly string[],
): Promise<void> {
	return act(async () => {
		sdk.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root,
			changes: paths.map((path) => ({ path, type: "update" as const })),
		});
	});
}

/** Shared afterEach: unmount, drop the fetch stub, and reset storage. */
export function resetViewTestDom(): void {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.clear();
}
