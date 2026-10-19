import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { GIT_PULL_REQUEST_STATUS_STORE_KEY as GIT_CONTRACTS_KEY } from "@kilo-desktop/plugin-git/contracts";
import {
	GIT_PULL_REQUEST_STATUS_STORE_KEY,
	readGitPullRequestStatus,
} from "./git-pull-request-status.js";

describe("readGitPullRequestStatus", () => {
	it("reads the git-owned store", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const value = { "ws:local": { state: "open" as const } };
		sdk.services.stateBroker.register("git", "pull-request-status", value);

		expect(readGitPullRequestStatus(sdk)).toEqual(value);
	});

	it("resolves null when the git plugin never registered the store", () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });

		expect(readGitPullRequestStatus(sdk)).toBeNull();
	});
});

describe("GIT_PULL_REQUEST_STATUS_STORE_KEY", () => {
	// Cross-plugin change-detector: the key is declared locally so kilo-ui
	// carries no runtime dependency on the optional git peer.
	it("matches git's contracts store key", () => {
		expect(GIT_PULL_REQUEST_STATUS_STORE_KEY).toBe(GIT_CONTRACTS_KEY);
		expect(GIT_PULL_REQUEST_STATUS_STORE_KEY).toBe("git.pull-request-status");
	});
});
