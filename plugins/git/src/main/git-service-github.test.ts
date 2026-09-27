import { beforeEach, describe, expect, it, vi } from "vitest";

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));
vi.mock("execa", () => ({ execa }));

import type { GitClient } from "@kilo-desktop/git-client";

import { classifyGithubCliError, ghErrorToFeatureError, GitService } from "./git-service.js";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function service() {
	return new GitService({
		logger,
		getWorkspaceFolderPaths: () => Promise.resolve(["/repo"]),
		createClient: () => ({}) as GitClient,
	});
}

beforeEach(() => {
	execa.mockReset();
});

describe("GitService GitHub CLI capability", () => {
	it("reports ready and caches a successful probe", async () => {
		execa.mockResolvedValue({ exitCode: 0, stderr: "" });
		const git = service();

		await expect(git.githubCliStatus()).resolves.toEqual({ status: "ready" });
		await expect(git.githubCliStatus()).resolves.toEqual({ status: "ready" });
		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("classifies missing, unauthenticated, timeout, and generic failures", async () => {
		const cases = [
			[{ code: "ENOENT" }, "missing"],
			[{ stderr: "Run gh auth login" }, "unauthenticated"],
			[{ timedOut: true }, "timeout"],
			[{ stderr: "network failed" }, "error"],
		] as const;

		for (const [failure, expected] of cases) {
			execa.mockRejectedValueOnce(failure);
			await expect(service().githubCliStatus()).resolves.toEqual({ status: expected });
		}
	});

	it("classifies a nonzero auth-status result and force bypasses the cache", async () => {
		execa
			.mockResolvedValueOnce({ exitCode: 1, stderr: "not logged into any GitHub hosts" })
			.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
		const git = service();

		await expect(git.githubCliStatus()).resolves.toEqual({ status: "unauthenticated" });
		await expect(git.githubCliStatus(true)).resolves.toEqual({ status: "ready" });
	});

	it("maps GitHub CLI failures to user-facing errors", () => {
		expect(ghErrorToFeatureError({ code: "ENOENT" }).message).toContain("not installed");
		expect(ghErrorToFeatureError({ stderr: "Run gh auth login" }).message).toContain(
			"Not authenticated",
		);
		expect(ghErrorToFeatureError({ stderr: "network failed" }).message).toBe("network failed");
		expect(ghErrorToFeatureError({}).message).toBe("GitHub CLI operation failed.");
	});

	it("classifies GitHub CLI failure shapes", () => {
		expect(classifyGithubCliError({ code: "ENOENT" })).toBe("missing");
		expect(classifyGithubCliError({ timedOut: true })).toBe("timeout");
		expect(classifyGithubCliError({ stderr: "authentication required" })).toBe("unauthenticated");
		expect(classifyGithubCliError({ stderr: "network failed" })).toBe("error");
	});
});

const HEAD = "aaf0640c751fcf21b2743b189ec3e531ad02a808";

function snapshotService(
	options: {
		origin?: string | null;
		head?: string | null;
		upstream?: string;
		/** `ancestor..descendant` pairs `merge-base --is-ancestor` confirms. */
		ancestry?: readonly string[];
	} = {},
) {
	const origin = options.origin === undefined ? "git@github.com:acme/repo.git" : options.origin;
	const head = options.head === undefined ? HEAD : options.head;
	return new GitService({
		logger,
		getWorkspaceFolderPaths: () => Promise.resolve(["/repo"]),
		createClient: () =>
			({
				status: () =>
					Promise.resolve({
						exists: true,
						currentBranch: "kilo/brawny-olivine",
						currentUpstreamBranch: options.upstream,
						workingDirectory: { files: [] },
						doConflictedFilesExist: false,
					}),
				exec: (args: readonly string[]) => {
					if (args[0] === "rev-parse") {
						return Promise.resolve(
							head
								? { exitCode: 0, stdout: `${head}\n`, stderr: "" }
								: { exitCode: 1, stdout: "", stderr: "" },
						);
					}
					if (args[0] === "remote") {
						return Promise.resolve(
							origin
								? { exitCode: 0, stdout: `${origin}\n`, stderr: "" }
								: { exitCode: 2, stdout: "", stderr: "" },
						);
					}
					if (args[0] === "merge-base") {
						const related = options.ancestry?.includes(`${args[2]}..${args[3]}`) ?? false;
						return Promise.resolve({ exitCode: related ? 0 : 1, stdout: "", stderr: "" });
					}
					return Promise.reject(new Error(`unexpected git ${args.join(" ")}`));
				},
				defaultBranch: () => Promise.resolve("main"),
			}) as unknown as GitClient,
	});
}

function pullRequest(patch: Record<string, unknown>) {
	return {
		number: 525,
		url: "https://github.com/acme/repo/pull/525",
		title: "unrelated",
		baseRefName: "main",
		headRefName: "kilo/investigate-e2e-test-flakiness",
		headRefOid: "aeb3e04d",
		state: "MERGED",
		isDraft: false,
		updatedAt: "2026-09-22T00:00:00Z",
		...patch,
	};
}

describe("GitService pull request snapshot", () => {
	it("does not adopt a merged pull request that only shares HEAD", async () => {
		execa.mockImplementation(async (_command: string, args: string[] = []) => {
			if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
			if (args[0] === "repo") {
				return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "acme/repo" }), stderr: "" };
			}
			if (args[1] === "view") return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
			if (args.includes("--search")) {
				return { exitCode: 0, stdout: JSON.stringify([pullRequest({})]), stderr: "" };
			}
			if (args.includes("--head")) return { exitCode: 0, stdout: "[]", stderr: "" };
			return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
		});

		await expect(snapshotService().pullRequestSnapshot("/repo")).resolves.toMatchObject({
			branch: "kilo/brawny-olivine",
			pullRequest: null,
		});
	});

	it("does not adopt the base branch's open pull request for a new branch at the same HEAD", async () => {
		execa.mockImplementation(async (_command: string, args: string[] = []) => {
			if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
			if (args[0] === "repo") {
				return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "acme/repo" }), stderr: "" };
			}
			if (args[1] === "view") return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
			if (args.includes("--search")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify([
						pullRequest({ headRefName: "feature/base", headRefOid: HEAD, state: "OPEN" }),
					]),
					stderr: "",
				};
			}
			if (args.includes("--head")) return { exitCode: 0, stdout: "[]", stderr: "" };
			return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
		});

		await expect(snapshotService().pullRequestSnapshot("/repo")).resolves.toMatchObject({
			branch: "kilo/brawny-olivine",
			pullRequest: null,
		});
	});

	it("accepts an open pull request at HEAD whose head is the upstream branch", async () => {
		execa.mockImplementation(async (_command: string, args: string[] = []) => {
			if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
			if (args[0] === "repo") {
				return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "acme/repo" }), stderr: "" };
			}
			if (args[1] === "view") return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
			if (args.includes("--search")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify([
						pullRequest({
							number: 12,
							url: "https://github.com/acme/repo/pull/12",
							title: "this branch",
							headRefName: "renamed",
							headRefOid: HEAD,
							state: "OPEN",
						}),
					]),
					stderr: "",
				};
			}
			return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
		});

		await expect(
			snapshotService({ upstream: "origin/renamed" }).pullRequestSnapshot("/repo"),
		).resolves.toMatchObject({
			pullRequest: { number: 12, state: "open" },
		});
		expect(execa).toHaveBeenCalledWith(
			"gh",
			expect.arrayContaining(["--state", "open", "--search", `${HEAD} is:pr`]),
			expect.anything(),
		);
	});

	it("never spawns gh for a non-GitHub origin", async () => {
		await expect(
			snapshotService({ origin: "git@gitlab.com:acme/repo.git" }).pullRequestSnapshot("/repo"),
		).resolves.toMatchObject({ githubStatus: "unsupported", pullRequest: null });
		expect(execa).not.toHaveBeenCalled();
	});

	it("reports an unusable GitHub CLI as status instead of failing", async () => {
		execa.mockImplementation(async () => {
			throw { code: "ENOENT" };
		});

		await expect(snapshotService().pullRequestSnapshot("/repo")).resolves.toMatchObject({
			githubStatus: "missing",
			pullRequest: null,
		});
		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("resolves an unborn branch without querying pull requests", async () => {
		execa.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

		await expect(
			snapshotService({ head: null }).pullRequestSnapshot("/repo"),
		).resolves.toMatchObject({
			branch: "kilo/brawny-olivine",
			githubStatus: "ready",
			pullRequest: null,
		});
		expect(execa).toHaveBeenCalledTimes(1);
	});

	it("filters branch-name matches to the origin owner", async () => {
		execa.mockImplementation(async (_command: string, args: string[] = []) => {
			if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
			if (args[0] === "repo") {
				return { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: "acme/repo" }), stderr: "" };
			}
			if (args[1] === "view") return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
			if (args.includes("--search")) return { exitCode: 0, stdout: "[]", stderr: "" };
			if (args.includes("--head")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify([
						pullRequest({ number: 7, state: "OPEN", headRepositoryOwner: { login: "someone" } }),
						pullRequest({ number: 8, state: "OPEN", headRepositoryOwner: { login: "Acme" } }),
					]),
					stderr: "",
				};
			}
			return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
		});

		await expect(snapshotService().pullRequestSnapshot("/repo")).resolves.toMatchObject({
			pullRequest: { number: 8 },
		});
		expect(execa).toHaveBeenCalledWith(
			"gh",
			expect.arrayContaining(["--head", "kilo/brawny-olivine"]),
			expect.anything(),
		);
	});

	describe("a merged pull request found by branch name", () => {
		const PR_HEAD = "bbf0640c751fcf21b2743b189ec3e531ad02a808";
		const MERGE = "ccf0640c751fcf21b2743b189ec3e531ad02a808";

		function mockMergedByName(patch: Record<string, unknown> = {}) {
			execa.mockImplementation(async (_command: string, args: string[] = []) => {
				if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "" };
				if (args[0] === "repo") {
					return {
						exitCode: 0,
						stdout: JSON.stringify({ nameWithOwner: "acme/repo" }),
						stderr: "",
					};
				}
				if (args[1] === "view") {
					return {
						exitCode: 0,
						stdout: JSON.stringify(
							pullRequest({
								number: 3,
								headRefName: "kilo/brawny-olivine",
								headRefOid: PR_HEAD,
								mergeCommit: { oid: MERGE },
								...patch,
							}),
						),
						stderr: "",
					};
				}
				return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
			});
		}

		it.each([
			["HEAD contains its head", [`${PR_HEAD}..HEAD`], 3],
			["HEAD trails its head", [`HEAD..${PR_HEAD}`], 3],
			["a recreated branch shares none of its history", [], undefined],
			["HEAD also contains its merge commit", [`${PR_HEAD}..HEAD`, `${MERGE}..HEAD`], undefined],
		])("is kept only when it is in the checkout's history: %s", async (_, ancestry, number) => {
			mockMergedByName();

			const snapshot = await snapshotService({ ancestry }).pullRequestSnapshot("/repo");

			expect(snapshot.pullRequest?.number).toBe(number);
		});

		it("treats a head that is not an object name as unknown instead of passing it to git", async () => {
			mockMergedByName({ headRefOid: "--output=/tmp/x" });

			await expect(snapshotService().pullRequestSnapshot("/repo")).resolves.toMatchObject({
				pullRequest: { number: 3 },
			});
		});
	});
});
