import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import {
	GIT_PULL_REQUEST_STATUS_STORE_KEY,
	type GitPullRequestStatusStoreValue,
} from "../contracts/schemas.js";
// Imported statically: re-importing the whole web entry after resetModules
// is slow enough to time out under parallel load.
import { webRegister } from "./index.js";

const storage = new Map<string, string>();

beforeEach(() => {
	storage.clear();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
	});
	vi.resetModules();
});

function snapshot(
	pullRequest: { number: number; state?: "open" | "closed" | "merged"; isDraft?: boolean } | null,
) {
	return {
		identity: null,
		branch: "feature",
		repository: "acme/repo",
		parentRepository: null,
		githubStatus: "ready" as const,
		pullRequest: pullRequest && {
			number: pullRequest.number,
			url: `https://github.com/acme/repo/pull/${pullRequest.number}`,
			title: "Feature",
			baseBranch: "main",
			headBranch: "feature",
			state: pullRequest.state ?? ("open" as const),
			isDraft: pullRequest.isDraft ?? false,
		},
	};
}

async function load() {
	const prStore = await import("./git-pr-status-store.js");
	const statusStore = await import("./pull-request-status-store.js");
	return { ...prStore, ...statusStore };
}

function peek(sdk: ReturnType<typeof createFakeSdk>) {
	return sdk.state.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY).peek();
}

describe("projectPullRequestStatus", () => {
	it("keeps only targets with a pull request, reduced to the summary", async () => {
		const { projectPullRequestStatus } = await load();

		expect(
			projectPullRequestStatus({
				"ws:local": { snapshot: snapshot({ number: 7, state: "merged" }), updatedAt: 1 },
				"ws:worktree:none": { snapshot: snapshot(null), updatedAt: 1 },
			}),
		).toEqual({ "ws:local": { state: "merged" } });
	});
});

describe("pull request status store", () => {
	it("registers under git's contracts key, seeded from cached snapshots", async () => {
		const { useGitPrStatusStore, registerPullRequestStatusStore } = await load();
		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 3 }));
		const sdk = createFakeSdk({ featureId: "git" });

		registerPullRequestStatusStore(sdk);

		expect(peek(sdk)).toEqual({ "ws:local": { state: "open" } });
	});

	it("is registered by webRegister", () => {
		const sdk = createFakeSdk({ featureId: "git" });

		webRegister(sdk);

		expect(sdk.state.has(GIT_PULL_REQUEST_STATUS_STORE_KEY)).toBe(true);
		expect(peek(sdk)).not.toBeNull();
	});

	it("publishes new snapshots while synced and stops after unsubscribe", async () => {
		const { useGitPrStatusStore, registerPullRequestStatusStore, syncPullRequestStatusStore } =
			await load();
		const sdk = createFakeSdk({ featureId: "git" });
		registerPullRequestStatusStore(sdk);
		const stop = syncPullRequestStatusStore(sdk);

		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 4 }));
		expect(peek(sdk)).toEqual({ "ws:local": { state: "open" } });

		useGitPrStatusStore
			.getState()
			.setSnapshot("ws:local", snapshot({ number: 4, state: "merged" }));
		expect(peek(sdk)).toEqual({ "ws:local": { state: "merged" } });

		stop();
		useGitPrStatusStore
			.getState()
			.setSnapshot("ws:local", snapshot({ number: 4, state: "closed" }));
		expect(peek(sdk)).toEqual({ "ws:local": { state: "merged" } });
	});

	it("keeps the published value when only the PR number or draft flag changes", async () => {
		const { useGitPrStatusStore, registerPullRequestStatusStore, syncPullRequestStatusStore } =
			await load();
		const sdk = createFakeSdk({ featureId: "git" });
		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 4 }));
		registerPullRequestStatusStore(sdk);
		const stop = syncPullRequestStatusStore(sdk);
		const before = peek(sdk);
		const listener = vi.fn();
		const unsubscribe = sdk.state
			.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY)
			.subscribe(listener);
		listener.mockClear();

		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 9 }));
		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 9, isDraft: true }));

		expect(peek(sdk)).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
		stop();
	});

	it("keeps the published value when a snapshot changes nothing it projects", async () => {
		const { useGitPrStatusStore, registerPullRequestStatusStore, syncPullRequestStatusStore } =
			await load();
		const sdk = createFakeSdk({ featureId: "git" });
		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 4 }));
		registerPullRequestStatusStore(sdk);
		const stop = syncPullRequestStatusStore(sdk);
		const before = peek(sdk);
		const listener = vi.fn();
		const unsubscribe = sdk.state
			.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY)
			.subscribe(listener);
		listener.mockClear();

		useGitPrStatusStore.getState().setSnapshot("ws:local", snapshot({ number: 4 }));
		useGitPrStatusStore.getState().setSnapshot("ws:worktree:none", snapshot(null));

		expect(peek(sdk)).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
		stop();
	});
});
