import { describe, expect, it } from "vitest";

import type { PullRequest, PullRequestSnapshot } from "../../contracts/index.js";
import { keepDirectories, withCreatedPullRequest, withSnapshot } from "./snapshots.js";

const found: PullRequestSnapshot = {
	identity: "feature|abc",
	branch: "feature",
	repository: "acme/repo",
	parentRepository: null,
	pullRequest: {
		number: 4,
		url: "https://github.com/acme/repo/pull/4",
		title: "Feature",
		baseBranch: "main",
		headBranch: "feature",
		state: "open",
		isDraft: false,
	},
	githubStatus: "ready",
};
const noPullRequest: PullRequestSnapshot = { ...found, pullRequest: null };
const created: PullRequest = {
	number: 7,
	url: "https://github.com/acme/repo/pull/7",
	title: "Feature",
	baseBranch: "main",
	headBranch: "feature",
	state: "open",
	isDraft: true,
};

describe("pull request snapshots", () => {
	it("keeps a known pull request until a snapshot names a branch", () => {
		const known = withSnapshot({}, "/repo", found, 1);

		const unnamed = withSnapshot(
			known,
			"/repo",
			{ ...found, identity: null, branch: null, pullRequest: null, githubStatus: "unsupported" },
			2,
		);
		expect(unnamed).toBe(known);

		expect(
			withSnapshot(known, "/repo", noPullRequest, 3)["/repo"]?.snapshot.pullRequest,
		).toBeNull();
	});

	describe("a pull request the user just created", () => {
		it("is seeded over the directory's last lookup", () => {
			const entries = withCreatedPullRequest(
				withSnapshot({}, "/repo", noPullRequest, 1),
				"/repo",
				"feature",
				created,
				5,
			);
			expect(entries["/repo"]).toEqual({
				snapshot: { ...noPullRequest, pullRequest: created },
				updatedAt: 5,
				createdAt: 5,
			});
			expect(withCreatedPullRequest({}, "/x", "b", created, 5)["/x"]?.snapshot).toMatchObject({
				identity: null,
				branch: "b",
			});
		});

		it("survives an empty lookup while GitHub catches up, then yields to later answers", () => {
			const seeded = withCreatedPullRequest({}, "/repo", "feature", created, 1_000_000);

			expect(withSnapshot(seeded, "/repo", noPullRequest, 1_008_000)).toBe(seeded);
			expect(
				withSnapshot(seeded, "/repo", noPullRequest, 1_060_000)["/repo"]?.snapshot.pullRequest,
			).toBeNull();
		});

		it("stops shielding once a lookup confirms it", () => {
			const confirmed = withSnapshot(
				withCreatedPullRequest({}, "/repo", "feature", created, 1_000),
				"/repo",
				{ ...noPullRequest, pullRequest: created },
				1_001,
			);
			expect(
				withSnapshot(confirmed, "/repo", noPullRequest, 1_002)["/repo"]?.snapshot.pullRequest,
			).toBeNull();
		});

		it("does not shield a lookup for a different branch", () => {
			const seeded = withCreatedPullRequest({}, "/repo", "feature", created, 1_000);
			expect(
				withSnapshot(seeded, "/repo", { ...noPullRequest, branch: "other" }, 1_001)["/repo"]
					?.snapshot,
			).toMatchObject({ branch: "other", pullRequest: null });
		});
	});

	it("drops directories no longer used, keeping the same entries when none are", () => {
		const entries = withSnapshot(withSnapshot({}, "/a", found, 1), "/b", found, 1);
		expect(keepDirectories(entries, new Set(["/a", "/b"]))).toBe(entries);
		expect(Object.keys(keepDirectories(entries, new Set(["/a"])))).toEqual(["/a"]);
	});
});
