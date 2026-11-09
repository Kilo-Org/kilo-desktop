import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	bootGitHost,
	ChangesPaneHost,
	patchResponseStream,
	renderView,
	resetViewTestDom,
	ROOT,
	stubFetch,
	WAIT,
	waitForTreePath,
	type ChangesHostOptions,
	type GitHost,
} from "../../test/changes-host.js";

afterEach(() => {
	vi.useRealTimers();
	// Drops the own-property getter stub so the inherited one shows again.
	Reflect.deleteProperty(document, "visibilityState");
	resetViewTestDom();
});

/**
 * `visibilityState` is an inherited getter, so an own-property stub
 * shadows it; `afterEach` deletes the stub again.
 */
function setDocumentVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
	document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * A few real rendering frames: IntersectionObserver delivers on frames,
 * not timers, and a refresh that should not happen gets its chance to.
 */
async function nextFrames(count = 5): Promise<void> {
	for (let frame = 0; frame < count; frame++) {
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
}

const DEBOUNCE_PASSED_MS = 1_100;
const COOLDOWN_MS = 5_000;

/** Waits (on real time) for `count` fetches with no load in progress. */
async function waitForSettledFetches(
	fetchMock: ReturnType<typeof stubFetch>,
	count: number,
): Promise<void> {
	await vi.waitFor(() => {
		expect(fetchMock).toHaveBeenCalledTimes(count);
		expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
	}, WAIT);
}

/**
 * Fakes only setTimeout/clearTimeout, and only before the view mounts: the
 * watcher's debounce (including useDebounce's mount-time fire) then arms on
 * the fake clock, while the load pipeline's yieldToBrowser still resolves
 * through the real requestAnimationFrame. Faking after mount would leave a
 * real debounce timer armed before faking, invisible to the fake clock, which
 * fires once more mid-test (the change counter is past 0 by then) and injects
 * a spurious refresh. The host boots on real timers first.
 */
function fakeWatcherClock(): void {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/** Boots the host, arms the fake clock, then mounts the pane for `directory`. */
async function mountWithFakeClock(
	options: ChangesHostOptions = {},
	directory: string = ROOT,
): Promise<GitHost> {
	const host = await bootGitHost(options);
	fakeWatcherClock();
	host.render(<ChangesPaneHost host={host} directory={directory} />);
	return host;
}

/** Past the 1 s mount-time debounce, whose fire is the zero-count guard. */
async function advancePastMountDebounce(): Promise<void> {
	await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
}

async function renderSettledView(fetchMock: ReturnType<typeof stubFetch>) {
	const host = await mountWithFakeClock();
	await waitForTreePath("README.md");
	await vi.waitFor(() => {
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(document.querySelector('[data-qa-id="git-diff-loading"]')).toBeNull();
	}, WAIT);
	await advancePastMountDebounce();
	return host;
}

describe("the Changes pane's auto-refresh", () => {
	// Ported from VS Code's
	// `vs/platform/agentHost/test/node/agentHostFileMonitorService.test.ts`
	// ("filters known repository metadata noise before debouncing"), plus
	// this view's wider scope (git dir first level, worktree admin dir) and
	// its own exclusion (chat worktrees under the main folder).
	it("filters known repository metadata noise before debouncing", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderSettledView(fetchMock);
		const emit = (...paths: string[]) => host.emitFileChanges(ROOT, paths);

		const settleRefresh = async (expectedCount: number) => {
			// Past the 1 s debounce; the refresh itself drains on the real
			// requestAnimationFrame, which fake timers leave alone. Then past
			// the cooldown, so the next batch refreshes on its own debounce.
			await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
			await waitForSettledFetches(fetchMock, expectedCount);
			await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
		};

		// The agent host's noise list: git object writes, lock files anywhere
		// in the git dir, background-fetch FETCH_HEAD writes, watchman
		// cookies. None may even arm the debounce.
		await emit(
			"/workspace/project/.git/objects/12/abcdef",
			"/workspace/project/.git/index.lock",
			"/workspace/project/.git/HEAD.lock",
			"/workspace/project/.git/FETCH_HEAD",
			"/main/.git/worktrees/project/index.lock",
			"/workspace/project/.watchman-cookie-123",
		);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Our scope: a chat worktree under this folder is git-excluded
		// (info/exclude), so it can never change this diff.
		await emit("/workspace/project/.kilo/worktrees/kilo-aback-aardvark/src/a.ts");
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// A working-tree edit: exactly one refresh.
		await emit("/workspace/project/src/a.ts");
		await settleRefresh(2);

		// The git dir's first level: commits and checkouts that touch no
		// working-tree file must still refresh (DotGitWatcher half).
		await emit("/workspace/project/.git/HEAD");
		await settleRefresh(3);

		// A chat worktree's admin dir; events arrive with the main repo
		// as root, matched by the worktrees/<basename> include.
		await emit("/main/.git/worktrees/project/index");
		await settleRefresh(4);
	});

	it("collapses changes during the cooldown into one follow-up", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderSettledView(fetchMock);

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 2);

		// Two more batches, each past its own debounce, both inside the 5 s
		// cooldown that started when the refresh above settled.
		await host.emitFileChanges(ROOT, ["/workspace/project/src/b.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await host.emitFileChanges(ROOT, ["/workspace/project/src/c.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
		await waitForSettledFetches(fetchMock, 3);
		await vi.advanceTimersByTimeAsync(COOLDOWN_MS + DEBOUNCE_PASSED_MS);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("runs a manual refresh during the cooldown immediately", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderSettledView(fetchMock);

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 2);

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-refresh"]')!);
		await waitForSettledFetches(fetchMock, 3);
	});

	it("waits while the pane is hidden, then catches up once", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderSettledView(fetchMock);
		// Stands in for a parked tab or a hidden pane group.
		const wrapper = document.querySelector('[data-qa-id="git-diff-root"]')!.parentElement!;
		wrapper.hidden = true;
		await nextFrames();

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await host.emitFileChanges(ROOT, ["/workspace/project/src/b.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await nextFrames();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		wrapper.hidden = false;
		await waitForSettledFetches(fetchMock, 2);
		await vi.advanceTimersByTimeAsync(COOLDOWN_MS + DEBOUNCE_PASSED_MS);
		await nextFrames();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("waits while the window is hidden", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderSettledView(fetchMock);
		setDocumentVisibility("hidden");

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await nextFrames();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		setDocumentVisibility("visible");
		await waitForSettledFetches(fetchMock, 2);
	});

	it("keeps the last diff when a refresh fails, and recovers on the next change", async () => {
		const fetchMock = stubFetch(() =>
			fetchMock.mock.calls.length === 2
				? new Response("The diff could not be generated.", { status: 500 })
				: new Response(patchResponseStream()),
		);
		const host = await renderSettledView(fetchMock);

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 2);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-refresh-error"]')).not.toBeNull();
		}, WAIT);
		expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
		expect(document.querySelector('[data-qa-id="git-diff-error"]')).toBeNull();
		await waitForTreePath("README.md");

		await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 3);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-refresh-error"]')).toBeNull();
		}, WAIT);
		expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
	});

	it("switches to the not-a-repo panel when a refresh 404s, and recovers after git init", async () => {
		const fetchMock = stubFetch(() =>
			fetchMock.mock.calls.length === 2
				? new Response("Not a git repository.", { status: 404 })
				: new Response(patchResponseStream()),
		);
		const host = await renderSettledView(fetchMock);

		await host.emitFileChanges(ROOT, ["/workspace/project/.git/HEAD"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 2);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-init"]')).not.toBeNull();
		}, WAIT);
		expect(document.querySelector('[data-qa-id="git-diff-refresh-error"]')).toBeNull();

		// `git init` in a terminal writes the new repository's HEAD.
		await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
		await host.emitFileChanges(ROOT, ["/workspace/project/.git/HEAD"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 3);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
		}, WAIT);
		await waitForTreePath("README.md");
	});

	it("retries a failed first load on the next change", async () => {
		const fetchMock = stubFetch(() =>
			fetchMock.mock.calls.length === 1
				? new Response("The diff could not be generated.", { status: 500 })
				: new Response(patchResponseStream()),
		);
		const host = await mountWithFakeClock();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-retry"]')).not.toBeNull();
		}, WAIT);
		await advancePastMountDebounce();

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 2);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-error"]')).toBeNull();
			expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
		}, WAIT);
	});

	it("pauses on a too-large diff until Reload", async () => {
		const tooLarge =
			"The working directory diff is too large to display (12.0 MiB; the limit is 10.0 MiB).";
		const fetchMock = stubFetch(() =>
			fetchMock.mock.calls.length === 1
				? new Response(tooLarge, {
						status: 413,
						headers: { "X-Patch-Byte-Length": String(12 * 1024 * 1024) },
					})
				: new Response(patchResponseStream()),
		);
		const host = await mountWithFakeClock();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("The diff is too large to show by default (12.0 MiB)");
			expect(document.querySelector('[data-qa-id="git-diff-show-anyway"]')?.textContent).toBe(
				"Show anyway",
			);
			expect(document.querySelector('[data-qa-id="git-diff-retry"]')?.textContent).toBe("Reload");
			expect(
				document.querySelector('[data-qa-id="git-diff-tree-placeholder"]')?.textContent ?? "",
			).toContain("Diff too large.");
		}, WAIT);
		await advancePastMountDebounce();

		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await nextFrames();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-retry"]')!);
		await waitForSettledFetches(fetchMock, 2);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();
		}, WAIT);
	});

	it("offers Show anyway only for a too-large diff", async () => {
		stubFetch(() => new Response("The diff could not be generated.", { status: 500 }));
		await renderView();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-retry"]')?.textContent).toBe(
				"Try again",
			);
		}, WAIT);
		expect(document.querySelector('[data-qa-id="git-diff-show-anyway"]')).toBeNull();
	});

	it("omits the size when a too-large response does not report it", async () => {
		stubFetch(() => new Response("too large", { status: 413 }));
		await renderView();
		await vi.waitFor(() => {
			const errorText = document.querySelector('[data-qa-id="git-diff-error"]')?.textContent ?? "";
			expect(errorText).toContain("The diff is too large to show by default");
			expect(errorText).not.toContain("(");
		}, WAIT);
	});

	it("shows a too-large diff anyway, and live reload keeps it uncapped", async () => {
		const patchUrl = `kilo-git://diff/patch?cwd=${encodeURIComponent(ROOT)}`;
		const fetchMock = stubFetch((url) =>
			url.endsWith("&unlimited=1")
				? new Response(patchResponseStream())
				: new Response("The working directory diff is too large to display.", { status: 413 }),
		);
		const host = await mountWithFakeClock();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-retry"]')).not.toBeNull();
			expect(document.querySelector('[data-qa-id="git-diff-show-anyway"]')).not.toBeNull();
		}, WAIT);
		await advancePastMountDebounce();

		fireEvent.click(document.querySelector('[data-qa-id="git-diff-show-anyway"]')!);
		await waitForSettledFetches(fetchMock, 2);
		expect(fetchMock).toHaveBeenLastCalledWith(`${patchUrl}&unlimited=1`, expect.anything());
		await waitForTreePath("README.md");
		expect(document.querySelector('[data-qa-id="git-diff-view"]')).not.toBeNull();

		await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
		await host.emitFileChanges(ROOT, ["/workspace/project/src/a.ts"]);
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await waitForSettledFetches(fetchMock, 3);
		expect(fetchMock).toHaveBeenLastCalledWith(`${patchUrl}&unlimited=1`, expect.anything());
	});

	it("drops the Show anyway override on a workspace folder switch", async () => {
		const projectUrl = `kilo-git://diff/patch?cwd=${encodeURIComponent(ROOT)}`;
		const otherUrl = `kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/other")}`;
		const fetchMock = stubFetch((url) =>
			url === projectUrl
				? new Response("The working directory diff is too large to display.", { status: 413 })
				: new Response(patchResponseStream()),
		);
		await renderView(
			{},
			{
				folders: [
					{ path: ROOT, isPrimary: true },
					{ path: "/workspace/other", isPrimary: false },
				],
			},
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-qa-id="git-diff-show-anyway"]')).not.toBeNull();
		}, WAIT);
		fireEvent.click(document.querySelector('[data-qa-id="git-diff-show-anyway"]')!);
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "other" }).click();
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenLastCalledWith(otherUrl, expect.anything());
		}, WAIT);
		await waitForTreePath("README.md");

		await page.getByTestId("git-diff-folder-select").click();
		await page.getByRole("option", { name: "project" }).click();
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenLastCalledWith(projectUrl, expect.anything());
			expect(document.querySelector('[data-qa-id="git-diff-show-anyway"]')).not.toBeNull();
		}, WAIT);
	});

	/** Mounts with a resolved `repositoryType`, with the fake clock armed before render. */
	async function renderResolvedScopeView(
		fetchMock: ReturnType<typeof stubFetch>,
		workspaceDirectory: string,
		gitDir: string,
		topLevelWorkingDirectory: string,
	) {
		const host = await mountWithFakeClock(
			{
				repository: {
					repositoryType: () => ({ kind: "regular", topLevelWorkingDirectory, gitDir }),
				},
			},
			workspaceDirectory,
		);
		await waitForTreePath("README.md");
		await waitForSettledFetches(fetchMock, 1);
		await nextFrames();
		await advancePastMountDebounce();
		return host;
	}

	async function expectRefreshCount(
		fetchMock: ReturnType<typeof stubFetch>,
		expectedCount: number,
	): Promise<void> {
		await vi.advanceTimersByTimeAsync(DEBOUNCE_PASSED_MS);
		await nextFrames();
		await waitForSettledFetches(fetchMock, expectedCount);
		await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
	}

	it("widens a subfolder view to the whole repository", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await renderResolvedScopeView(
			fetchMock,
			"/workspace/project/pkg",
			"/workspace/project/.git",
			ROOT,
		);
		const emit = (...paths: string[]) => host.emitFileChanges(ROOT, paths);

		// A terminal stage at the repo root, above the view's directory.
		await emit("/workspace/project/.git/index");
		await expectRefreshCount(fetchMock, 2);

		// The patch is tree-wide, so a sibling of the view's directory counts.
		await emit("/workspace/project/other/a.ts");
		await expectRefreshCount(fetchMock, 3);

		// Chat worktrees stay excluded, anchored to the repo root.
		await emit("/workspace/project/.kilo/worktrees/x/src/a.ts");
		await expectRefreshCount(fetchMock, 3);
	});

	it("matches a worktree's real admin dir name, not its folder name", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const worktree = "/workspace/project/.kilo/worktrees/kilo-aback-aardvark";
		const host = await renderResolvedScopeView(
			fetchMock,
			worktree,
			"/workspace/project/.git/worktrees/kilo-aback-aardvark1",
			worktree,
		);
		const emit = (...paths: string[]) => host.emitFileChanges(ROOT, paths);

		await emit("/workspace/project/.git/worktrees/kilo-aback-aardvark1/index");
		await expectRefreshCount(fetchMock, 2);

		// The folder-name guess would match this other worktree's admin dir.
		await emit("/workspace/project/.git/worktrees/kilo-aback-aardvark/index");
		await expectRefreshCount(fetchMock, 2);
	});

	it("refreshes a chat worktree's view on its own edits", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await bootGitHost();
		host.render(
			<ChangesPaneHost
				host={host}
				directory="/workspace/project/.kilo/worktrees/kilo-aback-aardvark"
			/>,
		);
		await waitForTreePath("README.md");
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}, WAIT);

		// The view's own files sit under `.kilo/worktrees/`, and events
		// arrive with the main repo as root, as in production; the exclude
		// is anchored to the view's directory, so these must still refresh.
		await host.emitFileChanges(ROOT, [
			"/workspace/project/.kilo/worktrees/kilo-aback-aardvark/src/a.ts",
		]);

		await vi.waitFor(
			() => {
				expect(fetchMock).toHaveBeenCalledTimes(2);
			},
			{ timeout: 3_000 },
		);
	});
});
