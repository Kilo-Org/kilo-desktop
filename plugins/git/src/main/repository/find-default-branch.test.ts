import { describe, expect, it } from "vitest";

import type { GitBranch } from "../../contracts/models";
import { findDefaultBranch } from "./find-default-branch";

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

describe("findDefaultBranch", () => {
	it("prefers a local branch tracking the remote HEAD", () => {
		const branches = [local("main", "origin/main"), remote("origin/main")];

		expect(findDefaultBranch(branches, "main", null)).toBe("main");
	});

	it("prefers the tracking local also named like the default when two locals track the remote HEAD", () => {
		const branches = [local("develop", "origin/main"), local("main", "origin/main")];

		expect(findDefaultBranch(branches, "main", null)).toBe("main");
	});

	it("falls back to a local branch named like the default", () => {
		const branches = [local("main"), local("feature")];

		expect(findDefaultBranch(branches, "main", null)).toBe("main");
	});

	it("falls back to the remote branch itself", () => {
		const branches = [local("feature"), remote("origin/main")];

		expect(findDefaultBranch(branches, "main", null)).toBe("origin/main");
	});

	it("uses the configured default when the remote HEAD is absent", () => {
		const branches = [local("trunk"), local("main")];

		expect(findDefaultBranch(branches, null, "trunk")).toBe("trunk");
	});

	it("falls back to main when neither remote HEAD nor config resolve", () => {
		const branches = [local("master"), local("main")];

		expect(findDefaultBranch(branches, null, null)).toBe("main");
	});

	it("resolves undefined when no branch matches the detected name", () => {
		const branches = [local("feature")];

		expect(findDefaultBranch(branches, "main", null)).toBe(undefined);
	});
});
