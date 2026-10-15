import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { GitEventsProvider } from "./GitEventsProvider.js";

afterEach(() => {
	cleanup();
});

describe("GitEventsProvider", () => {
	it("invalidates branches queries when worktree-branch-renamed fires", async () => {
		const sdk = createFakeSdk({ featureId: "git" });
		const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
		const system = createFakeFeatureSystem({ sdks: { git: sdk } });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		// Prime the query cache with a stale branches entry so we can observe
		// invalidation (an empty cache has nothing to invalidate).
		queryClient.setQueryData(["git", "branches", { workingDirectory: "/repo" }], {
			currentBranch: "kilo/old-name",
			branches: [],
		});

		render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<GitEventsProvider />
				</QueryClientProvider>
			</SdkProvider>,
		);

		// Emit the rename event from the main SDK (shared event bus).
		mainSdk.events.emit("worktree-branch-renamed", {
			path: "/repo/.kilo/worktrees/kilo-old-name",
			branch: "kilo/new-name",
		});

		// The branches query should now be marked stale (invalid).
		await vi.waitFor(() => {
			expect(
				queryClient.getQueryState(["git", "branches", { workingDirectory: "/repo" }])
					?.isInvalidated,
			).toBe(true);
		});

		mainSdk.dispose();
	});

	it("invalidates status queries when worktree-branch-renamed fires", async () => {
		const sdk = createFakeSdk({ featureId: "git" });
		const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
		const system = createFakeFeatureSystem({ sdks: { git: sdk } });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const statusKey = ["git", "status", { workingDirectory: "/repo" }];
		queryClient.setQueryData(statusKey, {
			exists: true,
			currentBranch: "kilo/old-name",
			workingDirectory: { files: [] },
			doConflictedFilesExist: false,
		});

		render(
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<GitEventsProvider />
				</QueryClientProvider>
			</SdkProvider>,
		);

		mainSdk.events.emit("worktree-branch-renamed", {
			path: "/repo/.kilo/worktrees/kilo-old-name",
			branch: "kilo/new-name",
		});

		await vi.waitFor(() => {
			expect(queryClient.getQueryState(statusKey)?.isInvalidated).toBe(true);
		});

		mainSdk.dispose();
	});
});
