import { describe, expect, it } from "vitest";

import { branchDisplayName } from "./branch-display-name";

describe("branchDisplayName", () => {
	it("keeps local branch names unchanged", () => {
		expect(
			branchDisplayName({
				name: "main",
				kind: "local",
				ref: "refs/heads/main",
			}),
		).toBe("main");
	});

	it("strips the remote from a remote-tracking ref", () => {
		expect(
			branchDisplayName({
				name: "origin/feature",
				kind: "remote",
				ref: "refs/remotes/origin/feature",
			}),
		).toBe("feature");
	});

	it("keeps slashes that belong to the branch name", () => {
		expect(
			branchDisplayName({
				name: "origin/codex/fix-foo",
				kind: "remote",
				ref: "refs/remotes/origin/codex/fix-foo",
			}),
		).toBe("codex/fix-foo");
	});
});
