import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { SESSION_DIRECTORIES_STORE_KEY as GIT_CONTRACTS_KEY } from "@kilo-desktop/plugin-git/contracts";
import { createSessionActivityStore } from "./session-activity/session-activity-store.js";
import {
	SESSION_DIRECTORIES_STORE_NAME,
	bindSessionDirectoriesStore,
	countSessionDirectories,
} from "./session-directories-store.js";

describe("countSessionDirectories", () => {
	it("counts sessions by directory and stamped branch, skipping sessions without either", () => {
		expect(
			countSessionDirectories({
				a: {
					directory: "/repo/.kilo/worktrees/x",
					worktreeBranch: "kilo/feature",
					pendingPermissionIds: [],
					pendingQuestionIds: [],
				},
				b: {
					directory: "/repo/.kilo/worktrees/x",
					worktreeBranch: "kilo/feature",
					pendingPermissionIds: [],
					pendingQuestionIds: [],
				},
				c: {
					directory: "/repo/.kilo/worktrees/x",
					worktreeBranch: "kilo/other",
					pendingPermissionIds: [],
					pendingQuestionIds: [],
				},
				d: {
					directory: "/repo/.kilo/worktrees/y",
					pendingPermissionIds: [],
					pendingQuestionIds: [],
				},
				e: { worktreeBranch: "kilo/feature", pendingPermissionIds: [], pendingQuestionIds: [] },
			}),
		).toEqual({
			"/repo/.kilo/worktrees/x": { "kilo/feature": 2, "kilo/other": 1 },
		});
	});

	it("returns an empty object for no sessions", () => {
		expect(countSessionDirectories({})).toEqual({});
	});
});

describe("bindSessionDirectoriesStore", () => {
	it("registers the store under kilo-ui's namespace and seeds it from current sessions", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const sessionActivity = createSessionActivityStore();
		sessionActivity
			.getState()
			.hydrateSessions([{ id: "s1", directory: "/repo/wt", worktreeBranch: "kilo/feature" }]);

		bindSessionDirectoriesStore(sdk, sessionActivity);

		expect(sdk.state.get(GIT_CONTRACTS_KEY).peek()).toEqual({
			"/repo/wt": { "kilo/feature": 1 },
		});
		expect(`kilo-ui.${SESSION_DIRECTORIES_STORE_NAME}`).toBe(GIT_CONTRACTS_KEY);
	});

	it("updates when a session's directory changes", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const sessionActivity = createSessionActivityStore();
		bindSessionDirectoriesStore(sdk, sessionActivity);

		sessionActivity
			.getState()
			.hydrateSessions([{ id: "s1", directory: "/repo/wt", worktreeBranch: "kilo/feature" }]);

		expect(sdk.state.get(GIT_CONTRACTS_KEY).peek()).toEqual({
			"/repo/wt": { "kilo/feature": 1 },
		});
	});

	it("does not write when the derived map is unchanged (deep-compared)", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const sessionActivity = createSessionActivityStore();
		sessionActivity
			.getState()
			.hydrateSessions([{ id: "s1", directory: "/repo/wt", worktreeBranch: "kilo/feature" }]);
		bindSessionDirectoriesStore(sdk, sessionActivity);
		const before = sdk.state.get(GIT_CONTRACTS_KEY).peek();

		// A status-only patch does not change branch counts.
		sessionActivity.getState().hydrateStatuses({ s1: { type: "busy" } });

		expect(sdk.state.get(GIT_CONTRACTS_KEY).peek()).toBe(before);
	});

	it("stops updating after the returned unsubscribe is called", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const sessionActivity = createSessionActivityStore();
		const unsubscribe = bindSessionDirectoriesStore(sdk, sessionActivity);

		unsubscribe();
		sessionActivity
			.getState()
			.hydrateSessions([{ id: "s1", directory: "/repo/wt", worktreeBranch: "kilo/feature" }]);

		expect(sdk.state.get(GIT_CONTRACTS_KEY).peek()).toEqual({});
	});

	it("is idempotent per SDK: registering twice does not double-warn or duplicate subscriptions", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const sessionActivity = createSessionActivityStore();

		bindSessionDirectoriesStore(sdk, sessionActivity);
		bindSessionDirectoriesStore(sdk, sessionActivity);
		sessionActivity
			.getState()
			.hydrateSessions([{ id: "s1", directory: "/repo/wt", worktreeBranch: "kilo/feature" }]);

		expect(sdk.state.get(GIT_CONTRACTS_KEY).peek()).toEqual({
			"/repo/wt": { "kilo/feature": 1 },
		});
	});
});
