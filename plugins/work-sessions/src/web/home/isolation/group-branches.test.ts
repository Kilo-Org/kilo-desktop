import { describe, expect, it } from "vitest";

import { branchDisplayName, groupBranches, type IsolationBranch } from "./group-branches";

const local = (name: string): IsolationBranch => ({
	name,
	kind: "local",
	ref: `refs/heads/${name}`,
	upstream: null,
});
const remote = (name: string): IsolationBranch => ({
	name,
	kind: "remote",
	ref: `refs/remotes/${name}`,
	upstream: null,
});

describe("groupBranches", () => {
	it("groups into Default, Recent, Local and Remote", () => {
		const main = local("main");
		const feature = local("feature");
		const spike = local("spike");
		const develop = remote("origin/develop");

		expect(groupBranches([main, feature, spike, develop], "main", ["main", "feature"])).toEqual([
			{ identifier: "default", heading: "Default", items: [main] },
			{ identifier: "recent", heading: "Recent", items: [feature] },
			{ identifier: "local", heading: "Local", items: [spike] },
			{ identifier: "remote", heading: "Remote", items: [develop] },
		]);
	});

	it("labels a remote branch by its path, keeping slashes in the branch name", () => {
		expect(branchDisplayName(remote("origin/codex/fix-foo"))).toBe("codex/fix-foo");
	});
});
