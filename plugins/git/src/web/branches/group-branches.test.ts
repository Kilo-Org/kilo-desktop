import { describe, expect, it } from "vitest";

import type { GitBranch } from "../../contracts";
import { filterBranchGroups, groupBranches } from "./group-branches";

function local(name: string, upstream: string | null = null): GitBranch {
	return { name, upstream, tip: { sha: "sha" }, ref: `refs/heads/${name}`, kind: "local" };
}

function remote(name: string): GitBranch {
	return {
		name,
		upstream: null,
		tip: { sha: "sha" },
		ref: `refs/remotes/${name}`,
		kind: "remote",
	};
}

describe("groupBranches", () => {
	it("groups into Default, Recent, Local, and Remote", () => {
		const main = local("main");
		const feature = local("feature");
		const topic = local("topic");
		const spike = local("spike");
		const develop = remote("origin/develop");

		expect(
			groupBranches([main, feature, topic, spike, develop], "main", ["topic", "feature"]),
		).toEqual([
			{ identifier: "default", heading: "Default", items: [main] },
			{ identifier: "recent", heading: "Recent", items: [topic, feature] },
			{ identifier: "local", heading: "Local", items: [spike] },
			{ identifier: "remote", heading: "Remote", items: [develop] },
		]);
	});

	it("puts a remote-only default branch in the Default group", () => {
		const originMain = remote("origin/main");

		expect(groupBranches([originMain], "origin/main", [])).toEqual([
			{ identifier: "default", heading: "Default", items: [originMain] },
		]);
	});

	it("omits the Default group when no default branch is given", () => {
		const feature = local("feature");

		expect(groupBranches([feature], undefined, [])).toEqual([
			{ identifier: "local", heading: "Local", items: [feature] },
		]);
	});

	it("omits the Recent group when the only recent name is the default", () => {
		const main = local("main");
		const feature = local("feature");

		expect(groupBranches([main, feature], "main", ["main", "feature"])).toEqual([
			{ identifier: "default", heading: "Default", items: [main] },
			{ identifier: "recent", heading: "Recent", items: [feature] },
		]);
	});

	it("omits the Local and Remote groups when every branch is default or recent", () => {
		const main = local("main");
		const feature = local("feature");

		expect(groupBranches([main, feature], "main", ["feature"])).toEqual([
			{ identifier: "default", heading: "Default", items: [main] },
			{ identifier: "recent", heading: "Recent", items: [feature] },
		]);
	});

	it("resolves no groups at all for an empty branch list", () => {
		expect(groupBranches([], undefined, [])).toEqual([]);
	});
});

describe("filterBranchGroups", () => {
	const main = local("main");
	const feature = local("feature-login");
	const featureAuth = local("auth-feature");
	const develop = remote("origin/develop");
	const groups = groupBranches([main, feature, featureAuth, develop], "main", []);

	it("returns every group unchanged for an empty search", () => {
		expect(filterBranchGroups(groups, "")).toEqual(groups);
	});

	it("drops groups with no matching branch and keeps group order", () => {
		expect(filterBranchGroups(groups, "dev")).toEqual([
			{ identifier: "remote", heading: "Remote", items: [develop] },
		]);
	});

	it("matches fuzzily like the command menu and puts the best match first", () => {
		const [localGroup] = filterBranchGroups(groups, "feat");
		expect(localGroup?.items).toEqual([feature, featureAuth]);
		expect(filterBranchGroups(groups, "ftlg")[0]?.items).toEqual([feature]);
	});

	it("matches a remote branch by its remote prefix", () => {
		expect(filterBranchGroups(groups, "origin/dev")[0]?.items).toEqual([develop]);
	});
});
