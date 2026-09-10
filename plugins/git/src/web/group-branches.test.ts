import { describe, expect, it } from "vitest";

import type { GitBranch } from "../contracts/schemas.js";
import { groupBranches } from "./group-branches.js";

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
	it("groups into Default, Recent, and Other", () => {
		const main = local("main");
		const feature = local("feature");
		const topic = local("topic");
		const develop = remote("origin/develop");

		expect(groupBranches([main, feature, topic, develop], "main", ["topic", "feature"])).toEqual([
			{ identifier: "default", heading: "Default Branch", items: [main] },
			{ identifier: "recent", heading: "Recent Branches", items: [topic, feature] },
			{ identifier: "other", heading: "Other Branches", items: [develop] },
		]);
	});

	it("puts a remote-only default branch in the Default group", () => {
		const originMain = remote("origin/main");

		expect(groupBranches([originMain], "origin/main", [])).toEqual([
			{ identifier: "default", heading: "Default Branch", items: [originMain] },
		]);
	});

	it("omits the Default group when no default branch is given", () => {
		const feature = local("feature");

		expect(groupBranches([feature], undefined, [])).toEqual([
			{ identifier: "other", heading: "Other Branches", items: [feature] },
		]);
	});

	it("omits the Recent group when the only recent name is the default", () => {
		const main = local("main");
		const feature = local("feature");

		expect(groupBranches([main, feature], "main", ["main", "feature"])).toEqual([
			{ identifier: "default", heading: "Default Branch", items: [main] },
			{ identifier: "recent", heading: "Recent Branches", items: [feature] },
		]);
	});

	it("omits the Other group when every branch is default or recent", () => {
		const main = local("main");
		const feature = local("feature");

		expect(groupBranches([main, feature], "main", ["feature"])).toEqual([
			{ identifier: "default", heading: "Default Branch", items: [main] },
			{ identifier: "recent", heading: "Recent Branches", items: [feature] },
		]);
	});

	it("resolves no groups at all for an empty branch list", () => {
		expect(groupBranches([], undefined, [])).toEqual([]);
	});
});
