import { cleanup, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { TooltipProvider } from "@anaconda-agentic-desktop/ui/components/tooltip";
import {
	createFakeFeatureSystem,
	createFakeSdk,
	type FakeSdk,
} from "@anaconda-agentic-desktop/testing";

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

export function renderView(props: Partial<GitDiffViewProps> = {}, customSdk?: FakeSdk) {
	const sdk = customSdk ?? createFakeSdk({ featureId: "git" });
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	// TooltipProvider: the view itself relies on the shell's app-level
	// provider (AppSidebarLayout), which the test harness does not mount.
	const renderTree = (partial: Partial<GitDiffViewProps>) => (
		<SdkProvider system={system}>
			<TooltipProvider>
				<div className="flex" style={{ height: 600, width: 900 }}>
					<GitDiffView {...PROPS} {...partial} />
				</div>
			</TooltipProvider>
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

/** Shared afterEach: unmount, drop the fetch stub, and reset storage. */
export function resetViewTestDom(): void {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.clear();
}
