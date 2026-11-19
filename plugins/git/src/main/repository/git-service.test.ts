import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KernelLogger } from "@kilo-desktop/kernel";
import {
	AppFileStatusKind,
	GitError,
	GitErrorCode,
	GitFileTooLargeError,
	GitNotDetectedError,
	UnsupportedGitVersionError,
} from "@kilo-desktop/git-client";
import type { IGitStringResult, WorktreeEntry } from "@kilo-desktop/git-client";

import { GitService, type GitClientSlice } from "./git-service";
import { createPathIdentity } from "./path-identity";
import { absentFolders, folders } from "./test-workspace-access";

const logger: KernelLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const SHORT_TEMP = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp";
const LONG_TEMP = "C:\\Users\\runneradmin\\AppData\\Local\\Temp";

/** Windows paths where the short temp folder's repo exists under its long name. */
const windowsPaths = createPathIdentity({
	platform: "win32",
	realpath: async (target) => {
		if (target.startsWith(`${SHORT_TEMP}\\`)) return LONG_TEMP + target.slice(SHORT_TEMP.length);
		if (target.startsWith(`${LONG_TEMP}\\`)) return target;
		throw Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" });
	},
});

/**
 * Fills any missing slice member with a harmless default so tests only spell
 * out the calls they assert on.
 */
function clientOf(client: Partial<GitClientSlice>): GitClientSlice {
	return {
		status: () => Promise.reject(new Error("unused")),
		headBranch: () => Promise.reject(new Error("unused")),
		version: () => Promise.resolve("2.39.5"),
		branches: () => Promise.resolve(null),
		createBranch: () => Promise.resolve(),
		checkoutBranch: () => Promise.resolve(),
		repositoryType: () => Promise.resolve({ kind: "missing" }),
		initRepository: () => Promise.resolve(),
		createWorkingDirectoryPatch: () => Promise.resolve(null),
		getFileContents: () => Promise.resolve({ oldContents: null, newContents: null }),
		remoteHead: () => Promise.resolve(null),
		globalConfigValue: () => Promise.resolve(null),
		recentBranches: () => Promise.resolve([]),
		worktrees: () => Promise.resolve([]),
		addWorktree: () => Promise.resolve(),
		removeWorktree: () => Promise.resolve(),
		deleteBranch: () => Promise.resolve(),
		renameBranch: () => Promise.resolve(),
		defaultBranch: () => Promise.resolve(null),
		remotes: () => Promise.resolve([]),
		pruneWorktrees: () => Promise.resolve(),
		checkRefFormat: () => Promise.resolve(true),
		gitCommonDir: () => Promise.resolve("/repo/.git"),
		exec: (() => Promise.resolve(null)) as unknown as GitClientSlice["exec"],
		...client,
	};
}

/** A status result with the given current branch and a clean tree. */
function statusOn(currentBranch: string) {
	return () =>
		Promise.resolve({
			exists: true,
			currentBranch,
			workingDirectory: { files: [] },
			doConflictedFilesExist: false,
		});
}

function localBranch(name: string, upstream: string | null = null) {
	return {
		name,
		upstream,
		tip: { sha: "abc123" },
		ref: `refs/heads/${name}`,
	};
}

const XCODE_LICENSE_STDERR =
	"You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license.";
const XCODE_LICENSE_DESCRIPTION =
	"Git is blocked until you agree to the Xcode license. Open a terminal and run 'sudo xcodebuild -license accept', then try again.";

/** The GitError git-client throws when the macOS git shim reports an unaccepted Xcode license. */
function xcodeLicenseError(): GitError {
	return new GitError(
		{
			stdout: "",
			stderr: XCODE_LICENSE_STDERR,
			exitCode: 69,
			gitError: GitErrorCode.XcodeLicenseNotAgreed,
			gitErrorDescription: XCODE_LICENSE_DESCRIPTION,
			path: "/repo",
		},
		["status"],
		XCODE_LICENSE_STDERR,
	);
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

/** A real file in a real temp directory, so release/dispose removals are observable. */
async function writeFileToTemp(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	const filePath = join(directory, "changes.patch");
	await writeFile(filePath, "x");
	return filePath;
}

function stringResult(overrides: Partial<IGitStringResult> = {}): IGitStringResult {
	return {
		stdout: "",
		stderr: "",
		exitCode: 1,
		gitError: null,
		gitErrorDescription: null,
		path: "",
		...overrides,
	};
}

describe("GitService", () => {
	it("rejects option-like push branches before invoking git", async () => {
		const exec = vi.fn();
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () => clientOf({ exec, status: statusOn("--force") }),
		});

		await expect(service.push("/some/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		expect(exec).not.toHaveBeenCalled();
	});

	it("publishes the branch checked out at push time, not a caller-supplied name", async () => {
		const exec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }));
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					exec: exec as unknown as GitClientSlice["exec"],
					status: statusOn("kilo/renamed-branch"),
				}),
		});

		await service.push("/some/repo");

		expect(exec).toHaveBeenCalledWith(
			["push", "--set-upstream", "origin", "kilo/renamed-branch"],
			"push",
			{ cwd: "/some/repo" },
		);
	});

	it("pushes to the tracked upstream when the branch already has one", async () => {
		const exec = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }));
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					exec: exec as unknown as GitClientSlice["exec"],
					status: () =>
						Promise.resolve({
							exists: true,
							currentBranch: "feature",
							currentUpstreamBranch: "origin/feature",
							workingDirectory: { files: [] },
							doConflictedFilesExist: false,
						}),
				}),
		});

		await service.push("/some/repo");

		expect(exec).toHaveBeenCalledWith(["push"], "push", { cwd: "/some/repo" });
	});

	it("refuses to push a detached HEAD", async () => {
		const exec = vi.fn();
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					exec,
					status: () =>
						Promise.resolve({
							exists: true,
							workingDirectory: { files: [] },
							doConflictedFilesExist: false,
						}),
				}),
		});

		await expect(service.push("/some/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
		});
		expect(exec).not.toHaveBeenCalled();
	});

	it("rejects option-like pull request base branches before invoking git", async () => {
		const exec = vi.fn();
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () => clientOf({ exec }),
		});

		await expect(
			service.pullRequestContext("/some/repo", "--output=/tmp/exfiltrate"),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
		expect(exec).not.toHaveBeenCalled();
	});

	it("rejects with a BUSINESS KernelError when the git binary is not found", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new GitNotDetectedError()),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: "Git was not found. Install Git, then restart Kilo Desktop.",
		});
	});

	it("rejects with a BUSINESS KernelError naming both versions when git is too old", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new UnsupportedGitVersionError("2.14.1", "2.17.0")),
				}),
		});

		const error = await service.status("/some/repo").catch((e: unknown) => e);
		expect(error).toMatchObject({ name: "KernelError", code: "BUSINESS" });
		expect((error as Error).message).toContain("Git 2.14.1");
		expect((error as Error).message).toContain("Git 2.17 or newer");
	});

	it("lets other errors propagate unwrapped", async () => {
		const failure = new Error("fatal: unexpected git failure");
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(failure),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toBe(failure);
	});

	it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(xcodeLicenseError()),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: XCODE_LICENSE_DESCRIPTION,
		});
	});

	it("maps a missing-command-line-tools GitError to a BUSINESS KernelError with its description", async () => {
		const description =
			"Git needs the Xcode Command Line Tools. Install them from the macOS prompt or run 'xcode-select --install' in a terminal, then try again.";
		const stderr = "xcode-select: note: No developer tools were found, requesting install.";
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () =>
						Promise.reject(
							new GitError(
								{
									stdout: "",
									stderr,
									exitCode: 1,
									gitError: GitErrorCode.XcodeCommandLineToolsMissing,
									gitErrorDescription: description,
									path: "/repo",
								},
								["status"],
								stderr,
							),
						),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: description,
		});
	});

	describe("branches", () => {
		it("lists remotes that no local branch tracks and tags each kind", async () => {
			const branches = vi.fn(() =>
				Promise.resolve([
					{
						name: "main",
						upstream: "origin/main",
						tip: { sha: "aaa" },
						ref: "refs/heads/main",
					},
					{
						name: "origin/main",
						upstream: null,
						tip: { sha: "aaa" },
						ref: "refs/remotes/origin/main",
					},
					{
						name: "origin/feature",
						upstream: null,
						tip: { sha: "bbb" },
						ref: "refs/remotes/origin/feature",
					},
				]),
			);
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: () =>
							Promise.resolve({
								exists: true,
								currentBranch: "main",
								workingDirectory: { files: [] },
								doConflictedFilesExist: false,
							}),
						branches,
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toEqual({
				currentBranch: "main",
				branches: [
					{
						name: "main",
						upstream: "origin/main",
						tip: { sha: "aaa" },
						ref: "refs/heads/main",
						kind: "local",
					},
					{
						name: "origin/feature",
						upstream: null,
						tip: { sha: "bbb" },
						ref: "refs/remotes/origin/feature",
						kind: "remote",
					},
				],
				defaultBranch: "main",
				recentBranches: [],
			});
			expect(branches).toHaveBeenCalledWith({
				cwd: "/repos/project",
				prefixes: ["refs/heads", "refs/remotes"],
			});
		});

		it("runs the default-branch and recent-branch probes alongside the branch probes", async () => {
			const remoteHead = vi.fn(() => Promise.resolve("main"));
			const globalConfigValue = vi.fn(() => Promise.resolve(null));
			const recentBranches = vi.fn(() => Promise.resolve([]));
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () => Promise.resolve([localBranch("main", "origin/main")]),
						remoteHead,
						globalConfigValue,
						recentBranches,
					}),
			});

			await service.branches("/repos/project");

			expect(remoteHead).toHaveBeenCalledWith("origin", { cwd: "/repos/project" });
			expect(globalConfigValue).toHaveBeenCalledWith("init.defaultBranch");
			// One more than the recent limit: the default branch often appears in
			// the reflog and is filtered afterwards.
			expect(recentBranches).toHaveBeenCalledWith(6, { cwd: "/repos/project" });
		});

		it("reports the default branch resolved from the remote HEAD", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("develop"),
						branches: () =>
							Promise.resolve([
								localBranch("develop", "origin/main"),
								localBranch("main", "origin/main"),
							]),
						remoteHead: () => Promise.resolve("main"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				defaultBranch: "main",
			});
		});

		it("falls back to the configured default branch without a remote HEAD", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("trunk"),
						branches: () => Promise.resolve([localBranch("trunk"), localBranch("main")]),
						globalConfigValue: () => Promise.resolve("trunk"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				defaultBranch: "trunk",
			});
		});

		it("omits defaultBranch when no branch matches the detected name", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("feature"),
						branches: () => Promise.resolve([localBranch("feature")]),
						remoteHead: () => Promise.resolve("main"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toEqual({
				currentBranch: "feature",
				branches: [
					{
						name: "feature",
						upstream: null,
						tip: { sha: "abc123" },
						ref: "refs/heads/feature",
						kind: "local",
					},
				],
				recentBranches: [],
			});
		});

		it("resolves recentBranches in reflog order, dropping the default and deleted branches", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () =>
							Promise.resolve([
								localBranch("main"),
								localBranch("topic-b"),
								localBranch("topic-a"),
							]),
						recentBranches: () => Promise.resolve(["main", "topic-b", "deleted", "topic-a"]),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				recentBranches: ["topic-b", "topic-a"],
			});
		});

		it("caps recentBranches at five", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () =>
							Promise.resolve([
								localBranch("main"),
								localBranch("topic-1"),
								localBranch("topic-2"),
								localBranch("topic-3"),
								localBranch("topic-4"),
								localBranch("topic-5"),
							]),
						recentBranches: () =>
							Promise.resolve(["main", "topic-1", "topic-2", "topic-3", "topic-4", "topic-5"]),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				recentBranches: ["topic-1", "topic-2", "topic-3", "topic-4", "topic-5"],
			});
		});

		it("resolves null when either probe reports not a repository", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/not/a/repo"),
				createClient: () =>
					clientOf({
						status: () => Promise.resolve(null),
						branches: () =>
							Promise.resolve([
								{
									name: "main",
									upstream: null,
									tip: { sha: "abc123" },
									ref: "refs/heads/main",
								},
							]),
						createBranch: () => Promise.resolve(),
						checkoutBranch: () => Promise.resolve(),
						version: () => Promise.resolve("2.39.5"),
					}),
			});

			await expect(service.branches("/not/a/repo")).resolves.toBe(null);
		});

		it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						branches: () => Promise.reject(xcodeLicenseError()),
						status: statusOn("main"),
					}),
			});

			await expect(service.branches("/repos/project")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: XCODE_LICENSE_DESCRIPTION,
			});
		});
	});

	describe("repositoryType", () => {
		it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/some/repo"),
				createClient: () => clientOf({ repositoryType: () => Promise.reject(xcodeLicenseError()) }),
			});

			await expect(service.repositoryType("/some/repo")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: XCODE_LICENSE_DESCRIPTION,
			});
		});
	});

	describe("init", () => {
		it("rejects with VALIDATION when the directory is outside every workspace folder", async () => {
			const initRepository = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				workspaces: folders("/workspaces/project"),
				createClient: () => clientOf({ initRepository }),
			});

			await expect(service.init("/elsewhere/other")).rejects.toMatchObject({
				name: "KernelError",
				code: "VALIDATION",
			});
			expect(initRepository).not.toHaveBeenCalled();
		});

		it("fails closed with VALIDATION when the workspaces capability is absent", async () => {
			const initRepository = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				workspaces: absentFolders(),
				createClient: () => clientOf({ initRepository }),
			});

			await expect(service.init("/workspaces/project")).rejects.toMatchObject({
				name: "KernelError",
				code: "VALIDATION",
			});
			expect(initRepository).not.toHaveBeenCalled();
		});

		it("maps GitNotDetectedError to a BUSINESS KernelError", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({ initRepository: () => Promise.reject(new GitNotDetectedError()) }),
			});

			await expect(service.init("/repos/project")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
			});
		});

		it("lets other errors propagate unwrapped", async () => {
			const failure = new Error("fatal: cannot init");
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () => clientOf({ initRepository: () => Promise.reject(failure) }),
			});

			await expect(service.init("/repos/project")).rejects.toBe(failure);
		});
	});

	describe("checkout", () => {
		it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/some/repo"),
				createClient: () => clientOf({ checkoutBranch: () => Promise.reject(xcodeLicenseError()) }),
			});

			await expect(service.checkout("/some/repo", "topic")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: XCODE_LICENSE_DESCRIPTION,
			});
		});

		it("maps a branch already checked out in another worktree to a KernelError", async () => {
			const gitError = new GitError(
				stringResult({
					gitError: GitErrorCode.BranchAlreadyCheckedOut,
					gitErrorDescription: "This branch is already checked out in another worktree.",
				}),
				["checkout", "feature"],
				"",
			);
			const service = new GitService({
				logger,
				workspaces: folders("/some/repo"),
				createClient: () => clientOf({ checkoutBranch: () => Promise.reject(gitError) }),
			});

			await expect(service.checkout("/some/repo", "feature")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: "This branch is already checked out in another worktree.",
			});
		});
	});

	it("maps a license-blocked GitError from an action to a BUSINESS KernelError with its description", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/some/repo"),
			createClient: () =>
				clientOf({
					exec: (() => Promise.reject(xcodeLicenseError())) as unknown as GitClientSlice["exec"],
				}),
		});

		await expect(service.commit("/some/repo", "message")).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: XCODE_LICENSE_DESCRIPTION,
		});
	});

	describe("worktrees", () => {
		function entry(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
			return {
				path: "/repos/project",
				head: "abc123",
				branch: "refs/heads/main",
				isDetached: false,
				type: "main",
				isLocked: false,
				isPrunable: false,
				...overrides,
			};
		}

		it("maps in-workspace entries and marks the main worktree", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						worktrees: () =>
							Promise.resolve([
								entry(),
								entry({
									path: "/repos/project/.kilo/worktrees/feature",
									branch: "refs/heads/kilo/feature",
									type: "linked",
								}),
							]),
					}),
			});

			await expect(service.worktrees("/repos/project")).resolves.toEqual([
				{ path: "/repos/project", name: "project", branch: "main", isMain: true },
				{
					path: "/repos/project/.kilo/worktrees/feature",
					name: "feature",
					branch: "kilo/feature",
					isMain: false,
				},
			]);
		});

		it("drops detached, prunable and outside-workspace entries", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						worktrees: () =>
							Promise.resolve([
								entry(),
								entry({
									path: "/repos/project/.kilo/worktrees/detached",
									branch: null,
									isDetached: true,
									type: "linked",
								}),
								entry({
									path: "/repos/project/.kilo/worktrees/prunable",
									branch: "refs/heads/kilo/prunable",
									isPrunable: true,
									type: "linked",
								}),
								entry({
									path: "/elsewhere/outside",
									branch: "refs/heads/kilo/outside",
									type: "linked",
								}),
							]),
					}),
			});

			await expect(service.worktrees("/repos/project")).resolves.toEqual([
				{ path: "/repos/project", name: "project", branch: "main", isMain: true },
			]);
		});

		it("keeps entries git reports in another spelling of the workspace folder", async () => {
			// The folder was registered through an 8.3 short name and in other
			// letter case; git prints the long form.
			const service = new GitService({
				logger,
				workspaces: folders(`${SHORT_TEMP}\\REPO`),
				pathIdentity: windowsPaths,
				createClient: () =>
					clientOf({
						worktrees: () =>
							Promise.resolve([
								entry({ path: `${LONG_TEMP}\\repo` }),
								entry({
									path: `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`,
									branch: "refs/heads/kilo/otter",
									type: "linked",
								}),
								entry({
									path: `${LONG_TEMP}\\repo-other`,
									branch: "refs/heads/kilo/other",
									type: "linked",
								}),
							]),
					}),
			});

			// `name` is the host's basename, which cannot split Windows paths on POSIX.
			const listed = await service.worktrees(`${SHORT_TEMP}\\REPO`);
			expect(listed?.map(({ path, branch, isMain }) => ({ path, branch, isMain }))).toEqual([
				{ path: `${LONG_TEMP}\\repo`, branch: "main", isMain: true },
				{
					path: `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`,
					branch: "kilo/otter",
					isMain: false,
				},
			]);
		});

		it("resolves null for a non-repository directory", async () => {
			const gitError = new GitError(
				stringResult({ gitError: GitErrorCode.NotAGitRepository, exitCode: 128 }),
				["worktree", "list"],
				"fatal: not a git repository",
			);
			const service = new GitService({
				logger,
				workspaces: folders("/not/a/repo"),
				createClient: () => clientOf({ worktrees: () => Promise.reject(gitError) }),
			});

			await expect(service.worktrees("/not/a/repo")).resolves.toBeNull();
		});

		it("propagates every other failure", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({ worktrees: () => Promise.reject(new GitNotDetectedError()) }),
			});

			await expect(service.worktrees("/repos/project")).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
			});
		});

		it("rejects a directory outside every workspace folder", async () => {
			const worktrees = vi.fn(() => Promise.resolve([]));
			const service = new GitService({
				logger,
				workspaces: folders("/workspaces/project"),
				createClient: () => clientOf({ worktrees }),
			});

			await expect(service.worktrees("/elsewhere/other")).rejects.toMatchObject({
				name: "KernelError",
				code: "VALIDATION",
			});
			expect(worktrees).not.toHaveBeenCalled();
		});
	});

	describe("resolveWorktree", () => {
		function entry(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
			return {
				path: "/repos/project",
				head: "abc123",
				branch: "refs/heads/main",
				isDetached: false,
				type: "main",
				isLocked: false,
				isPrunable: false,
				...overrides,
			};
		}

		it("resolves the matching non-main worktree's directory and branch", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () =>
					clientOf({
						worktrees: () =>
							Promise.resolve([
								entry(),
								entry({
									path: "/repos/project/.kilo/worktrees/feature",
									branch: "refs/heads/kilo/feature",
									type: "linked",
								}),
							]),
					}),
			});

			await expect(
				service.resolveWorktree({
					workingDirectory: "/repos/project",
					directory: "/repos/project/.kilo/worktrees/feature",
				}),
			).resolves.toEqual({
				directory: "/repos/project/.kilo/worktrees/feature",
				branch: "kilo/feature",
			});
		});

		it("matches a worktree given through a short name or in other letter case", async () => {
			const worktree = `${LONG_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`;
			const service = new GitService({
				logger,
				workspaces: folders(`${LONG_TEMP}\\repo`),
				pathIdentity: windowsPaths,
				createClient: () =>
					clientOf({
						worktrees: () =>
							Promise.resolve([
								entry({ path: `${LONG_TEMP}\\repo` }),
								entry({ path: worktree, branch: "refs/heads/kilo/otter", type: "linked" }),
							]),
					}),
			});
			const expected = { directory: worktree, branch: "kilo/otter" };

			await expect(
				service.resolveWorktree({
					workingDirectory: `${LONG_TEMP}\\repo`,
					directory: `${SHORT_TEMP}\\repo\\.kilo\\worktrees\\kilo-otter`,
				}),
			).resolves.toEqual(expected);
			await expect(
				service.resolveWorktree({
					workingDirectory: `${LONG_TEMP}\\repo`,
					directory: worktree.toUpperCase(),
				}),
			).resolves.toEqual(expected);
		});

		it("throws NOT_FOUND when the directory no longer resolves to a worktree", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () => clientOf({ worktrees: () => Promise.resolve([entry()]) }),
			});

			await expect(
				service.resolveWorktree({
					workingDirectory: "/repos/project",
					directory: "/repos/project/.kilo/worktrees/gone",
				}),
			).rejects.toMatchObject({ name: "KernelError", code: "NOT_FOUND" });
		});

		it("throws NOT_FOUND for the main worktree itself (not an 'existing worktree' target)", async () => {
			const service = new GitService({
				logger,
				workspaces: folders("/repos/project"),
				createClient: () => clientOf({ worktrees: () => Promise.resolve([entry()]) }),
			});

			await expect(
				service.resolveWorktree({
					workingDirectory: "/repos/project",
					directory: "/repos/project",
				}),
			).rejects.toMatchObject({ name: "KernelError", code: "NOT_FOUND" });
		});
	});

	it("available resolves true when the git version is obtained", async () => {
		const service = new GitService({
			logger,
			workspaces: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.available()).resolves.toBe(true);
	});

	it("available resolves false when the git binary is not detected", async () => {
		const service = new GitService({
			logger,
			workspaces: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => {
						throw new GitNotDetectedError();
					},
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});

	it("available resolves false when the version probe fails with any other error", async () => {
		const service = new GitService({
			logger,
			workspaces: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => Promise.reject(new Error("failed to parse git version")),
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});

	it("available resolves false when the version probe resolves a falsey value", async () => {
		const service = new GitService({
			logger,
			workspaces: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					// `version()` is declared `Promise<string>`, but the probe
					// treats a falsey resolved value as unavailable rather
					// than trusting the declared type across the seam, hence
					// the cast to violate the declared type deliberately.
					version: () => Promise.resolve(null as unknown as string),
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});
});

describe("GitService getDiffContents", () => {
	// Validation is exercised through the public getDiffContents surface with
	// a fake client, so the table covers both the accepts and the rejects.
	it.each([
		["README.md"],
		["src/index.ts"],
		// Legal in-tree names starting with `..` — a `startsWith("..")` check
		// would falsely reject these (the false positive this guards against).
		["..foo"],
		["..foo/bar.txt"],
		// Normalizes back in-tree before the escape check.
		["a/../b"],
		[".gitignore"],
	])("accepts the in-tree path %s", async (path) => {
		const getFileContents = vi.fn(() => Promise.resolve({ oldContents: null, newContents: null }));
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () => clientOf({ getFileContents }),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path }),
		).resolves.toEqual({ oldContents: null, newContents: null });
		expect(getFileContents).toHaveBeenCalledWith(expect.objectContaining({ path }));
	});

	it.each([
		[".."],
		["../outside.txt"],
		["sub/../../outside.txt"],
		// Absolute paths are rejected even when they point inside the working
		// directory (the contract takes repo-relative paths only).
		["/etc/passwd"],
		// A Windows drive-absolute path only escapes on win32; on POSIX it is
		// a legal (if odd) relative directory name, so this case is asserted
		// only where it is an escape.
		...(process.platform === "win32" ? [["C:\\Windows\\system32"]] : []),
	])("rejects the escaping path %s without touching the client", async (path) => {
		const getFileContents = vi.fn(() => Promise.resolve({ oldContents: null, newContents: null }));
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () => clientOf({ getFileContents }),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path }),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
		await expect(
			service.getDiffContents({
				workingDirectory: "/repos/project",
				path: "ok.txt",
				oldPath: path,
			}),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
		expect(getFileContents).not.toHaveBeenCalled();
	});

	it("maps GitNotDetectedError to a BUSINESS KernelError", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					getFileContents: () => Promise.reject(new GitNotDetectedError()),
				}),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path: "file.txt" }),
		).rejects.toMatchObject({ name: "KernelError", code: "BUSINESS" });
	});

	it("maps GitFileTooLargeError to a BUSINESS KernelError", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					getFileContents: () => Promise.reject(new GitFileTooLargeError("new", "file.txt")),
				}),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path: "file.txt" }),
		).rejects.toMatchObject({ name: "KernelError", code: "BUSINESS" });
	});

	it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					getFileContents: () => Promise.reject(xcodeLicenseError()),
				}),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path: "file.txt" }),
		).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: XCODE_LICENSE_DESCRIPTION,
		});
	});
});

describe("GitService createPatch", () => {
	it("lifts the patch size cap only when the user asks to show it anyway", async () => {
		const createWorkingDirectoryPatch = vi.fn((_options: { cwd: string; maxBytes?: number }) =>
			Promise.resolve({ patchPath: "/tmp/patch", byteLength: 10 }),
		);
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () => clientOf({ createWorkingDirectoryPatch }),
		});

		await service.createPatch({ cwd: "/repos/project" });
		await service.createPatch({ cwd: "/repos/project", unlimited: true });

		expect(createWorkingDirectoryPatch.mock.calls.map(([options]) => options.maxBytes)).toEqual([
			undefined,
			Number.POSITIVE_INFINITY,
		]);
	});

	it("maps a license-blocked GitError to a BUSINESS KernelError with its description", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					createWorkingDirectoryPatch: () => Promise.reject(xcodeLicenseError()),
				}),
		});

		await expect(service.createPatch({ cwd: "/repos/project" })).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
			message: XCODE_LICENSE_DESCRIPTION,
		});
	});

	it("passes null through and maps GitNotDetectedError to a KernelError", async () => {
		const nullService = new GitService({
			logger,
			workspaces: folders("/not/a/repo"),
			createClient: () => clientOf({ createWorkingDirectoryPatch: () => Promise.resolve(null) }),
		});
		await expect(nullService.createPatch({ cwd: "/not/a/repo" })).resolves.toBe(null);

		const missingGitService = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					createWorkingDirectoryPatch: () => Promise.reject(new GitNotDetectedError()),
				}),
		});
		await expect(missingGitService.createPatch({ cwd: "/repos/project" })).rejects.toMatchObject({
			name: "KernelError",
			code: "BUSINESS",
		});
	});

	it("releases a patch from the dispose sweep when releasePatch runs", async () => {
		const releasedPatchPath = await writeFileToTemp("git-service-release-");
		const inFlightPatchPath = await writeFileToTemp("git-service-inflight-");
		const results = [
			{ patchPath: releasedPatchPath, byteLength: 1 },
			{ patchPath: inFlightPatchPath, byteLength: 1 },
		];
		const service = new GitService({
			logger,
			workspaces: folders("/repos/project"),
			createClient: () =>
				clientOf({
					createWorkingDirectoryPatch: () => Promise.resolve(results.shift() ?? null),
				}),
		});

		const released = await service.createPatch({ cwd: "/repos/project" });
		await service.releasePatch(released!.patchPath);
		await expect(stat(releasedPatchPath)).rejects.toMatchObject({ code: "ENOENT" });
		// Already released: the teardown sweep finds nothing left for it.

		const inFlight = await service.createPatch({ cwd: "/repos/project" });
		expect(inFlight).not.toBeNull();
		await service.dispose();
		await expect(stat(inFlightPatchPath)).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("GitService workspace-folder containment", () => {
	function tracingClient() {
		return clientOf({
			status: vi.fn(() => Promise.resolve(null)),
			createWorkingDirectoryPatch: vi.fn(() => Promise.resolve(null)),
			getFileContents: vi.fn(() => Promise.resolve({ oldContents: null, newContents: null })),
		});
	}

	it("allows a directory that equals or is inside a workspace folder", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			workspaces: folders("/workspaces/project"),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/project")).resolves.toBe(null);
		await expect(service.status("/workspaces/project/nested-repo")).resolves.toBe(null);
		await expect(service.createPatch({ cwd: "/workspaces/project" })).resolves.toBe(null);
		await expect(
			service.getDiffContents({ workingDirectory: "/workspaces/project", path: "file.txt" }),
		).resolves.toEqual({ oldContents: null, newContents: null });
		expect(client.status).toHaveBeenCalledTimes(2);
		expect(client.createWorkingDirectoryPatch).toHaveBeenCalledTimes(1);
		expect(client.getFileContents).toHaveBeenCalledTimes(1);
	});

	it("rejects a directory outside every workspace folder without touching the client", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			workspaces: folders("/workspaces/project"),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/projector")).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		await expect(service.createPatch({ cwd: "/elsewhere/other" })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		await expect(
			service.getDiffContents({ workingDirectory: "/elsewhere/other", path: "file.txt" }),
		).rejects.toMatchObject({ name: "KernelError", code: "VALIDATION" });
		expect(client.status).not.toHaveBeenCalled();
		expect(client.createWorkingDirectoryPatch).not.toHaveBeenCalled();
		expect(client.getFileContents).not.toHaveBeenCalled();
	});

	it("fails closed with a VALIDATION KernelError when the workspaces capability is absent", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			workspaces: absentFolders(),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/project")).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		await expect(service.createPatch({ cwd: "/workspaces/project" })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		expect(client.status).not.toHaveBeenCalled();
		expect(client.createWorkingDirectoryPatch).not.toHaveBeenCalled();
	});
});

describe("GitService hasWorktreeWork", () => {
	it("rejects an outside-workspace directory without touching the client", async () => {
		const status = vi.fn(() => Promise.resolve(null));
		const service = new GitService({
			logger,
			workspaces: folders("/workspaces/project"),
			createClient: () => clientOf({ status }),
		});

		await expect(service.hasWorktreeWork({ directory: "/elsewhere/other" })).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		expect(status).not.toHaveBeenCalled();
	});

	it("resolves false when a git probe throws (missing binary, spawn failure)", async () => {
		const gitNotDetected = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () => clientOf({ status: () => Promise.reject(new GitNotDetectedError()) }),
		});
		await expect(gitNotDetected.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(
			false,
		);

		const spawnFailure = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () => clientOf({ status: () => Promise.reject(new Error("spawn failed")) }),
		});
		await expect(spawnFailure.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(false);

		const licenseBlocked = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () => clientOf({ status: () => Promise.reject(xcodeLicenseError()) }),
		});
		await expect(licenseBlocked.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(
			false,
		);
	});

	it("resolves false when the directory is not a repository", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/not/a/repo"),
			createClient: () => clientOf({ status: () => Promise.resolve(null) }),
		});

		await expect(service.hasWorktreeWork({ directory: "/not/a/repo" })).resolves.toBe(false);
	});

	it("resolves true when the worktree has uncommitted changes", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () =>
				clientOf({
					status: () =>
						Promise.resolve({
							exists: true,
							currentBranch: "main",
							workingDirectory: {
								files: [{ path: "notes.txt", status: { kind: AppFileStatusKind.Untracked } }],
							},
							doConflictedFilesExist: false,
						}),
				}),
		});

		await expect(
			service.hasWorktreeWork({ directory: "/repo/project", baseBranch: "main" }),
		).resolves.toBe(true);
	});

	it("resolves true when the worktree is commits ahead of the base branch", async () => {
		const exec = vi.fn(async () => ({ exitCode: 0, stdout: "3\n" }));
		const service = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () =>
				clientOf({
					status: statusOn("kilo/topic"),
					exec: exec as unknown as GitClientSlice["exec"],
				}),
		});

		await expect(
			service.hasWorktreeWork({ directory: "/repo/project", baseBranch: "main" }),
		).resolves.toBe(true);
		expect(exec).toHaveBeenCalledWith(["rev-list", "--count", "main..HEAD"], "revListCount", {
			cwd: "/repo/project",
			successExitCodes: new Set([0, 128]),
		});
	});

	it("resolves false and never calls exec when no base branch is given", async () => {
		const exec = vi.fn(async () => ({ exitCode: 0, stdout: "2\n" }));
		const service = new GitService({
			logger,
			workspaces: folders("/repo/project"),
			createClient: () =>
				clientOf({
					status: statusOn("kilo/topic"),
					exec: exec as unknown as GitClientSlice["exec"],
				}),
		});

		await expect(service.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(false);
		expect(exec).not.toHaveBeenCalled();
	});
});

describe("GitService defaultBranch", () => {
	it("rejects an outside-workspace directory without touching the client", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const branches = vi.fn(() => Promise.resolve([localBranch("main")]));
		const service = new GitService({
			logger,
			workspaces: folders("/workspaces/project"),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe, branches }),
		});

		await expect(service.defaultBranch("/elsewhere/other")).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		expect(defaultBranchProbe).not.toHaveBeenCalled();
		expect(branches).not.toHaveBeenCalled();
	});

	it("fails closed when the workspaces capability is absent", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const service = new GitService({
			logger,
			workspaces: absentFolders(),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe }),
		});

		await expect(service.defaultBranch("/repo")).rejects.toMatchObject({
			name: "KernelError",
			code: "VALIDATION",
		});
		expect(defaultBranchProbe).not.toHaveBeenCalled();
	});

	it("resolves the origin/HEAD symref short name first", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const branches = vi.fn(() => Promise.resolve([localBranch("trunk")]));
		const service = new GitService({
			logger,
			workspaces: folders("/repo"),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe, branches }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("main");
		expect(branches).not.toHaveBeenCalled();
	});

	it("falls back to a local main branch", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repo"),
			createClient: () =>
				clientOf({ branches: () => Promise.resolve([localBranch("main"), localBranch("dev")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("main");
	});

	it("falls back to master when main is absent", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repo"),
			createClient: () => clientOf({ branches: () => Promise.resolve([localBranch("master")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("master");
	});

	it("resolves null when no candidate exists", async () => {
		const service = new GitService({
			logger,
			workspaces: folders("/repo"),
			createClient: () => clientOf({ branches: () => Promise.resolve([localBranch("trunk")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBeNull();
	});
});
